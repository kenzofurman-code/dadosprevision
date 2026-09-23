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


def proximo_evento(agora, cron_approvo, cron_noite, cron_retry):
    """Calcula o proximo evento mais proximo entre Approvo, rotina noturna e o retry."""
    candidatos = []
    if cron_approvo and cron_approvo.strip().lower() not in ("none", "disabled", "false"):
        prox_approvo = proxima_execucao(agora, cron_approvo.strip())
        candidatos.append((prox_approvo, "approvo"))

    if cron_noite and cron_noite.strip().lower() not in ("none", "disabled", "false"):
        prox_noite = proxima_execucao(agora, cron_noite.strip())
        candidatos.append((prox_noite, "noite"))

    if cron_retry and cron_retry.strip().lower() not in ("none", "disabled", "false"):
        prox_retry = proxima_execucao(agora, cron_retry.strip())
        candidatos.append((prox_retry, "retry"))

    if not candidatos:
        raise ValueError("Nenhum agendamento cron valido configurado.")

    candidatos.sort(key=lambda x: x[0])
    return candidatos[0]


def main():
    import datetime as dt

    import retry
    import rodar_noite
    import rodar_approvo

    cron_approvo = os.environ.get("CRON_SCHEDULE_APPROVO", "0 22 * * *")
    cron_noite = os.environ.get("CRON_SCHEDULE_MEGA", "0 0 * * *")
    cron_retry = os.environ.get("CRON_SCHEDULE_MEGA_RETRY", "30 7 * * *")

    print("[AGENDADOR] Iniciado com cron_approvo=%r, cron_noite=%r, cron_retry=%r" % (
        cron_approvo, cron_noite, cron_retry), flush=True)

    while True:
        agora = dt.datetime.now()
        proxima, tipo = proximo_evento(agora, cron_approvo, cron_noite, cron_retry)
        espera = (proxima - agora).total_seconds()
        print("proxima execucao (%s): %s (em %.0fs)" % (tipo, proxima.isoformat(), espera),
              flush=True)
        time.sleep(max(0, espera))

        if tipo == "approvo":
            print("[AGENDADOR] Disparando rotina do Approvo (22:00)...", flush=True)
            try:
                rodar_approvo.rodar(headless=True)
            except Exception as e:
                print("execucao do Approvo falhou: %s" % e, flush=True)
        elif tipo == "noite":
            print("[AGENDADOR] Disparando rotina noturna completa (00:00)...", flush=True)
            try:
                rodar_noite.main()
            except Exception as e:
                print("execucao da noite falhou: %s" % e, flush=True)
        elif tipo == "retry":
            print("[AGENDADOR] Disparando auditoria e retry (07:30)...", flush=True)
            try:
                retry.main()
            except Exception as e:
                print("execucao do retry falhou: %s" % e, flush=True)


if __name__ == "__main__":
    main()
