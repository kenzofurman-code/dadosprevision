# -*- coding: utf-8 -*-
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import banco


def _conexao_sqlite_com_tabela():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE itens_solicitados (obra TEXT, numero_rm INTEGER, "
        "descricao TEXT)")
    conn.execute("INSERT INTO itens_solicitados VALUES ('340', 1, 'antigo 340')")
    conn.execute("INSERT INTO itens_solicitados VALUES ('410', 1, 'antigo 410')")
    conn.commit()
    return conn


def test_substituir_obra_apaga_so_a_obra_indicada_e_insere_as_novas_linhas():
    conn = _conexao_sqlite_com_tabela()
    banco.substituir_obra(
        conn, "itens_solicitados", ["obra", "numero_rm", "descricao"],
        obra="340",
        linhas=[("340", 2, "novo 340 a"), ("340", 3, "novo 340 b")],
        marcador_parametro="?",   # sqlite usa '?'; psycopg usa '%s' (Step 5)
    )
    conn.commit()
    linhas = conn.execute(
        "SELECT obra, numero_rm, descricao FROM itens_solicitados ORDER BY obra, numero_rm"
    ).fetchall()
    assert linhas == [
        ("340", 2, "novo 340 a"),
        ("340", 3, "novo 340 b"),
        ("410", 1, "antigo 410"),   # obra 410 preservada — nao foi tocada
    ]


def test_substituir_obra_com_lista_vazia_so_apaga_e_nao_insere_nada():
    conn = _conexao_sqlite_com_tabela()
    banco.substituir_obra(conn, "itens_solicitados",
                          ["obra", "numero_rm", "descricao"],
                          obra="340", linhas=[], marcador_parametro="?")
    conn.commit()
    linhas = conn.execute(
        "SELECT obra FROM itens_solicitados ORDER BY obra").fetchall()
    assert linhas == [("410",)]


def test_registrar_carga_grava_uma_linha_por_chamada():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE carga (relatorio TEXT, arquivo TEXT, data_extracao TEXT, "
        "obras_ok TEXT, obras_sem_movimento TEXT, obras_falhou TEXT, "
        "bloqueado INTEGER, motivo_bloqueio TEXT)")
    banco.registrar_carga(conn, "itens_solicitados", "Itens_Solicitados",
                          "2026-09-07", {"ok": ["340", "410"], "sem_movimento": [],
                                        "falhou": []},
                          marcador_parametro="?")
    conn.commit()
    linha = conn.execute("SELECT relatorio, bloqueado FROM carga").fetchone()
    assert linha == ("itens_solicitados", 0)


def test_registrar_carga_guarda_so_o_codigo_das_obras_que_falharam():
    """executar.executar_relatorio devolve "falhou" como lista de dicts
    {"obra":..., "motivo":...}. obras_falhou tem de ficar no MESMO formato de
    obras_ok/obras_sem_movimento (lista de codigos), senao um SELECT que cruza
    as tres colunas compara dict com string e nunca casa."""
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE carga (relatorio TEXT, arquivo TEXT, data_extracao TEXT, "
        "obras_ok TEXT, obras_sem_movimento TEXT, obras_falhou TEXT, "
        "bloqueado INTEGER, motivo_bloqueio TEXT)")
    banco.registrar_carga(
        conn, "itens_solicitados", "Itens_Solicitados", "2026-09-07",
        {"ok": [], "sem_movimento": [], "falhou": [{"obra": "410", "motivo": "x"}]},
        bloqueado=True, motivo="obra 410 falhou", marcador_parametro="?")
    conn.commit()
    obras_falhou = conn.execute("SELECT obras_falhou FROM carga").fetchone()[0]
    assert json.loads(obras_falhou) == ["410"]


def test_aplicar_esquema_funciona_com_sqlite_multiplos_statements(tmp_path, monkeypatch):
    # aplicar_esquema deve funcionar tanto com psycopg (conn.execute aceita
    # multiplos statements) quanto com sqlite (exige executescript). Este
    # teste prova o ramo sqlite, que antes desta correcao nunca era exercitado
    # (hasattr(conn, "execute") era verdadeiro tambem para sqlite3.Connection,
    # entao o ramo executescript nunca disparava).
    pasta_sql = tmp_path / "sql"
    pasta_sql.mkdir()
    (pasta_sql / "schema_mega.sql").write_text(
        "CREATE TABLE IF NOT EXISTS t1 (x INTEGER);\n"
        "CREATE TABLE IF NOT EXISTS t2 (y INTEGER);\n",
        encoding="utf-8")
    monkeypatch.setattr(banco, "RAIZ", tmp_path)

    conn = sqlite3.connect(":memory:")
    banco.aplicar_esquema(conn)
    conn.commit()

    tabelas = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    assert tabelas == [("t1",), ("t2",)]


def test_aplicar_transicoes_fecha_e_abre_nas_tabelas_certas():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE item_situacao_hist (obra TEXT, solicitacao INTEGER, "
        "sequencia INTEGER, fornecedor TEXT, situacao TEXT, etapa TEXT, "
        "desde TEXT, ate TEXT)")
    conn.execute(
        "INSERT INTO item_situacao_hist VALUES "
        "('340', 1, 1, 'X', 'Aberto', 'solicitado', '2026-09-01', NULL)")
    conn.commit()

    fechar = [{"obra": "340", "solicitacao": 1, "sequencia": 1, "fornecedor": "X",
              "desde": "2026-09-01", "ate": "2026-09-07"}]
    abrir = [{"obra": "340", "solicitacao": 1, "sequencia": 1, "fornecedor": "X",
             "situacao": "Cotado", "etapa": "cotado", "desde": "2026-09-07"}]
    banco.aplicar_transicoes_situacao(conn, fechar, abrir, marcador_parametro="?")
    conn.commit()

    linhas = conn.execute(
        "SELECT etapa, desde, ate FROM item_situacao_hist ORDER BY desde").fetchall()
    assert linhas == [
        ("solicitado", "2026-09-01", "2026-09-07"),
        ("cotado", "2026-09-07", None),
    ]
