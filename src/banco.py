# -*- coding: utf-8 -*-
"""Escrita no schema `mega` do PostgreSQL compartilhado com o Dados Prevision.

Um dono por schema: este modulo NUNCA escreve fora de `mega.*`. O schema
`public` e do app Node (server/db.js do dadosprevision).

A carga e SEMPRE por obra, numa transacao: DELETE FROM <tabela> WHERE obra=%s,
seguido de INSERT das linhas novas. Se a obra 410 falhar na extracao de hoje,
esta funcao simplesmente nao e chamada para ela — os dados de ontem permanecem
(regra conservadora, igual ao consolidar.py existente).
"""
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _dsn_de_variaveis_de_ambiente():
    """Mesma convencao do server/db.js do Dados Prevision: DATABASE_URL tem
    prioridade; senao monta a partir de PGHOST/PGPORT/PGDATABASE/PGUSER/
    PGPASSWORD."""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    host = os.environ.get("PGHOST", "localhost")
    port = os.environ.get("PGPORT", "5432")
    db = os.environ.get("PGDATABASE", "dadosprevision")
    user = os.environ.get("PGUSER", "postgres")
    senha = os.environ.get("PGPASSWORD", "")
    return "host=%s port=%s dbname=%s user=%s password=%s" % (host, port, db, user, senha)


def conectar():
    import psycopg
    return psycopg.connect(_dsn_de_variaveis_de_ambiente())


def aplicar_esquema(conn):
    sql = (RAIZ / "sql" / "schema_mega.sql").read_text(encoding="utf-8")
    if hasattr(conn, "executescript"):
        conn.executescript(sql)
    else:
        conn.execute(sql)
    conn.commit()


def substituir_obra(conn, tabela, colunas, obra, linhas, marcador_parametro="%s"):
    cur = conn.cursor()
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur.execute("DELETE FROM %s%s WHERE obra = %s" % (prefixo, tabela, marcador_parametro),
               (obra,))
    if linhas:
        colunas_sql = ", ".join(colunas)
        marcadores = ", ".join([marcador_parametro] * len(colunas))
        cur.executemany(
            "INSERT INTO %s%s (%s) VALUES (%s)" % (prefixo, tabela, colunas_sql, marcadores),
            linhas)


def inserir_historico(conn, tabela, colunas, linhas, marcador_parametro="%s"):
    if not linhas:
        return
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur = conn.cursor()
    colunas_sql = ", ".join(colunas)
    marcadores = ", ".join([marcador_parametro] * len(colunas))
    cur.executemany(
        "INSERT INTO %s%s (%s) VALUES (%s)" % (prefixo, tabela, colunas_sql, marcadores),
        linhas)


def aplicar_transicoes_situacao(conn, fechar, abrir, marcador_parametro="%s"):
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur = conn.cursor()
    for linha in fechar:
        cur.execute(
            "UPDATE %sitem_situacao_hist SET ate = %s WHERE obra = %s AND "
            "solicitacao = %s AND sequencia = %s AND fornecedor = %s AND desde = %s"
            % (prefixo, marcador_parametro, marcador_parametro, marcador_parametro,
               marcador_parametro, marcador_parametro, marcador_parametro),
            (linha["ate"], linha["obra"], linha["solicitacao"], linha["sequencia"],
             linha["fornecedor"], linha["desde"]))
    if abrir:
        colunas = ["obra", "solicitacao", "sequencia", "fornecedor", "situacao",
                  "etapa", "desde"]
        linhas = [tuple(a[c] for c in colunas) for a in abrir]
        inserir_historico(conn, "item_situacao_hist", colunas, linhas,
                          marcador_parametro=marcador_parametro)


def buscar_abertas(conn, obra, marcador_parametro="%s"):
    """Le as linhas da trilha ainda vigentes (ate IS NULL) para uma obra.
    Devolve um dict chaveado por (obra, solicitacao, sequencia, fornecedor),
    no formato que situacao.calcular_transicoes espera em 'abertas'."""
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur = conn.cursor()
    cur.execute(
        "SELECT obra, solicitacao, sequencia, fornecedor, situacao, etapa, desde "
        "FROM %sitem_situacao_hist WHERE obra = %s AND ate IS NULL"
        % (prefixo, marcador_parametro), (obra,))
    resultado = {}
    for linha in cur.fetchall():
        obra_l, solicitacao, sequencia, fornecedor, situacao, etapa, desde = linha
        chave = (obra_l, solicitacao, sequencia, fornecedor)
        resultado[chave] = {"obra": obra_l, "solicitacao": solicitacao,
                            "sequencia": sequencia, "fornecedor": fornecedor,
                            "situacao": situacao, "etapa": etapa, "desde": desde}
    return resultado


def registrar_carga(conn, relatorio, arquivo, data_iso, resultado,
                    bloqueado=False, motivo=None, marcador_parametro="%s"):
    prefixo = "" if marcador_parametro == "?" else "mega."
    cur = conn.cursor()
    m = marcador_parametro
    # executar.executar_relatorio devolve "falhou" como lista de dicts
    # {"obra": ..., "motivo": ...}; obras_falhou guarda so os codigos de obra,
    # no mesmo formato de obras_ok/obras_sem_movimento.
    obras_falhou = [f["obra"] if isinstance(f, dict) else f
                    for f in resultado.get("falhou", [])]
    obras_ok = resultado.get("ok", [])
    obras_sem_movimento = resultado.get("sem_movimento", [])
    # As colunas sao TEXT[] no Postgres real: psycopg adapta list[str] direto
    # para array, sem passar por texto — json.dumps() produz uma STRING tipo
    # '["340"]', que o Postgres rejeita como "malformed array literal" (nao e
    # sintaxe de array, e sintaxe de JSON). Confirmado ao vivo contra um
    # Postgres 16 real em 2026-09-08. O SQLite dos testes usa colunas TEXT
    # simples, que so aceitam string — por isso json.dumps() so aqui.
    if marcador_parametro == "?":
        obras_ok = json.dumps(obras_ok)
        obras_sem_movimento = json.dumps(obras_sem_movimento)
        obras_falhou = json.dumps(obras_falhou)
    cur.execute(
        "INSERT INTO %scarga (relatorio, arquivo, data_extracao, obras_ok, "
        "obras_sem_movimento, obras_falhou, bloqueado, motivo_bloqueio) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)" % (prefixo, m, m, m, m, m, m, m, m),
        (relatorio, arquivo, data_iso, obras_ok, obras_sem_movimento, obras_falhou,
         bloqueado, motivo))
