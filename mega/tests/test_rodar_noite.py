# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod
import rodar_noite


class _ConexaoFalsa:
    def __init__(self):
        self.rollbacks = 0

    def commit(self):
        pass

    def rollback(self):
        self.rollbacks += 1

    def execute(self, sql):
        # dubla o caminho psycopg de banco.aplicar_esquema (sem
        # 'executescript'); so precisa nao explodir, o schema real e testado
        # em tests/test_banco.py.
        pass


class _SessaoFalsa:
    """Dubla Sessao: nao abre navegador nenhum. Registra o que foi chamado."""
    def __init__(self):
        self.chamadas = []

    def entrar(self):
        self.chamadas.append("entrar")
        return "login efetuado"

    def abrir_erp(self):
        self.chamadas.append("abrir_erp")
        return "pagina-falsa"


def test_rodar_relatorios_da_noite_roda_os_4_relatorios_em_uma_unica_sessao(monkeypatch):
    cfg = cfgmod.carregar()
    chamadas_executar = []

    def executar_relatorio_falso(op, v, s, rel, obras, data_iso, pasta, falhas_dir, log):
        chamadas_executar.append(rel["id"])
        return {"ok": [], "sem_movimento": [o["codigo"] for o in obras], "falhou": []}

    def carregar_relatorio_falso(cfg, conn, rel_id, data_iso, pasta, resultado, **kw):
        return [{"arquivo": rel_id, "estado": "OK", "obras": 0, "motivo": None}]

    def purgar_arquivos_falso(pasta, relatos, data_iso):
        return []

    monkeypatch.setattr(rodar_noite, "executar_relatorio", executar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "carregar_relatorio", carregar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "purgar_arquivos", purgar_arquivos_falso)
    class _OperadorFalso:
        def __init__(self):
            self.chamadas = []

        def esperar_erp_pronto(self, timeout=None):
            self.chamadas.append("esperar_erp_pronto")

        def encerrar_sessao(self):
            self.chamadas.append("encerrar_sessao")

    operador_falso = _OperadorFalso()

    monkeypatch.setattr(rodar_noite, "Operador", lambda *a, **k: operador_falso)
    monkeypatch.setattr(rodar_noite, "Visao", lambda *a, **k: object())

    sessao_falsa = _SessaoFalsa()
    resultado = rodar_noite.rodar_relatorios_da_noite(
        cfg, conectar_fn=lambda: _ConexaoFalsa(),
        abrir_sessao_fn=lambda: sessao_falsa, data_iso="2026-09-07")

    assert chamadas_executar == ["itens_solicitados", "analise_saldo_solicitacao",
                                 "visualizacao_itens", "pedidos_compra"]
    assert sessao_falsa.chamadas == ["entrar", "abrir_erp"]
    assert set(resultado.keys()) == {"itens_solicitados", "analise_saldo_solicitacao",
                                     "visualizacao_itens", "pedidos_compra"}
    # Esperar o ERP montar a area de trabalho antes do primeiro relatorio, e
    # devolver a sessao ao final — nao adianta rodar a noite inteira se a
    # sessao do ERP fica pendurada.
    assert operador_falso.chamadas == ["esperar_erp_pronto", "encerrar_sessao"]


def test_carga_que_explode_nao_derruba_os_demais_relatorios(monkeypatch):
    """Uma falha de carga precisa ser revertida e isolada: os relatorios
    seguintes continuam, e a sessao do ERP e encerrada mesmo assim."""
    cfg = cfgmod.carregar()
    conn = _ConexaoFalsa()

    def executar_relatorio_falso(op, v, s, rel, obras, data_iso, pasta, falhas_dir, log):
        return {"ok": [], "sem_movimento": [], "falhou": []}

    def carregar_relatorio_falso(cfg, conn, rel_id, data_iso, pasta, resultado, **kw):
        if rel_id == "itens_solicitados":
            raise RuntimeError("coluna desconhecida")
        return [{"arquivo": rel_id, "estado": "OK", "obras": 0, "motivo": None}]

    monkeypatch.setattr(rodar_noite, "executar_relatorio", executar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "carregar_relatorio", carregar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "purgar_arquivos", lambda *a, **k: [])

    class _OperadorFalso:
        def __init__(self):
            self.encerrou = False

        def esperar_erp_pronto(self, timeout=None):
            pass

        def encerrar_sessao(self):
            self.encerrou = True

    operador_falso = _OperadorFalso()
    monkeypatch.setattr(rodar_noite, "Operador", lambda *a, **k: operador_falso)
    monkeypatch.setattr(rodar_noite, "Visao", lambda *a, **k: object())

    resultado = rodar_noite.rodar_relatorios_da_noite(
        cfg, conectar_fn=lambda: conn, abrir_sessao_fn=lambda: _SessaoFalsa(),
        data_iso="2026-09-07")

    assert conn.rollbacks == 1
    assert resultado["itens_solicitados"]["carga"][0]["estado"] == "ERRO"
    # os 3 relatorios seguintes rodaram apesar da falha do primeiro
    assert [resultado[r]["carga"][0]["estado"]
            for r in rodar_noite.ORDEM_RELATORIOS[1:]] == ["OK", "OK", "OK"]
    assert operador_falso.encerrou


def test_esperar_erp_pronto_estourando_ainda_encerra_a_sessao(monkeypatch):
    """esperar_erp_pronto() fica DENTRO do try/finally: se ela levantar (o
    proprio cenario para o qual ela existe — o ERP nao ficou pronto a tempo),
    a sessao ainda precisa ser liberada, senao a noite seguinte trava."""
    cfg = cfgmod.carregar()

    class _OperadorFalso:
        def __init__(self):
            self.encerrou = False

        def esperar_erp_pronto(self, timeout=None):
            raise TimeoutError("o ERP nao ficou pronto em 300s")

        def encerrar_sessao(self):
            self.encerrou = True

    operador_falso = _OperadorFalso()
    monkeypatch.setattr(rodar_noite, "Operador", lambda *a, **k: operador_falso)
    monkeypatch.setattr(rodar_noite, "Visao", lambda *a, **k: object())

    try:
        rodar_noite.rodar_relatorios_da_noite(
            cfg, conectar_fn=lambda: _ConexaoFalsa(),
            abrir_sessao_fn=lambda: _SessaoFalsa(), data_iso="2026-09-07")
        assert False, "deveria ter propagado o TimeoutError"
    except TimeoutError:
        pass

    assert operador_falso.encerrou


def test_falha_ao_encerrar_sessao_nao_esconde_o_resultado_da_noite(monkeypatch):
    """encerrar_sessao() e guardado: se ela levantar (pagina ja fechada por
    uma queda anterior), a excecao dela nao pode substituir o retorno e
    apagar o que ja foi apurado nesta noite."""
    cfg = cfgmod.carregar()

    def executar_relatorio_falso(op, v, s, rel, obras, data_iso, pasta, falhas_dir, log):
        return {"ok": [], "sem_movimento": [], "falhou": []}

    def carregar_relatorio_falso(cfg, conn, rel_id, data_iso, pasta, resultado, **kw):
        return [{"arquivo": rel_id, "estado": "OK", "obras": 0, "motivo": None}]

    monkeypatch.setattr(rodar_noite, "executar_relatorio", executar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "carregar_relatorio", carregar_relatorio_falso)
    monkeypatch.setattr(rodar_noite, "purgar_arquivos", lambda *a, **k: [])

    class _OperadorFalso:
        def esperar_erp_pronto(self, timeout=None):
            pass

        def encerrar_sessao(self):
            raise RuntimeError("pagina ja fechada")

    monkeypatch.setattr(rodar_noite, "Operador", lambda *a, **k: _OperadorFalso())
    monkeypatch.setattr(rodar_noite, "Visao", lambda *a, **k: object())

    resultado = rodar_noite.rodar_relatorios_da_noite(
        cfg, conectar_fn=lambda: _ConexaoFalsa(),
        abrir_sessao_fn=lambda: _SessaoFalsa(), data_iso="2026-09-07")

    assert set(resultado.keys()) == set(rodar_noite.ORDEM_RELATORIOS)
    assert resultado["itens_solicitados"]["carga"][0]["estado"] == "OK"
