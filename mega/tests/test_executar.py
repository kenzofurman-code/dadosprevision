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
        self.limpezas = 0
        self.pagina = _PaginaFalsa()
        self._falha_trocar = set(falha_trocar)

    def trocar_empresa(self, codigo, nome=None):
        self.trocas.append(codigo)
        if codigo in self._falha_trocar:
            raise RuntimeError("nao consegui abrir a arvore de empresas")

    def fechar_modais_ou_janelas_ativas(self):
        self.limpezas += 1
        return False


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


def test_troca_de_empresa_tenta_de_novo_e_a_obra_nao_cai(monkeypatch):
    """BUG REAL 2026-10-10: a arvore de empresas abriu mas o robo desistiu cedo,
    e a obra 340 inteira falhou. A segunda tentativa deve salvar a obra."""
    chamadas = []
    monkeypatch.setattr(executar, "_rodar_relatorio_na_obra_ativa",
                        lambda op, v, rel, obra, d, p: chamadas.append(obra["codigo"]) or ("sem_movimento", []))

    class OperadorFlaky(_OperadorFalso):
        def trocar_empresa(self, codigo, nome=None):
            self.trocas.append(codigo)
            if codigo == "200" and self.trocas.count("200") == 1:
                raise RuntimeError("nao consegui abrir a arvore de empresas")

    op = OperadorFlaky()
    resultado = executar.executar_por_obra(
        op, v=object(), s=object(), relatorios=[REL_A], obras=OBRAS,
        data_iso="2026-10-10", pasta=Path("."), falhas_dir=Path("."), log=_sem_log)

    assert op.trocas == ["100", "200", "200", "300"]
    assert op.limpezas == 1          # limpou o estado entre as tentativas
    assert chamadas == ["100", "200", "300"]
    assert resultado["rel_a"]["falhou"] == []


def test_troca_desiste_apos_tres_tentativas(monkeypatch):
    monkeypatch.setattr(executar, "_rodar_relatorio_na_obra_ativa",
                        lambda *a: ("sem_movimento", []))
    op = _OperadorFalso(falha_trocar={"200"})
    executar.executar_por_obra(
        op, v=object(), s=object(), relatorios=[REL_A], obras=OBRAS,
        data_iso="2026-10-10", pasta=Path("."), falhas_dir=Path("."), log=_sem_log)
    assert op.trocas.count("200") == 3


def _rodar_com_falha_em(monkeypatch, falha_em, op):
    """Roda 1 obra com 3 relatorios; o relatorio `falha_em` levanta erro."""
    rels = [{"id": "r1", "exportacoes": []}, {"id": "r2", "exportacoes": []},
            {"id": "r3", "exportacoes": []}]
    chamadas = []

    def rodar(op_, v, rel, obra, data_iso, pasta):
        chamadas.append(rel["id"])
        if rel["id"] == falha_em:
            raise RuntimeError("o painel de busca de telas nao abriu")
        return ("sem_movimento", [])

    monkeypatch.setattr(executar, "_rodar_relatorio_na_obra_ativa", rodar)
    resultado = executar.executar_por_obra(
        op, v=object(), s=object(), relatorios=rels, obras=OBRAS[:1],
        data_iso="2026-10-10", pasta=Path("."), falhas_dir=Path("."), log=_sem_log)
    return resultado, chamadas


def test_falha_de_relatorio_reinicia_o_estado_antes_do_proximo(monkeypatch):
    """Cascata de 2026-10-09/10: um modal deixado por um relatorio derrubava
    todos os seguintes. Apos a falha, limpa a tela e troca de empresa de novo."""
    op = _OperadorFalso()
    resultado, chamadas = _rodar_com_falha_em(monkeypatch, "r1", op)

    assert chamadas == ["r1", "r2", "r3"]
    assert op.trocas == ["100", "100"]       # troca inicial + recuperacao
    assert op.limpezas == 1
    assert [f["obra"] for f in resultado["r1"]["falhou"]] == ["100"]
    assert resultado["r2"]["sem_movimento"] == ["100"]


def test_falha_no_ultimo_relatorio_nao_gasta_recuperacao(monkeypatch):
    op = _OperadorFalso()
    _rodar_com_falha_em(monkeypatch, "r3", op)
    assert op.trocas == ["100"]


def test_recuperacao_que_falha_reinicia_a_sessao_e_depois_desiste(monkeypatch):
    class OperadorQuebra(_OperadorFalso):
        def trocar_empresa(self, codigo, nome=None):
            self.trocas.append(codigo)
            if len(self.trocas) > 1:          # a troca inicial passa; depois nao
                raise RuntimeError("nao consegui abrir a arvore de empresas")

    reconexoes = []
    novo = OperadorQuebra()
    novo.trocas.append("antes")             # a sessao nova tambem nao consegue trocar
    monkeypatch.setattr(executar, "reconectar_sessao",
                        lambda s, log: reconexoes.append(1) or (novo, object()))
    resultado, chamadas = _rodar_com_falha_em(monkeypatch, "r1", OperadorQuebra())

    assert chamadas == ["r1"]                  # r2 e r3 nem foram tentados
    assert len(reconexoes) == 1
    assert [f["obra"] for f in resultado["r2"]["falhou"]] == ["100"]
    assert [f["obra"] for f in resultado["r3"]["falhou"]] == ["100"]
