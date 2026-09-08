# -*- coding: utf-8 -*-
"""Le os .xlsx de dados/bruto/<data>/, traduz e grava no schema mega.

Regra conservadora, igual a consolidar.py: so grava as obras que a extracao da
noite marcou como "ok" ou "sem_movimento". Uma obra "falhou" mantem os dados de
ontem intocados no banco.

IMPORTANTE: as colunas obra/obra_nome/data_extracao NAO vem do ERP — a tela do
Mega nao as exibe, entao o .xlsx exportado (via biblioteca.Operador.exportar_grid)
nunca as tem. Elas sao sinteticas e precisam ser inseridas AQUI, uma vez por
obra, logo apos ler o .xlsx e antes de traduzir_colunas — mesmo padrao ja usado
em consolidar.consolidar() para o arquivo consolidado (df.insert(0/1/2, ...)).
"""
import json
import math
from pathlib import Path

import pandas as pd

import banco
import config as cfgmod
import situacao
from consolidar import _ler as ler_bruto
from consolidar import conferir_contaminacao
from tradutor import traduzir_colunas

RAIZ = Path(__file__).resolve().parent.parent

# Mapeamento fixo arquivo->tabela. cfgmod.tabela_destino() so serve para
# relatorios de exportacao unica (devolve o proprio rel_id); relatorios com
# varias exportacoes/abas (analise_saldo_solicitacao) precisam de uma tabela
# por arquivo, entao o mapeamento fica explicito aqui.
TABELA_POR_ARQUIVO = {
    "Itens_Solicitados": "itens_solicitados",
    "Visualizacao_Itens": "visualizacao_itens",
    "Pedidos_Compra": "pedidos_compra",
    "Analise_Pedidos": "analise_pedidos_hist",
    "Analise_Contratos": "analise_contratos_hist",
    "Analise_Realizado": "analise_realizado",
}

# Colunas que cada tabela de sql/schema_mega.sql realmente declara (sem id, sem
# raw_data e sem obra/obra_nome/data_extracao, que sao sinteticas e sempre vao).
# A traducao devolve DEZENAS de colunas a mais do que o schema curado — mandar
# todas para o INSERT quebraria com UndefinedColumn. O excedente vai para
# raw_data (ver _separar_raw_data).
TABELA_COLUNAS = {
    "itens_solicitados": [
        "codigo_solicitacao", "numero_rm", "sequencial_item", "data_de_emissao",
        "situacao_do_item", "descricao_do_item", "quantidade_solicitada",
        "quantidade_baixada", "unidade",
    ],
    "visualizacao_itens": [
        "orcamento", "solicitacao", "sequencia", "fornecedor", "cod_item",
        "descricao", "qtde_solicitada", "data_de_necessidade", "data_inclusao",
        "valor_total", "situacao_do_item", "cod_cotacao", "cod_pedido", "cod_contrato",
    ],
    "pedidos_compra": [
        "numero_do_pedido", "item_pedido", "situacao_do_pedido", "dt_emissao",
        "nome_fantasia", "descricao_do_item", "quantidade", "total_pedido_compra",
    ],
    "analise_realizado": [
        "documento", "data_documento", "ap", "fornecedor", "valor_apropriacao",
    ],
    "analise_pedidos_hist": [
        "codigo_pedido", "fornecedor", "qtde_pedido", "valor_unitario",
        "qtde_apropriada", "valor_apropriacao",
    ],
    "analise_contratos_hist": [
        "codigo_contrato", "fornecedor", "status_pre_contrato",
        "saldo_qtde_contrato", "valor_unitario", "total",
    ],
}


def _serializavel(valor):
    """JSON nao entende NaN, Timestamp nem os escalares do numpy; normaliza
    para algo que entenda. As colunas numericas do .xlsx viram numpy.int64 /
    numpy.float64, que json.dumps rejeita com TypeError."""
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return None
    if hasattr(valor, "isoformat"):
        return valor.isoformat()
    if hasattr(valor, "item"):   # numpy.int64, numpy.float64, numpy.bool_
        valor = valor.item()
        if isinstance(valor, float) and math.isnan(valor):
            return None
    return valor


def _separar_raw_data(df, tabela):
    """Mantem so as colunas que a tabela de destino conhece (mais
    obra/obra_nome/data_extracao, sempre presentes); tudo o mais vai
    serializado em raw_data — a tabela sempre tem essa coluna JSONB para
    isso, em vez de o INSERT falhar por coluna desconhecida."""
    fixas = ["obra", "obra_nome", "data_extracao"]
    conhecidas = fixas + [c for c in TABELA_COLUNAS[tabela] if c in df.columns]
    extras = [c for c in df.columns if c not in conhecidas]
    saida = df[conhecidas].copy()
    if tabela == "visualizacao_itens" and "solicitacao" in saida.columns:
        # O grid do ERP inclui uma linha de RODAPE com o total geral (so
        # "Valor Total" preenchido, tudo mais vazio) — sobrevive ao
        # dropna(how="all") de consolidar._ler porque nao esta 100% vazia.
        # Nao e um item real: nao tem Solicitacao, que e parte da PRIMARY
        # KEY. Confirmado contra um Postgres 16 real em 2026-09-08 (violava
        # NOT NULL em "solicitacao"; a mesma linha aparecia com Valor Total
        # = 47853338.57, o valor maximo da coluna, batendo com um total).
        saida = saida[saida["solicitacao"].notna()]
    if tabela == "visualizacao_itens" and "fornecedor" in saida.columns:
        # "fornecedor" e NOT NULL (parte da PRIMARY KEY, chave_natural
        # verificada em config.yaml) mas fica vazio em ~28% das linhas reais
        # (item ainda sem fornecedor definido, nao so quando falta cotacao —
        # confirmado contra dados/bruto/2026-09-02: 912 de 3203 linhas da
        # obra 340). Substituir por string vazia preserva a unicidade da
        # chave (verificado sem colisao nas 25.244 linhas reais das 8 obras)
        # sem violar o NOT NULL.
        saida["fornecedor"] = saida["fornecedor"].fillna("")
    # NaN do pandas nao vira NULL sozinho: o Postgres recusa NaN num campo
    # BIGINT/NUMERIC com "out of range" (confirmado contra um Postgres 16 real
    # em 2026-09-08 — cod_contrato vazio, comum quando o item ainda nao foi
    # contratado, quebrava TODA a carga). Converter para None aqui, coluna a
    # coluna, antes de qualquer INSERT usar esses valores.
    for c in conhecidas:
        saida[c] = saida[c].astype(object).where(saida[c].notna(), None)
    if extras:
        saida["raw_data"] = df[extras].apply(
            lambda linha: json.dumps(
                {c: _serializavel(linha[c]) for c in extras}, ensure_ascii=False),
            axis=1)
    else:
        saida["raw_data"] = "{}"
    return saida


def _sem_nan(valor):
    """pd.read_excel devolve NaN (float) para celula vazia. Em Python, bool(nan)
    e True — se passassemos o NaN direto para situacao.derivar_etapa, uma
    coluna "Cod. Cotacao" vazia seria lida como "tem cotacao". Normalizar para
    None aqui evita esse falso positivo."""
    return None if pd.isna(valor) else valor


def _atualizar_trilha_situacao(conn, obra, df, data_iso, marcador_parametro):
    """So se aplica a visualizacao_itens (retencao 'atual_com_trilha'): deriva
    a etapa de cada linha de hoje e grava as transicoes na trilha
    mega.item_situacao_hist (situacao.py da Tarefa 3 + banco.py da Tarefa 5)."""
    atual = []
    for linha in df.to_dict("records"):
        etapa = situacao.derivar_etapa({
            "cod_cotacao": _sem_nan(linha.get("cod_cotacao")),
            "cod_pedido": _sem_nan(linha.get("cod_pedido")),
            "cod_contrato": _sem_nan(linha.get("cod_contrato")),
        })
        atual.append({
            "obra": obra,
            "solicitacao": linha.get("solicitacao"),
            "sequencia": linha.get("sequencia"),
            "fornecedor": linha.get("fornecedor"),
            "situacao": linha.get("situacao_do_item"),
            "etapa": etapa,
        })
    abertas = banco.buscar_abertas(conn, obra, marcador_parametro=marcador_parametro)
    fechar, abrir = situacao.calcular_transicoes(atual, abertas, data_iso)
    banco.aplicar_transicoes_situacao(conn, fechar, abrir,
                                      marcador_parametro=marcador_parametro)


def carregar_relatorio(cfg, conn, rel_id, data_iso, pasta, resultado_execucao,
                       marcador_parametro="%s"):
    """Carrega TODAS as exportacoes de um relatorio (um relatorio pode ter
    varias abas, cada uma com seu proprio arquivo/tabela/retencao — ver
    analise_saldo_solicitacao em config.yaml). Devolve um relato por
    exportacao processada."""
    rel = cfgmod.relatorio(cfg, rel_id)
    pasta = Path(pasta)

    if resultado_execucao.get("falhou"):
        motivo = "obras com falha registrada: %s" % ",".join(
            f["obra"] if isinstance(f, dict) else f for f in resultado_execucao["falhou"])
        # mega.carga e o UNICO registro de falha do projeto (nao ha notificacao
        # ativa): o bloqueio precisa ficar gravado, nao so devolvido em memoria.
        for exp in rel["exportacoes"]:
            banco.registrar_carga(conn, rel_id, exp["arquivo"], data_iso,
                                  resultado_execucao, bloqueado=True, motivo=motivo,
                                  marcador_parametro=marcador_parametro)
        return [{"arquivo": exp["arquivo"], "estado": "BLOQUEADO", "obras": 0,
                "motivo": motivo} for exp in rel["exportacoes"]]

    obras_a_carregar = resultado_execucao.get("ok", []) + resultado_execucao.get(
        "sem_movimento", [])

    relatos = []
    for exp in rel["exportacoes"]:
        arquivo_base = exp["arquivo"]
        aba = exp.get("aba")
        retencao = exp.get("retencao", rel.get("retencao"))
        tabela = TABELA_POR_ARQUIVO[arquivo_base]

        por_obra = {}
        # o traduzido INTEIRO (antes de _separar_raw_data mover o excedente para
        # raw_data): a checagem de contaminacao precisa da coluna `filial`, que
        # nao esta entre as colunas conhecidas de nenhuma tabela.
        por_obra_traduzido = {}
        for obra in obras_a_carregar:
            caminho = pasta / ("%s_%s_%s.xlsx" % (arquivo_base, obra, data_iso))
            if not caminho.exists():
                continue
            df = ler_bruto(caminho, rel["leitura"])
            df.insert(0, "obra", obra)
            df.insert(1, "obra_nome", cfgmod.obra(cfg, obra)["nome"])
            df.insert(2, "data_extracao", data_iso)
            df_traduzido = traduzir_colunas(df, rel_id, aba=aba)
            por_obra_traduzido[obra] = df_traduzido
            por_obra[obra] = _separar_raw_data(df_traduzido, tabela)

        if not por_obra:
            relatos.append({"arquivo": arquivo_base, "estado": "VAZIO", "obras": 0,
                            "motivo": "nenhum arquivo encontrado"})
            continue

        # Robo trocou de empresa e a tela nao acompanhou: a unica falha que
        # passaria despercebida por semanas. Bloqueia a exportacao INTEIRA.
        problemas_contaminacao = []
        for obra, df in por_obra_traduzido.items():
            problemas_contaminacao.extend(
                conferir_contaminacao(df, coluna_filial="filial"))

        if problemas_contaminacao:
            motivo = "contaminacao entre obras: %s" % "; ".join(problemas_contaminacao)
            banco.registrar_carga(conn, rel_id, arquivo_base, data_iso,
                                  resultado_execucao, bloqueado=True, motivo=motivo,
                                  marcador_parametro=marcador_parametro)
            relatos.append({"arquivo": arquivo_base, "estado": "BLOQUEADO", "obras": 0,
                            "motivo": motivo})
            continue

        for obra, df in por_obra.items():
            colunas = list(df.columns)
            linhas = [tuple(row) for row in df.itertuples(index=False, name=None)]
            if retencao == "historico":
                banco.inserir_historico(conn, tabela, colunas, linhas,
                                        marcador_parametro=marcador_parametro)
            else:
                banco.substituir_obra(conn, tabela, colunas, obra, linhas,
                                      marcador_parametro=marcador_parametro)
            if arquivo_base == "Visualizacao_Itens":
                _atualizar_trilha_situacao(conn, obra, df, data_iso, marcador_parametro)

        banco.registrar_carga(conn, rel_id, arquivo_base, data_iso, resultado_execucao,
                              marcador_parametro=marcador_parametro)
        relatos.append({"arquivo": arquivo_base, "estado": "OK", "obras": len(por_obra),
                        "motivo": None})

    return relatos


def purgar_arquivos(pasta, relatos, data_iso):
    """Apaga os .xlsx do dia cuja carga NAO ficou BLOQUEADO.

    BLOQUEADO preserva o arquivo bruto como evidencia para investigacao manual
    — mesma logica conservadora de consolidar.py antes de sobrescrever.
    """
    pasta = Path(pasta)
    apagados = []
    for relato in relatos:
        if relato["estado"] == "BLOQUEADO":
            continue
        for caminho in pasta.glob("%s_*_%s.xlsx" % (relato["arquivo"], data_iso)):
            caminho.unlink()
            apagados.append(caminho)
    return apagados
