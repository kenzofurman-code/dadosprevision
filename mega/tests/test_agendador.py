# -*- coding: utf-8 -*-
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import agendador


def test_proxima_execucao_hoje_quando_ainda_nao_passou_do_horario():
    agora = dt.datetime(2026, 9, 7, 1, 0, 0)
    proxima = agendador.proxima_execucao(agora, "0 2 * * *")
    assert proxima == dt.datetime(2026, 9, 7, 2, 0, 0)


def test_proxima_execucao_amanha_quando_ja_passou_do_horario():
    agora = dt.datetime(2026, 9, 7, 3, 0, 0)
    proxima = agendador.proxima_execucao(agora, "0 2 * * *")
    assert proxima == dt.datetime(2026, 9, 8, 2, 0, 0)


def test_proximo_evento_escolhe_retry_as_06h_apos_noite():
    # As 04:30 da manha, a proxima deve ser o retry das 06:00
    agora = dt.datetime(2026, 9, 7, 4, 30, 0)
    proxima, tipo = agendador.proximo_evento(agora, "none", "0 2 * * *", "0 6 * * *")
    assert proxima == dt.datetime(2026, 9, 7, 6, 0, 0)
    assert tipo == "retry"


def test_proximo_evento_escolhe_noite_as_02h_apos_retry():
    # As 07:00 da manha, a proxima deve ser a noite das 02:00 de amanha
    agora = dt.datetime(2026, 9, 7, 7, 0, 0)
    proxima, tipo = agendador.proximo_evento(agora, "none", "0 2 * * *", "0 6 * * *")
    assert proxima == dt.datetime(2026, 9, 8, 2, 0, 0)
    assert tipo == "noite"


def test_proximo_evento_com_retry_desabilitado():
    agora = dt.datetime(2026, 9, 7, 4, 30, 0)
    proxima, tipo = agendador.proximo_evento(agora, "none", "0 2 * * *", "none")
    assert proxima == dt.datetime(2026, 9, 8, 2, 0, 0)
    assert tipo == "noite"



def test_noite_por_obra_roda_uma_obra_por_processo_com_pausa():
    chamadas, pausas = [], []
    agendador.rodar_noite_por_obra(
        ["340", "410", "430"], "2026-09-07", dormir=pausas.append,
        rodar=lambda args, timeout: chamadas.append((args, timeout)) or 0)
    assert [a[2] for a, _ in chamadas] == ["340", "410", "430"]
    assert all(a[:2] == ["src/rodar_noite.py", "--obras"] and a[3:] == ["--data", "2026-09-07"]
               for a, _ in chamadas)
    assert all(t == agendador.TIMEOUT_OBRA_MIN * 60 for _, t in chamadas)
    # pausa entre obras, nao antes da primeira
    assert pausas == [agendador.PAUSA_ENTRE_OBRAS_S] * 2


def test_noite_por_obra_para_ao_estourar_o_teto_da_noite(monkeypatch):
    relogio = [0.0]
    monkeypatch.setattr(agendador.time, "time", lambda: relogio[0])
    chamadas = []

    def rodar(args, timeout):
        chamadas.append(args[2])
        relogio[0] += agendador.TEMPO_MAX_NOITE_H * 3600 + 1   # estoura o teto
        return 0

    agendador.rodar_noite_por_obra(["340", "410"], "2026-09-07",
                                   dormir=lambda s: None, rodar=rodar)
    assert chamadas == ["340"]


def test_rodar_isolado_mata_o_processo_no_timeout(monkeypatch):
    monkeypatch.setattr(agendador, "varrer_orfaos", lambda: None)
    import sys as _sys, time as _t
    if _sys.platform == "win32":
        import pytest
        pytest.skip("killpg/start_new_session so existem no Linux (container)")
    inicio = _t.time()
    rc = agendador.rodar_isolado(["-c", "import time; time.sleep(60)"], timeout_s=1)
    assert rc is None and _t.time() - inicio < 10
