# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import biblioteca
from visao import Caixa


class _Relogio:
    """Tempo falso: sleep() avanca o relogio, sem esperar de verdade."""
    def __init__(self):
        self.t = 1000.0

    def time(self):
        return self.t

    def sleep(self, s):
        self.t += s


class _Pagina:
    def __init__(self):
        self.cliques = []
        self.teclas = []
        self.mouse = self
        self.keyboard = self

    def na_barra(self):
        """Cliques na barra de tarefas (o robo tambem clica em (20,20) p/ acordar a tela)."""
        return [c for c in self.cliques if c[1] >= 840]

    def click(self, x, y, **kw):
        self.cliques.append((x, y))

    def press(self, tecla):
        self.teclas.append(tecla)

    def bring_to_front(self):
        pass

    def screenshot(self, path):
        pass


class _Visao:
    """Tela vazia, so com 'Mega ERP' na barra de tarefas; desenha apos N cliques."""
    def __init__(self, pagina, cliques_para_desenhar):
        self.pagina = pagina
        self.n = cliques_para_desenhar

    def _desenhada(self):
        return len(self.pagina.na_barra()) >= self.n

    def capturar(self, regiao=None, cutucar=False, ponto=None):
        return object()

    def palavras_todas(self, img):
        if self._desenhada():
            return [{"texto": "palavra%d" % i, "conf": 90, "x": 0, "y": 0}
                    for i in range(25)]
        return []

    def achar_texto(self, alvo, img=None, regiao=None, **kw):
        if alvo == "Mega ERP" and not self._desenhada():
            return Caixa(135, 880, 60, 14, "Mega ERP", 90)
        return None


def _operador(monkeypatch, tmp_path, cliques_para_desenhar):
    relogio = _Relogio()
    monkeypatch.setattr(biblioteca, "time", relogio)
    monkeypatch.chdir(tmp_path)
    pagina = _Pagina()
    op = biblioteca.Operador(pagina, visao=_Visao(pagina, cliques_para_desenhar),
                             pasta_downloads=tmp_path / "dl", log=lambda m: None)
    return op, pagina


def test_tela_vazia_clica_no_mega_erp_da_barra_de_tarefas(monkeypatch, tmp_path):
    op, pagina = _operador(monkeypatch, tmp_path, cliques_para_desenhar=1)
    assert op.esperar_erp_pronto(timeout=300) == "conteudo"
    assert pagina.na_barra() == [(165, 887)]       # centro do 'Mega ERP' na barra


def test_nunca_usa_alt_tab_e_so_reclica_apos_20s(monkeypatch, tmp_path):
    """O clique no item da barra alterna minimizar/restaurar: o 2o clique so
    vem depois de 20s, e sem Alt+Tab no meio (que tirava o foco do ERP)."""
    op, pagina = _operador(monkeypatch, tmp_path, cliques_para_desenhar=2)
    t0 = biblioteca.time.t
    assert op.esperar_erp_pronto(timeout=300) == "conteudo"
    assert len(pagina.na_barra()) == 2
    assert "Alt+Tab" not in pagina.teclas
    assert biblioteca.time.t - t0 >= 20


def test_se_nada_desenha_desiste_no_timeout_com_cliques_espacados(monkeypatch, tmp_path):
    op, pagina = _operador(monkeypatch, tmp_path, cliques_para_desenhar=10**6)
    with pytest.raises(biblioteca.FalhaDeEtapa):
        op.esperar_erp_pronto(timeout=100)
    assert 1 < len(pagina.na_barra()) <= 6        # ~1 clique a cada 20s, nao a cada ciclo
