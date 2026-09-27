# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import sessao


def _proc_falso(raiz, pid, ppid):
    d = raiz / str(pid)
    d.mkdir()
    # formato real do /proc/<pid>/stat: "pid (comm) estado ppid ..."
    (d / "stat").write_text("%d (chrome (x)) S %d 1 1" % (pid, ppid))


def test_descendentes_pega_a_arvore_inteira_e_nada_alem(tmp_path):
    _proc_falso(tmp_path, 100, 1)     # o python
    _proc_falso(tmp_path, 200, 100)   # driver do playwright
    _proc_falso(tmp_path, 300, 200)   # chrome
    _proc_falso(tmp_path, 301, 300)   # renderer do chrome
    _proc_falso(tmp_path, 999, 1)     # processo alheio
    assert sorted(sessao._descendentes(100, tmp_path)) == [200, 300, 301]


def test_descendentes_sem_proc_devolve_vazio(tmp_path):
    assert sessao._descendentes(100, tmp_path / "nao_existe") == []


class _Travado:
    """Imita objeto do Playwright cujo navegador ja morreu: tudo levanta."""
    pages = property(lambda self: (_ for _ in ()).throw(RuntimeError("morto")))

    def is_connected(self):
        return False

    def close(self):
        raise RuntimeError("Target page, context or browser has been closed")

    def stop(self):
        raise RuntimeError("driver morto")


def test_fechar_mata_os_filhos_mesmo_quando_o_playwright_falha(monkeypatch):
    mortos = []
    monkeypatch.setattr(sessao, "_descendentes", lambda pid: [200, 300, 301])
    monkeypatch.setattr(sessao, "_matar", mortos.append)

    s = sessao.Sessao()
    s._pw = s._nav = s._ctx = _Travado()
    s.pagina = object()
    s.fechar()

    assert mortos == [200, 300, 301]
    assert s._pw is s._nav is s._ctx is s.pagina is None


def test_fechar_nao_chama_close_de_navegador_desconectado(monkeypatch):
    # close() num navegador travado pode bloquear para sempre; se ja caiu,
    # pula direto para o stop() + kill.
    monkeypatch.setattr(sessao, "_descendentes", lambda pid: [])
    chamadas = []

    class Nav(_Travado):
        def close(self):
            chamadas.append("nav.close")

    s = sessao.Sessao()
    s._nav = Nav()
    s._ctx = _Travado()
    s._pw = _Travado()
    s.fechar()
    assert chamadas == []


def test_fechar_duas_vezes_nao_quebra(monkeypatch):
    monkeypatch.setattr(sessao, "_descendentes", lambda pid: [])
    s = sessao.Sessao()
    s.fechar()
    s.fechar()
