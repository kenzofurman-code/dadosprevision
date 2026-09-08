# -*- coding: utf-8 -*-
import json
import sqlite3
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod
import carregar


# ---------------------------------------------------------------------------
# carregar_relatorio le o .xlsx por consolidar._ler, que respeita
# leitura.linha_cabecalho do config.yaml. itens_solicitados e pedidos_compra
# tem o cabecalho na linha 1; analise_saldo_solicitacao e visualizacao_itens
# tem uma linha de titulo/agrupamento antes (linha_cabecalho: 2). As fixtures
# abaixo precisam reproduzir esse layout, senao a primeira linha de DADOS seria
# lida como cabecalho.
# ---------------------------------------------------------------------------
def _escrever_xlsx(caminho, df, titulo=None):
    if titulo is None:
        df.to_excel(caminho, index=False)
        return
    with pd.ExcelWriter(str(caminho), engine="openpyxl") as escritor:
        df.to_excel(escritor, index=False, startrow=1)
        escritor.sheets["Sheet1"].cell(row=1, column=1).value = titulo


# ---------------------------------------------------------------------------
# CORRECAO (Ruling 3 do orquestrador): o .xlsx exportado pelo ERP NUNCA tem as
# colunas obra/obra_nome/data_extracao — a tela do Mega nao as exibe. Essas
# tres colunas sao sinteticas e carregar_relatorio as insere sozinho. Por isso
# a fixture abaixo so tem as colunas REAIS do Excel.
# ---------------------------------------------------------------------------
@pytest.fixture
def pasta_bruta(tmp_path):
    df = pd.DataFrame({
        "Código da solicitação": [1, 1], "Nr. RM": [10, 11],
        "Sequencial do item": [1, 1], "Data de emissão": ["2025-01-02", "2025-01-03"],
        "Situação do Item": ["Baixado", "Aberto"],
        "Descrição do item": ["ITEM A", "ITEM B"],
        "Quantidade solicitada": [1.0, 2.0], "Quantidade baixada": [1.0, 0.0],
        "Unidade": ["UN", "UN"],
    })
    _escrever_xlsx(tmp_path / "Itens_Solicitados_340_2026-09-07.xlsx", df)
    return tmp_path


# As tabelas de teste precisam ter EXATAMENTE as colunas que o INSERT monta:
# obra/obra_nome/data_extracao (sinteticas), as colunas conhecidas de
# carregar.TABELA_COLUNAS presentes no arquivo, e raw_data — que _separar_raw_data
# sempre acrescenta, com o excedente da traducao serializado em JSON.
def _conexao_com_tabela_itens_solicitados():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE itens_solicitados (obra TEXT, obra_nome TEXT, "
        "data_extracao TEXT, codigo_solicitacao INTEGER, numero_rm INTEGER, "
        "sequencial_item INTEGER, data_de_emissao TEXT, situacao_do_item TEXT, "
        "descricao_do_item TEXT, quantidade_solicitada REAL, "
        "quantidade_baixada REAL, unidade TEXT, raw_data TEXT)")
    # NOTA (decisao propria, nao um dos 3 defeitos do orquestrador): a
    # implementacao chama banco.registrar_carga() ao final de cada exportacao
    # OK, e essa funcao sempre grava uma linha em "carga" — sem esta tabela o
    # teste quebraria com sqlite3.OperationalError antes mesmo de chegar as
    # asserções. Adicionada aqui com as mesmas colunas usadas em
    # tests/test_banco.py::test_registrar_carga_grava_uma_linha_por_chamada.
    conn.execute(
        "CREATE TABLE carga (relatorio TEXT, arquivo TEXT, data_extracao TEXT, "
        "obras_ok TEXT, obras_sem_movimento TEXT, obras_falhou TEXT, "
        "bloqueado INTEGER, motivo_bloqueio TEXT)")
    conn.commit()
    return conn


def test_carregar_relatorio_atual_insere_as_linhas_da_obra(pasta_bruta):
    cfg = cfgmod.carregar()
    conn = _conexao_com_tabela_itens_solicitados()
    resultado_execucao = {"ok": ["340"], "sem_movimento": [], "falhou": []}
    relatos = carregar.carregar_relatorio(
        cfg, conn, "itens_solicitados", "2026-09-07", pasta_bruta,
        resultado_execucao, marcador_parametro="?")
    conn.commit()
    linhas = conn.execute(
        "SELECT numero_rm, situacao_do_item FROM itens_solicitados ORDER BY numero_rm"
    ).fetchall()
    assert linhas == [(10, "Baixado"), (11, "Aberto")]
    assert relatos == [{"arquivo": "Itens_Solicitados", "estado": "OK",
                        "obras": 1, "motivo": None}]

    # As 3 colunas sinteticas devem ter sido preenchidas pelo proprio
    # carregar_relatorio (Ruling 3), com o codigo e o nome corretos da obra 340.
    obra_gravada = conn.execute(
        "SELECT obra, obra_nome, data_extracao FROM itens_solicitados LIMIT 1"
    ).fetchone()
    assert obra_gravada == ("340", "BALNEARIO DE GUARATUBA", "2026-09-07")


# ---------------------------------------------------------------------------
# C1: a traducao devolve DEZENAS de colunas a mais do que o schema curado.
# Mandar todas para o INSERT quebraria com UndefinedColumn; o excedente tem de
# ir para raw_data, sem perder informacao.
# ---------------------------------------------------------------------------
def test_coluna_fora_do_schema_vai_para_raw_data_em_vez_de_quebrar_o_insert(tmp_path):
    cfg = cfgmod.carregar()
    df = pd.DataFrame({
        "Código da solicitação": [1], "Nr. RM": [10],
        "Sequencial do item": [1], "Data de emissão": ["2025-01-02"],
        "Situação do Item": ["Aberto"], "Descrição do item": ["ITEM A"],
        "Quantidade solicitada": [1.0], "Quantidade baixada": [0.0],
        "Unidade": ["UN"],
        # real no Excel de itens_solicitados, mas fora de TABELA_COLUNAS
        "Filial": [340],
        "Centro de Custo": ["CC-9"],
    })
    _escrever_xlsx(tmp_path / "Itens_Solicitados_340_2026-09-07.xlsx", df)

    conn = _conexao_com_tabela_itens_solicitados()
    relatos = carregar.carregar_relatorio(
        cfg, conn, "itens_solicitados", "2026-09-07", tmp_path,
        {"ok": ["340"], "sem_movimento": [], "falhou": []}, marcador_parametro="?")
    conn.commit()

    assert relatos[0]["estado"] == "OK"
    bruto = conn.execute("SELECT raw_data FROM itens_solicitados").fetchone()[0]
    assert json.loads(bruto) == {"filial": 340, "centro_de_custo": "CC-9"}


def test_obra_que_falhou_bloqueia_a_carga_e_nao_apaga_dados_antigos(pasta_bruta):
    cfg = cfgmod.carregar()
    conn = _conexao_com_tabela_itens_solicitados()
    conn.execute(
        "INSERT INTO itens_solicitados VALUES "
        "('410', 'CROMA', '2026-09-06', 9, 99, 1, '2025-01-01', 'Aberto', "
        "'ANTIGO', 1.0, 0.0, 'UN', '{}')")
    conn.commit()

    resultado_execucao = {"ok": [], "sem_movimento": [], "falhou": [{"obra": "410"}]}
    relatos = carregar.carregar_relatorio(
        cfg, conn, "itens_solicitados", "2026-09-07", pasta_bruta,
        resultado_execucao, marcador_parametro="?")

    assert relatos[0]["estado"] == "BLOQUEADO"
    linhas = conn.execute("SELECT obra FROM itens_solicitados").fetchall()
    assert linhas == [("410",)]   # dado antigo intocado


# ---------------------------------------------------------------------------
# I1: mega.carga e o UNICO registro de falha do projeto (nao ha notificacao
# ativa). Um bloqueio devolvido so em memoria some quando o processo termina.
# ---------------------------------------------------------------------------
def test_obra_que_falhou_grava_o_bloqueio_na_tabela_carga(pasta_bruta):
    cfg = cfgmod.carregar()
    conn = _conexao_com_tabela_itens_solicitados()

    resultado_execucao = {"ok": [], "sem_movimento": [],
                          "falhou": [{"obra": "410", "motivo": "timeout no grid"}]}
    carregar.carregar_relatorio(
        cfg, conn, "itens_solicitados", "2026-09-07", pasta_bruta,
        resultado_execucao, marcador_parametro="?")
    conn.commit()

    linhas = conn.execute(
        "SELECT arquivo, bloqueado, motivo_bloqueio, obras_falhou FROM carga"
    ).fetchall()
    assert len(linhas) == 1
    arquivo, bloqueado, motivo, obras_falhou = linhas[0]
    assert arquivo == "Itens_Solicitados"
    assert bool(bloqueado) is True
    assert motivo == "obras com falha registrada: 410"
    assert json.loads(obras_falhou) == ["410"]


# ---------------------------------------------------------------------------
# I6: robo trocou de empresa e a tela nao acompanhou. E a unica falha do
# projeto que passaria despercebida por semanas — precisa bloquear a exportacao
# INTEIRA, sem gravar nada.
# ---------------------------------------------------------------------------
def test_contaminacao_entre_obras_bloqueia_a_exportacao_sem_inserir_nada(tmp_path):
    cfg = cfgmod.carregar()
    df = pd.DataFrame({
        "Código da solicitação": [1, 2], "Nr. RM": [10, 11],
        "Sequencial do item": [1, 1], "Data de emissão": ["2025-01-02", "2025-01-03"],
        "Situação do Item": ["Aberto", "Aberto"],
        "Descrição do item": ["ITEM A", "ITEM B"],
        "Quantidade solicitada": [1.0, 2.0], "Quantidade baixada": [0.0, 0.0],
        "Unidade": ["UN", "UN"],
        "Filial": [340, 999],   # a segunda linha veio de OUTRA empresa
    })
    _escrever_xlsx(tmp_path / "Itens_Solicitados_340_2026-09-07.xlsx", df)

    conn = _conexao_com_tabela_itens_solicitados()
    relatos = carregar.carregar_relatorio(
        cfg, conn, "itens_solicitados", "2026-09-07", tmp_path,
        {"ok": ["340"], "sem_movimento": [], "falhou": []}, marcador_parametro="?")
    conn.commit()

    assert relatos[0]["estado"] == "BLOQUEADO"
    assert "contaminacao" in relatos[0]["motivo"]
    assert conn.execute(
        "SELECT COUNT(*) FROM itens_solicitados WHERE obra = '340'").fetchone() == (0,)
    # e o bloqueio ficou registrado em mega.carga
    assert conn.execute("SELECT bloqueado FROM carga").fetchone() == (1,)


def test_purgar_arquivos_apaga_so_o_que_carregou_ok(pasta_bruta):
    outro = pasta_bruta / "Analise_Realizado_340_2026-09-07.xlsx"
    outro.write_bytes(b"PK\x03\x04lixo")  # simula um xlsx qualquer
    relatos = [
        {"arquivo": "Itens_Solicitados", "estado": "OK", "obras": 1, "motivo": None},
        {"arquivo": "Analise_Realizado", "estado": "BLOQUEADO", "obras": 0,
         "motivo": "obras com falha"},
    ]
    apagados = carregar.purgar_arquivos(pasta_bruta, relatos, "2026-09-07")
    assert (pasta_bruta / "Itens_Solicitados_340_2026-09-07.xlsx") not in list(
        pasta_bruta.iterdir())
    assert outro.exists()   # BLOQUEADO preserva o arquivo como evidencia
    assert len(apagados) == 1


# ---------------------------------------------------------------------------
# CORRECAO (Ruling 2 do orquestrador, defeito 1): analise_saldo_solicitacao
# tem 3 exportacoes (Pedidos/Contratos/Realizado) e as 3 precisam ser
# carregadas, cada uma na sua propria tabela.
# ---------------------------------------------------------------------------
def test_carregar_relatorio_multi_exportacao_carrega_as_tres_abas(tmp_path):
    cfg = cfgmod.carregar()

    # linha_cabecalho: 2 — L1 e o agrupamento (Servico / Insumo / Realizado)
    _escrever_xlsx(
        tmp_path / "Analise_Pedidos_340_2026-09-07.xlsx",
        pd.DataFrame({"Código": [1001, 1002], "Fornecedor": ["FORN A", "FORN B"]}),
        titulo="Serviço")
    _escrever_xlsx(
        tmp_path / "Analise_Contratos_340_2026-09-07.xlsx",
        pd.DataFrame({"Código": [2001], "Fornecedor": ["FORN C"]}),
        titulo="Insumo")
    _escrever_xlsx(
        tmp_path / "Analise_Realizado_340_2026-09-07.xlsx",
        pd.DataFrame({"Documento": [5001, 5002, 5003]}),
        titulo="Realizado")

    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE analise_pedidos_hist (obra TEXT, obra_nome TEXT, "
        "data_extracao TEXT, codigo_pedido INTEGER, fornecedor TEXT, raw_data TEXT)")
    conn.execute(
        "CREATE TABLE analise_contratos_hist (obra TEXT, obra_nome TEXT, "
        "data_extracao TEXT, codigo_contrato INTEGER, fornecedor TEXT, raw_data TEXT)")
    conn.execute(
        "CREATE TABLE analise_realizado (obra TEXT, obra_nome TEXT, "
        "data_extracao TEXT, documento INTEGER, raw_data TEXT)")
    conn.execute(
        "CREATE TABLE carga (relatorio TEXT, arquivo TEXT, data_extracao TEXT, "
        "obras_ok TEXT, obras_sem_movimento TEXT, obras_falhou TEXT, "
        "bloqueado INTEGER, motivo_bloqueio TEXT)")
    conn.commit()

    resultado_execucao = {"ok": ["340"], "sem_movimento": [], "falhou": []}
    relatos = carregar.carregar_relatorio(
        cfg, conn, "analise_saldo_solicitacao", "2026-09-07", tmp_path,
        resultado_execucao, marcador_parametro="?")
    conn.commit()

    assert len(relatos) == 3
    assert {r["arquivo"] for r in relatos} == {
        "Analise_Pedidos", "Analise_Contratos", "Analise_Realizado"}
    assert all(r["estado"] == "OK" for r in relatos)

    pedidos = conn.execute(
        "SELECT codigo_pedido, fornecedor FROM analise_pedidos_hist "
        "ORDER BY codigo_pedido"
    ).fetchall()
    assert pedidos == [(1001, "FORN A"), (1002, "FORN B")]

    contratos = conn.execute(
        "SELECT codigo_contrato, fornecedor FROM analise_contratos_hist"
    ).fetchall()
    assert contratos == [(2001, "FORN C")]

    realizado = conn.execute(
        "SELECT documento FROM analise_realizado ORDER BY documento").fetchall()
    assert realizado == [(5001,), (5002,), (5003,)]


# ---------------------------------------------------------------------------
# CORRECAO (Ruling 2 do orquestrador, defeito 3): visualizacao_itens precisa
# alimentar a trilha mega.item_situacao_hist via situacao.py + banco.py.
# ---------------------------------------------------------------------------
def test_carregar_visualizacao_itens_grava_a_trilha_de_situacao(tmp_path):
    cfg = cfgmod.carregar()

    # linha_cabecalho: 2 (L1 e o titulo mesclado) e descartar_colunas [1, 2]
    # (setinha de expandir e badge de status do grid) — a fixture reproduz as
    # duas colunas descartaveis para exercitar consolidar._ler de verdade.
    df = pd.DataFrame({
        "": ["+"], " ": ["ok"],
        "Solicitação": [1], "Sequência": [1], "Fornecedor": ["FORN X"],
        "Situação do Item": ["Aberto"], "Cód. Cotação": [None],
    })
    _escrever_xlsx(tmp_path / "Visualizacao_Itens_340_2026-09-07.xlsx", df,
                   titulo="Itens Solicitados")

    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE visualizacao_itens (obra TEXT, obra_nome TEXT, "
        "data_extracao TEXT, solicitacao INTEGER, sequencia INTEGER, "
        "fornecedor TEXT, situacao_do_item TEXT, cod_cotacao INTEGER, "
        "raw_data TEXT)")
    conn.execute(
        "CREATE TABLE item_situacao_hist (obra TEXT, solicitacao INTEGER, "
        "sequencia INTEGER, fornecedor TEXT, situacao TEXT, etapa TEXT, "
        "desde TEXT, ate TEXT)")
    conn.execute(
        "CREATE TABLE carga (relatorio TEXT, arquivo TEXT, data_extracao TEXT, "
        "obras_ok TEXT, obras_sem_movimento TEXT, obras_falhou TEXT, "
        "bloqueado INTEGER, motivo_bloqueio TEXT)")
    conn.commit()

    resultado_execucao = {"ok": ["340"], "sem_movimento": [], "falhou": []}
    relatos = carregar.carregar_relatorio(
        cfg, conn, "visualizacao_itens", "2026-09-07", tmp_path,
        resultado_execucao, marcador_parametro="?")
    conn.commit()

    assert relatos == [{"arquivo": "Visualizacao_Itens", "estado": "OK",
                        "obras": 1, "motivo": None}]

    trilha = conn.execute(
        "SELECT etapa, ate FROM item_situacao_hist WHERE solicitacao = 1 "
        "AND sequencia = 1 AND fornecedor = 'FORN X'").fetchall()
    assert trilha == [("solicitado", None)]


# ---------------------------------------------------------------------------
# Os 3 testes abaixo reproduzem bugs que so apareceram testando contra um
# Postgres 16 real em 2026-09-08 (nao existiam SQLite abaixo para pega-los,
# porque o SQLite e tipado de forma dinamica e aceita o que o Postgres
# recusa). Testam _separar_raw_data() diretamente, sem precisar de banco.
# ---------------------------------------------------------------------------
def test_nan_em_coluna_conhecida_vira_none_nao_nan():
    # cod_contrato vazio (item ainda nao contratado) e comum e legitimo, mas
    # pandas representa "vazio" numa coluna numerica como NaN — e o Postgres
    # recusa NaN num campo BIGINT com "bigint out of range" (confirmado ao
    # vivo). Precisa virar None antes do INSERT.
    df = pd.DataFrame({
        "obra": ["340"], "obra_nome": ["X"], "data_extracao": ["2026-09-08"],
        "solicitacao": [1.0], "sequencia": [1.0], "fornecedor": ["FORN"],
        "cod_contrato": [float("nan")],
    })
    saida = carregar._separar_raw_data(df, "visualizacao_itens")
    assert saida["cod_contrato"].iloc[0] is None


def test_fornecedor_vazio_em_visualizacao_itens_vira_string_vazia_nao_none():
    # "fornecedor" e NOT NULL (parte da PRIMARY KEY) mas fica vazio em ~28%
    # das linhas reais (confirmado contra dados/bruto/2026-09-02: 912 de 3203
    # linhas da obra 340) — nao so quando falta cotacao. None violaria o
    # NOT NULL; "" preserva a unicidade da chave (verificado sem colisao nas
    # 25.244 linhas reais das 8 obras).
    df = pd.DataFrame({
        "obra": ["340"], "obra_nome": ["X"], "data_extracao": ["2026-09-08"],
        "solicitacao": [1.0], "sequencia": [1.0], "fornecedor": [None],
    })
    saida = carregar._separar_raw_data(df, "visualizacao_itens")
    assert saida["fornecedor"].iloc[0] == ""


def test_linha_de_rodape_sem_solicitacao_e_descartada_de_visualizacao_itens():
    # O grid do ERP inclui uma linha de RODAPE com o total geral (so
    # "Valor Total" preenchido) que sobrevive ao dropna(how="all") de
    # consolidar._ler porque nao esta 100% vazia — mas nao tem Solicitacao,
    # que e NOT NULL/parte da PRIMARY KEY. Confirmado ao vivo contra Postgres
    # real (a mesma linha aparecia com Valor Total = 47853338.57, o maximo da
    # coluna, batendo com um total geral).
    df = pd.DataFrame({
        "obra": ["340", "340"], "obra_nome": ["X", "X"],
        "data_extracao": ["2026-09-08", "2026-09-08"],
        "solicitacao": [1.0, float("nan")], "sequencia": [1.0, float("nan")],
        "fornecedor": ["FORN", None], "valor_total": [100.0, 47853338.57],
    })
    saida = carregar._separar_raw_data(df, "visualizacao_itens")
    assert len(saida) == 1
    assert saida["solicitacao"].iloc[0] == 1.0
