# -*- coding: utf-8 -*-
"""Laco de agendamento: dorme ate o horario configurado e dispara a noite.

Processo de longa duracao dentro do container `mega` (restart: always no
Compose) — sem depender de cron do host nem de ferramenta de orquestracao
externa.
"""
import os
import time

from croniter import croniter


def proxima_execucao(agora, expressao_cron):
    it = croniter(expressao_cron, agora)
    return it.get_next(type(agora))


def main():
    import datetime as dt

    import rodar_noite

    expressao = os.environ.get("CRON_SCHEDULE_MEGA", "0 2 * * *")
    while True:
        agora = dt.datetime.now()
        proxima = proxima_execucao(agora, expressao)
        espera = (proxima - agora).total_seconds()
        print("proxima execucao: %s (em %.0fs)" % (proxima.isoformat(), espera),
             flush=True)
        time.sleep(max(0, espera))
        try:
            rodar_noite.main()
        except Exception as e:
            print("execucao da noite falhou: %s" % e, flush=True)


if __name__ == "__main__":
    main()
