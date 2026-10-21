# -*- coding: utf-8 -*-
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod
import retry


class _Pagina:
    def is_closed(self):
        return False


class _Sessao:
    def abrir(self): pass
    def entrar(self, **kw): return "login efetuado"
    def abrir_erp(self): return object()
    def fechar(self): pass


class _Operadores:
    """Fabrica de Operador falso: a n-esima instancia falha se n estiver em `falham`."""
    def __init__(self, falham=()):
        self.falham = set(falham)
        self.criados = 0
        self.trocas = []

    def __call__(self, erp, visao=None, log=None):
        self.criados += 1
        numero = self.criados
        fabrica = self

        class Op:
            pagina = _Pagina()

            def esperar_erp_pronto(self, timeout=300):
                if numero in fabrica.falham:
                    raise RuntimeError("o ERP nao ficou pronto em 300s")

            def trocar_empresa(self, codigo, nome=None):
                fabrica.trocas.append(codigo)

            def fechar_modais_ou_janelas_ativas(self): pass
            def encerrar_sessao(self): pass

        return Op()


def _preparar(monkeypatch, falham):
    ops = _Operadores(falham)
    monkeypatch.setattr(retry, "Operador", ops)
    monkeypatch.setattr(retry, "Visao", lambda *a, **k: object())
    return ops


def test_abrir_sessao_tenta_de_novo_quando_o_erp_nao_fica_pronto(monkeypatch):
    """Retry de 2026-10-20: o ERP veio vazio, o retry desistiu na 1a espera."""
    ops = _preparar(monkeypatch, falham={1, 2})
    s, op, v = retry._abrir_sessao_erp(_Sessao)
    assert ops.criados == 3 and op is not None


def test_abrir_sessao_desiste_apos_tres_tentativas(monkeypatch):
    ops = _preparar(monkeypatch, falham={1, 2, 3})
    try:
        retry._abrir_sessao_erp(_Sessao)
        assert False, "deveria falhar"
    except RuntimeError as e:
        assert "nao ficou pronto" in str(e)
    assert ops.criados == 3


def test_obra_sem_sessao_nao_derruba_as_demais(monkeypatch):
    """Antes, a falha do re-login entre obras abortava o retry inteiro."""
    ops = _preparar(monkeypatch, falham={2, 3, 4})       # sessoes da 2a obra
    cfg = cfgmod.carregar()
    monkeypatch.setattr(retry, "identificar_pendencias", lambda *a, **k: {
        "340": ["itens_solicitados"], "410": ["itens_solicitados"], "430": ["itens_solicitados"]})
    monkeypatch.setattr(retry, "_rodar_relatorio_na_obra_ativa",
                        lambda *a, **k: ("ok", []))
    monkeypatch.setattr(retry, "carregar_relatorio", lambda *a, **k: [])
    monkeypatch.setattr(retry, "purgar_arquivos", lambda *a, **k: None)

    r = retry.rodar_retry(cfg, conectar_fn=lambda: MagicMock(), abrir_sessao_fn=_Sessao,
                          data_iso="2026-10-20", aplicar_esquema=False)

    res = r["resultados"]
    assert res["340"]["itens_solicitados"] == "OK"
    assert res["410"]["itens_solicitados"] == "FALHOU_SESSAO"
    assert res["430"]["itens_solicitados"] == "OK"


def test_falha_de_relatorio_reinicia_o_estado_antes_do_proximo(monkeypatch):
    ops = _preparar(monkeypatch, falham=())
    cfg = cfgmod.carregar()
    monkeypatch.setattr(retry, "identificar_pendencias", lambda *a, **k: {
        "340": ["itens_solicitados", "visualizacao_itens"]})
    chamados = []

    def rodar(op, v, rel, obra, data_iso, pasta):
        chamados.append(rel["id"])
        if rel["id"] == "itens_solicitados":
            raise RuntimeError("o painel de busca de telas nao abriu")
        return ("ok", [])

    monkeypatch.setattr(retry, "_rodar_relatorio_na_obra_ativa", rodar)
    monkeypatch.setattr(retry, "carregar_relatorio", lambda *a, **k: [])
    monkeypatch.setattr(retry, "purgar_arquivos", lambda *a, **k: None)

    r = retry.rodar_retry(cfg, conectar_fn=lambda: MagicMock(), abrir_sessao_fn=_Sessao,
                          data_iso="2026-10-20", aplicar_esquema=False)

    assert chamados == ["itens_solicitados", "visualizacao_itens"]
    assert ops.trocas == ["340", "340"]        # troca inicial + recuperacao apos a falha
    assert r["resultados"]["340"] == {"itens_solicitados": "FALHOU", "visualizacao_itens": "OK"}
