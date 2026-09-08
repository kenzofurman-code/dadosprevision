# -*- coding: utf-8 -*-
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SCHEMA = RAIZ / "sql" / "schema_mega.sql"


def test_schema_existe_e_nao_esta_vazio():
    assert SCHEMA.exists()
    texto = SCHEMA.read_text(encoding="utf-8")
    assert len(texto) > 200


def test_schema_e_idempotente_todo_create_usa_if_not_exists():
    texto = SCHEMA.read_text(encoding="utf-8").upper()
    for linha in texto.splitlines():
        linha = linha.strip()
        if linha.startswith("CREATE TABLE") or linha.startswith("CREATE SCHEMA"):
            assert "IF NOT EXISTS" in linha, (
                "instrucao nao idempotente (rodar duas vezes vai falhar): %s" % linha)


def test_schema_declara_todas_as_tabelas_da_spec():
    texto = SCHEMA.read_text(encoding="utf-8")
    for tabela in ("obra_projeto", "itens_solicitados", "visualizacao_itens",
                  "item_situacao_hist", "pedidos_compra", "analise_realizado",
                  "analise_pedidos_hist", "analise_contratos_hist", "carga"):
        assert ("mega.%s" % tabela) in texto, "tabela ausente: %s" % tabela


def test_tabelas_atuais_tem_coluna_obra_para_permitir_delete_por_obra():
    texto = SCHEMA.read_text(encoding="utf-8")
    for tabela in ("itens_solicitados", "visualizacao_itens", "pedidos_compra",
                  "analise_realizado"):
        # Localiza o bloco CREATE TABLE da tabela e confirma a coluna 'obra'.
        inicio = texto.index("mega.%s (" % tabela)
        fim = texto.index(");", inicio)
        bloco = texto[inicio:fim]
        assert "obra " in bloco or "obra\t" in bloco, (
            "tabela %s sem coluna 'obra' — DELETE por obra fica impossivel" % tabela)
