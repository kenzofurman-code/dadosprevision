# -*- coding: utf-8 -*-
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import executar


class _PaginaFalsa:
    def __init__(self):
        self._fechada = False

    def is_closed(self):
        return self._fechada


class _OperadorFalso:
    """Dubla Operador: registra trocas de empresa, simula falha em algumas."""
    def __init__(self, falha_trocar=()):
        self.trocas = []
        self.pagina = _PaginaFalsa()
        self._falha_trocar = set(falha_trocar)

    def trocar_empresa(self, codigo, nome=None):
        self.trocas.append(codigo)
        if codigo in self._falha_trocar:
            raise RuntimeError("nao consegui abrir a arvore de empresas")


REL_A = {"id": "rel_a", "exportacoes": []}
REL_B = {"id": "rel_b", "exportacoes": []}

OBRAS = [{"codigo": "100", "nome": "Obra 100"},
        {"codigo": "200", "nome": "Obra 200"},
        {"codigo": "300", "nome": "Obra 300"}]


def _sem_log(msg):
    pass


def test_executar_por_obra_troca_de_empresa_uma_vez_por_obra(monkeypatch):
    """A motivacao inteira de executar_por_obra: trocar de empresa UMA vez
    por obra, nao uma vez por (obra, relatorio) -- reduz de 32 para 8 trocas
    numa noite de 4 relatorios x 8 obras (ver commit de 2026-09-14)."""
    chamadas = []

    def rodar_falso(op, v, rel, obra, data_iso, pasta):
        chamadas.append((obra["codigo"], rel["id"]))
        return ("sem_movimento", [])

    monkeypatch.setattr(executar, "_rodar_relatorio_na_obra_ativa", rodar_falso)

    op = _OperadorFalso()
    resultado = executar.executar_por_obra(
        op, v=object(), s=object(), relatorios=[REL_A, REL_B], obras=OBRAS,
        data_iso="2026-09-14", pasta=Path("."), falhas_dir=Path("."), log=_sem_log)

    assert op.trocas == ["100", "200", "300"]
    assert chamadas == [("100", "rel_a"), ("100", "rel_b"),
                        ("200", "rel_a"), ("200", "rel_b"),
                        ("300", "rel_a"), ("300", "rel_b")]
    assert resultado["rel_a"]["sem_movimento"] == ["100", "200", "300"]
    assert resultado["rel_b"]["sem_movimento"] == ["100", "200", "300"]


def test_executar_por_obra_falha_na_troca_marca_todos_relatorios_da_obra(monkeypatch):
    """Se a troca de empresa falha, nenhum relatorio daquela obra e sequer
    tentado -- todos ficam marcados como falhou, e a proxima obra segue
    normalmente (uma obra ruim nao derruba a noite inteira)."""
    chamadas = []

    def rodar_falso(op, v, rel, obra, data_iso, pasta):
        chamadas.append((obra["codigo"], rel["id"]))
        return ("sem_movimento", [])

    monkeypatch.setattr(executar, "_rodar_relatorio_na_obra_ativa", rodar_falso)

    op = _OperadorFalso(falha_trocar={"200"})
    resultado = executar.executar_por_obra(
        op, v=object(), s=object(), relatorios=[REL_A, REL_B], obras=OBRAS,
        data_iso="2026-09-14", pasta=Path("."), falhas_dir=Path("."), log=_sem_log)

    # obra 200 nunca teve nenhum relatorio tentado
    assert ("200", "rel_a") not in chamadas
    assert ("200", "rel_b") not in chamadas
    # mas 100 e 300 rodaram normalmente
    assert ("100", "rel_a") in chamadas
    assert ("300", "rel_b") in chamadas
    assert [f["obra"] for f in resultado["rel_a"]["falhou"]] == ["200"]
    assert [f["obra"] for f in resultado["rel_b"]["falhou"]] == ["200"]


def test_executar_por_obra_respeita_tempo_limite(monkeypatch):
    """Sem tempo_limite, uma execucao lenta pode rodar indefinidamente --
    BUG REAL, 2026-09-14 (~24h presa, consumindo a CPU da VPS inteira). Com
    o limite ja estourado, nenhuma obra nova deve comecar."""
    chamadas = []

    def rodar_falso(op, v, rel, obra, data_iso, pasta):
        chamadas.append((obra["codigo"], rel["id"]))
        return ("sem_movimento", [])

    monkeypatch.setattr(executar, "_rodar_relatorio_na_obra_ativa", rodar_falso)

    op = _OperadorFalso()
    resultado = executar.executar_por_obra(
        op, v=object(), s=object(), relatorios=[REL_A], obras=OBRAS,
        data_iso="2026-09-14", pasta=Path("."), falhas_dir=Path("."), log=_sem_log,
        tempo_limite=time.time() - 1)

    assert chamadas == []
    assert op.trocas == []
    assert resultado["rel_a"] == {"ok": [], "sem_movimento": [], "falhou": []}
