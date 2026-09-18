# -*- coding: utf-8 -*-
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock

try:
    import pytest
except ImportError:
    class MockPytest:
        @staticmethod
        def fixture(fn):
            return fn
    pytest = MockPytest()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod
import retry


@pytest.fixture
def mock_conn():
    conn = sqlite3.connect(":memory:")
    # Criar schema mega simulado em SQLite (sem schema prefix)
    conn.execute("CREATE TABLE visualizacao_itens (obra TEXT, data_extracao TEXT)")
    conn.execute("CREATE TABLE pedidos_compra (obra TEXT, data_extracao TEXT)")
    conn.execute(
        "CREATE TABLE carga (id INTEGER PRIMARY KEY, relatorio TEXT, arquivo TEXT, "
        "data_extracao TEXT, obras_ok TEXT, obras_sem_movimento TEXT, "
        "obras_falhou TEXT, bloqueado BOOLEAN, motivo_bloqueio TEXT)"
    )
    return conn


def test_identificar_pendencias_quando_tudo_ok(mock_conn, tmp_path):
    cfg = cfgmod.carregar()
    obras = [o["codigo"] for o in cfgmod.obras(cfg)]
    data_iso = "2026-09-18"

    for ob in obras:
        mock_conn.execute("INSERT INTO visualizacao_itens VALUES (?, ?)", (ob, data_iso))
        mock_conn.execute("INSERT INTO pedidos_compra VALUES (?, ?)", (ob, data_iso))

    import json
    obras_json = json.dumps(obras)
    mock_conn.execute(
        "INSERT INTO carga (relatorio, data_extracao, obras_ok, obras_sem_movimento, obras_falhou, bloqueado) "
        "VALUES ('itens_solicitados', ?, ?, '[]', '[]', 0)", (data_iso, obras_json)
    )
    mock_conn.execute(
        "INSERT INTO carga (relatorio, data_extracao, obras_ok, obras_sem_movimento, obras_falhou, bloqueado) "
        "VALUES ('analise_saldo_solicitacao', ?, ?, '[]', '[]', 0)", (data_iso, obras_json)
    )

    pendencias = retry.identificar_pendencias(cfg, mock_conn, data_iso, pasta=tmp_path, marcador_parametro="?")
    # Como tudo ja esta gravado, nao deve haver nenhuma pendencia
    assert pendencias == {}


def test_identificar_pendencias_quando_falhou_em_uma_obra(mock_conn, tmp_path):
    cfg = cfgmod.carregar()
    obras = [o["codigo"] for o in cfgmod.obras(cfg)]
    data_iso = "2026-09-18"

    # Todas as obras em visualizacao_itens
    for ob in obras:
        mock_conn.execute("INSERT INTO visualizacao_itens VALUES (?, ?)", (ob, data_iso))

    # pedidos_compra tem todas exceto a 650
    for ob in obras:
        if ob != "650":
            mock_conn.execute("INSERT INTO pedidos_compra VALUES (?, ?)", (ob, data_iso))

    # itens_solicitados e analise_saldo completos
    import json
    obras_json = json.dumps(obras)
    mock_conn.execute(
        "INSERT INTO carga (relatorio, data_extracao, obras_ok, obras_sem_movimento, obras_falhou, bloqueado) "
        "VALUES ('itens_solicitados', ?, ?, '[]', '[]', 0)", (data_iso, obras_json)
    )
    mock_conn.execute(
        "INSERT INTO carga (relatorio, data_extracao, obras_ok, obras_sem_movimento, obras_falhou, bloqueado) "
        "VALUES ('analise_saldo_solicitacao', ?, ?, '[]', '[]', 0)", (data_iso, obras_json)
    )

    pendencias = retry.identificar_pendencias(cfg, mock_conn, data_iso, pasta=tmp_path, marcador_parametro="?")
    # Apenas a 650 deve ter pedidos_compra pendente
    assert "650" in pendencias
    assert pendencias["650"] == ["pedidos_compra"]
    assert len(pendencias) == 1


def test_rodar_retry_nao_abre_sessao_quando_sem_pendencias(mock_conn, tmp_path):
    cfg = cfgmod.carregar()
    obras = [o["codigo"] for o in cfgmod.obras(cfg)]
    data_iso = "2026-09-18"

    for ob in obras:
        mock_conn.execute("INSERT INTO visualizacao_itens VALUES (?, ?)", (ob, data_iso))
        mock_conn.execute("INSERT INTO pedidos_compra VALUES (?, ?)", (ob, data_iso))

    import json
    obras_json = json.dumps(obras)
    mock_conn.execute(
        "INSERT INTO carga (relatorio, data_extracao, obras_ok, obras_sem_movimento, obras_falhou, bloqueado) "
        "VALUES ('itens_solicitados', ?, ?, '[]', '[]', 0)", (data_iso, obras_json)
    )
    mock_conn.execute(
        "INSERT INTO carga (relatorio, data_extracao, obras_ok, obras_sem_movimento, obras_falhou, bloqueado) "
        "VALUES ('analise_saldo_solicitacao', ?, ?, '[]', '[]', 0)", (data_iso, obras_json)
    )

    sessao_mock = MagicMock()
    conectar_fn = lambda: mock_conn

    # Chamada de rodar_retry
    resultado = retry.rodar_retry(cfg, conectar_fn=conectar_fn, abrir_sessao_fn=sessao_mock, data_iso=data_iso,
                                  marcador_parametro="?", aplicar_esquema=False)

    assert resultado["status"] == "OK"
    assert resultado["pendencias"] == {}
    # Nao pode ter aberto a sessao do navegador/ERP!
    sessao_mock.assert_not_called()
