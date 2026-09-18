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
    proxima, tipo = agendador.proximo_evento(agora, "0 2 * * *", "0 6 * * *")
    assert proxima == dt.datetime(2026, 9, 7, 6, 0, 0)
    assert tipo == "retry"


def test_proximo_evento_escolhe_noite_as_02h_apos_retry():
    # As 07:00 da manha, a proxima deve ser a noite das 02:00 de amanha
    agora = dt.datetime(2026, 9, 7, 7, 0, 0)
    proxima, tipo = agendador.proximo_evento(agora, "0 2 * * *", "0 6 * * *")
    assert proxima == dt.datetime(2026, 9, 8, 2, 0, 0)
    assert tipo == "noite"


def test_proximo_evento_com_retry_desabilitado():
    agora = dt.datetime(2026, 9, 7, 4, 30, 0)
    proxima, tipo = agendador.proximo_evento(agora, "0 2 * * *", "none")
    assert proxima == dt.datetime(2026, 9, 8, 2, 0, 0)
    assert tipo == "noite"

