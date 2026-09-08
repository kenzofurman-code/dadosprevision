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
