# -*- coding: utf-8 -*-
"""Laco de agendamento: dorme ate o horario configurado e dispara a noite.

Processo de longa duracao dentro do container `mega` (restart: always no
Compose) — sem depender de cron do host nem de ferramenta de orquestracao
externa.
"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from croniter import croniter


SRC = Path(__file__).resolve().parent
# Cada obra roda num processo proprio; ao terminar (ok, erro ou timeout) o
# grupo de processos inteiro e morto -- nenhum Chrome/Playwright sobrevive de
# uma obra para a outra. BUG REAL: rodando tudo neste processo de longa
# duracao, Chromes travados que o fechar() nao conseguia encerrar vazavam a
# cada reconexao e a cada noite, ate estourar a CPU da VPS.
TIMEOUT_OBRA_MIN = int(os.environ.get("MEGA_TIMEOUT_OBRA_MINUTOS", "40"))
PAUSA_ENTRE_OBRAS_S = int(os.environ.get("MEGA_PAUSA_ENTRE_OBRAS_SEGUNDOS", "180"))
TEMPO_MAX_NOITE_H = 4
TIMEOUT_JOB_MIN = 120   # retry e Approvo, que rodam num processo so


def _processos_navegador():
    """PIDs de Chrome/driver do Playwright vivos no container (le /proc)."""
    pids = []
    for d in Path("/proc").glob("[0-9]*"):
        try:
            cmd = (d / "cmdline").read_bytes().replace(b"\0", b" ")
        except OSError:
            continue
        if int(d.name) != os.getpid() and (b"chrome" in cmd or b"playwright" in cmd):
            pids.append(int(d.name))
    return pids


def varrer_orfaos():
    """Mata qualquer Chrome/Playwright que tenha sobrado de uma execucao anterior."""
    pids = _processos_navegador()
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    if pids:
        print("[AGENDADOR] varredura: %d processo(s) orfao(s) de navegador mortos" % len(pids),
              flush=True)


def rodar_isolado(args, timeout_s):
    """Roda `python src/<args>` num grupo de processos proprio e mata o grupo
    inteiro no fim, qualquer que seja o desfecho. Devolve o codigo de saida
    (None em timeout)."""
    proc = subprocess.Popen([sys.executable] + args, cwd=str(SRC.parent),
                            start_new_session=True)
    try:
        return proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        print("[AGENDADOR] timeout de %ds estourado: %s" % (timeout_s, " ".join(args)),
              flush=True)
        return None
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
        proc.wait()
        varrer_orfaos()


def rodar_noite_por_obra(obras, data_iso, dormir=time.sleep, rodar=None):
    """Uma obra por processo, com pausa entre obras para a CPU respirar e um
    teto de tempo para a noite inteira."""
    rodar = rodar or rodar_isolado
    limite = time.time() + TEMPO_MAX_NOITE_H * 3600
    for i, codigo in enumerate(obras):
        if time.time() > limite:
            print("[AGENDADOR] tempo limite da noite estourado -- pulando %d obra(s)"
                  % (len(obras) - i), flush=True)
            break
        if i > 0:
            dormir(PAUSA_ENTRE_OBRAS_S)
        print("[AGENDADOR] obra %s (%d/%d)" % (codigo, i + 1, len(obras)), flush=True)
        rc = rodar(["src/rodar_noite.py", "--obras", codigo, "--data", data_iso],
                   TIMEOUT_OBRA_MIN * 60)
        if rc != 0:
            print("[AGENDADOR] obra %s terminou com codigo %s" % (codigo, rc), flush=True)


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

    import config as cfgmod

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

        varrer_orfaos()
        if tipo == "approvo":
            print("[AGENDADOR] Disparando rotina do Approvo...", flush=True)
            rodar_isolado(["src/rodar_approvo.py"], TIMEOUT_JOB_MIN * 60)
        elif tipo == "noite":
            print("[AGENDADOR] Disparando rotina noturna, uma obra por vez...", flush=True)
            try:
                obras = [o["codigo"] for o in cfgmod.obras(cfgmod.carregar())]
                rodar_noite_por_obra(obras, dt.date.today().isoformat())
            except Exception as e:
                print("execucao da noite falhou: %s" % e, flush=True)
        elif tipo == "retry":
            print("[AGENDADOR] Disparando auditoria e retry...", flush=True)
            rodar_isolado(["src/retry.py"], TIMEOUT_JOB_MIN * 60)


if __name__ == "__main__":
    main()
