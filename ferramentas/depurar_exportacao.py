# -*- coding: utf-8 -*-
"""Captura cada passo da exportacao de uma obra, para ver onde ela se perde.

Obras 410 e 630 falham sempre na exportacao; 340, 430, 480, 490 e 601 passam.
Como nao e aleatorio nem proporcional ao tamanho, so olhando a tela para saber.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.stdout.reconfigure(encoding="utf-8")

import config as cfgmod
from sessao import Sessao
from visao import Visao, Caixa, centro
from biblioteca import Operador
from plataforma import caminho_tesseract

TESS = caminho_tesseract()
RAIZ = Path(__file__).resolve().parent.parent
OBRA = sys.argv[1] if len(sys.argv) > 1 else "410"


def registrar(op, erp, nome):
    destino = RAIZ / "dados" / ("dep_%s_%s.png" % (OBRA, nome))
    erp.screenshot(path=str(destino))
    img = op.tela()
    palavras = [p for p in op.v.palavras_todas(img) if p["conf"] >= 50]
    print("\n--- %s (%d palavras) ---" % (nome, len(palavras)), flush=True)
    interessantes = [p for p in palavras
                     if any(k in p["texto"].lower()
                            for k in ("export", "excel", "salvar", "config",
                                      "imprimir", "html", "nome", "pasta"))]
    for p in interessantes[:12]:
        print("   %-34s x=%-5d y=%-5d" % (p["texto"][:34], p["x"], p["y"]), flush=True)
    if not interessantes:
        print("   (nada de menu/dialogo na tela)", flush=True)


def main():
    cfg = cfgmod.carregar()
    rel = cfgmod.relatorio(cfg, "itens_solicitados")
    obra = cfgmod.obra(cfg, OBRA)

    with Sessao() as s:
        print(s.entrar(), flush=True)
        s.pagina.wait_for_timeout(8000)
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESS)
        op = Operador(erp, visao=v, log=lambda m: print(m, flush=True))
        op.esperar_erp_pronto(timeout=300)

        op.trocar_empresa(obra["codigo"])
        op.abrir_tela(rel["busca_tela"], "ITENS SOLICITADOS",
                      palavra_modulo="Suprimentos")
        op.conferir_filial(obra["codigo"])
        op.clicar_texto("Mostrar apenas Itens Solicitados")
        rotulo = op.esperar_texto("Data de emissao", timeout=30)
        campo = Caixa(rotulo.x, rotulo.y + rotulo.altura + 4, 90, 18, "", 0)
        op.digitar_data(campo, "01", "01", "2025")
        op.clicar_relativo("Limpar Filtros", dy=-26)
        time.sleep(30)
        registrar(op, erp, "1_apos_filtrar")

        print("\nbotao direito no grid (700, 300)", flush=True)
        erp.mouse.click(700, 300, button="right")
        time.sleep(3)
        registrar(op, erp, "2_apos_botao_direito")

        alvo = "Exportar para Excel 2007 (xlsx)"
        caixa = v.achar_texto(alvo)
        print("\nachar_texto(%r) -> %s" % (alvo, caixa), flush=True)
        if not caixa:
            erp.mouse.click(700, 300, button="right")
            time.sleep(3)
            registrar(op, erp, "3_segundo_botao_direito")
            caixa = v.achar_texto(alvo)
            print("segunda tentativa -> %s" % (caixa,), flush=True)

        if caixa:
            x, y = centro(caixa)
            print("clicando em (%d, %d)" % (x, y), flush=True)
            erp.mouse.click(x, y)
            for i in (5, 15, 30, 60):
                time.sleep(i if i == 5 else i - 5)
                registrar(op, erp, "4_apos_clique_t%ds" % i)


if __name__ == "__main__":
    main()
