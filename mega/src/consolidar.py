# -*- coding: utf-8 -*-
"""Recolhe os .xlsx exportados e os unifica num arquivo por exportacao.

Etapa puramente local: nao fala com o ERP. Por isso e testavel sem a VPS.
"""
import argparse
import datetime as dt
import json
import shutil
import sys
import warnings
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config as cfgmod

warnings.filterwarnings("ignore", message="Workbook contains no default style")

RAIZ = Path(__file__).resolve().parent.parent
BRUTO = RAIZ / "dados" / "bruto"
CONSOLIDADO = RAIZ / "dados" / "consolidado"


def hoje_iso():
    return dt.date.today().isoformat()


def recolher(cfg, data_iso, origem=None):
    """Copia de Downloads para dados/bruto/<data>/, ignorando as copias carimbadas."""
    origem = Path(origem or RAIZ / "dados" / "downloads")
    destino = BRUTO / data_iso
    destino.mkdir(parents=True, exist_ok=True)
    copiados = []
    for rel in cfgmod.relatorios(cfg):
        for exp in rel["exportacoes"]:
            for obra in cfgmod.obras(cfg):
                nome = cfgmod.nome_arquivo(exp, obra["codigo"], data_iso)
                fonte = origem / nome
                if fonte.exists():
                    shutil.copy2(str(fonte), str(destino / nome))
                    copiados.append(nome)
    return destino, copiados


def ler_manifesto(pasta):
    """O robo grava o que aconteceu em cada obra. Sem isso, o consolidador nao
    consegue distinguir 'obra sem movimento' de 'obra que falhou' — e a regra
    conservadora bloquearia para sempre por causa de obras legitimamente vazias.
    """
    caminho = Path(pasta) / "_execucao.json"
    if not caminho.exists():
        return {}
    with open(str(caminho), encoding="utf-8") as f:
        return json.load(f).get("exportacoes", {})


def _ler(caminho, leitura):
    df = pd.read_excel(caminho, header=leitura["linha_cabecalho"] - 1)
    descartar = leitura.get("descartar_colunas") or []
    if descartar:
        idx = [i - 1 for i in descartar if i - 1 < len(df.columns)]
        df = df.drop(df.columns[idx], axis=1)
    df = df.dropna(how="all")
    return df


def conferir_contaminacao(df, coluna_filial="Filial"):
    """Cada obra deve conter uma unica filial, e ela deve bater com o codigo da obra.

    E a versao automatica da checagem da barra do topo: se o robo trocou de empresa
    e a tela nao acompanhou, os dados de uma obra entram no arquivo de outra. Aqui
    isso aparece — e e a unica falha do projeto que passaria despercebida por semanas.
    """
    if coluna_filial not in df.columns:
        return []
    problemas = []
    for obra, grupo in df.groupby("obra"):
        filiais = set(str(int(f)) for f in grupo[coluna_filial].dropna().unique())
        if len(filiais) != 1:
            problemas.append("obra %s tem %d filiais: %s"
                             % (obra, len(filiais), ",".join(sorted(filiais))))
        elif filiais.pop().lstrip("0") != str(obra).lstrip("0"):
            problemas.append("obra %s contem dados de outra filial" % obra)
    return problemas


def consolidar(cfg, data_iso, parcial=False, pasta=None):
    pasta = Path(pasta) if pasta else BRUTO / data_iso
    CONSOLIDADO.mkdir(parents=True, exist_ok=True)
    manifesto = ler_manifesto(pasta)
    relato = []

    for rel in cfgmod.relatorios(cfg):
        leitura = rel["leitura"]
        for exp in rel["exportacoes"]:
            registro = manifesto.get(exp["arquivo"], {})
            sem_movimento = set(registro.get("sem_movimento", []))
            falhou = list(registro.get("falhou", []))
            partes, faltando = [], []
            for obra in cfgmod.obras(cfg):
                nome = cfgmod.nome_arquivo(exp, obra["codigo"], data_iso)
                caminho = pasta / nome
                if not caminho.exists():
                    if obra["codigo"] not in sem_movimento:
                        faltando.append(obra["codigo"])
                    continue
                df = _ler(caminho, leitura)
                esperado = leitura.get("colunas")
                if isinstance(esperado, int):
                    reais = len(df.columns) + len(leitura.get("descartar_colunas") or [])
                    if reais != esperado:
                        relato.append(("AVISO", exp["arquivo"], obra["codigo"],
                                       "%d colunas, esperado %d" % (reais, esperado)))
                df.insert(0, "obra", obra["codigo"])
                df.insert(1, "obra_nome", obra["nome"])
                df.insert(2, "data_extracao", data_iso)
                partes.append(df)

            saida = CONSOLIDADO / ("%s.parquet" % exp["arquivo"].lower())
            if not partes:
                relato.append(("VAZIO", exp["arquivo"], "-", "nenhum arquivo encontrado"))
                continue
            if falhou:
                relato.append(("BLOQUEADO", exp["arquivo"], ",".join(falhou),
                               "obras com falha registrada; consolidado NAO sobrescrito"))
                continue
            if faltando and not parcial:
                relato.append(("BLOQUEADO", exp["arquivo"], ",".join(faltando),
                               "consolidado NAO sobrescrito (regra conservadora)"))
                continue
            tudo = pd.concat(partes, ignore_index=True)
            contaminacao = conferir_contaminacao(tudo)
            if contaminacao:
                for p in contaminacao:
                    relato.append(("CONTAMINADO", exp["arquivo"], "-", p))
                relato.append(("BLOQUEADO", exp["arquivo"], "-",
                               "contaminacao entre obras; consolidado NAO sobrescrito"))
                continue
            try:
                tudo.to_parquet(saida, index=False)
            except Exception:
                saida = saida.with_suffix(".xlsx")
                tudo.to_excel(saida, index=False)
            estado = "PARCIAL" if faltando else "OK"
            extra = ""
            if sem_movimento:
                extra += "  (sem movimento: %s)" % ",".join(sorted(sem_movimento))
            if faltando:
                extra += "  (faltam %s)" % ",".join(faltando)
            relato.append((estado, exp["arquivo"],
                           "%d obras" % len(partes),
                           "%d linhas -> %s%s" % (len(tudo), saida.name, extra)))
    return relato


def main():
    ap = argparse.ArgumentParser(description="Consolida os relatorios exportados do Mega")
    ap.add_argument("--data", default=hoje_iso(), help="AAAA-MM-DD (padrao: hoje)")
    ap.add_argument("--parcial", action="store_true",
                    help="escreve mesmo faltando obras (padrao: bloqueia)")
    ap.add_argument("--pular-recolher", action="store_true")
    args = ap.parse_args()

    cfg = cfgmod.carregar()
    if not args.pular_recolher:
        destino, copiados = recolher(cfg, args.data)
        print("Recolhidos %d arquivos para %s" % (len(copiados), destino))

    print("")
    print("%-10s %-22s %-12s %s" % ("ESTADO", "EXPORTACAO", "OBRAS", "DETALHE"))
    print("-" * 100)
    for estado, arq, obras, detalhe in consolidar(cfg, args.data, parcial=args.parcial):
        print("%-10s %-22s %-12s %s" % (estado, arq, obras, detalhe))


if __name__ == "__main__":
    main()
