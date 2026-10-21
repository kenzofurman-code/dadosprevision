# -*- coding: utf-8 -*-
"""Laco de agendamento: dorme ate o horario configurado e dispara a noite.

Processo de longa duracao dentro do container `mega` (restart: always no
Compose) — sem depender de cron do host nem de ferramenta de orquestracao
externa.
"""
import datetime as dt
import os
import signal
import subprocess
import sys
import threading
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
# Os dois retries (06:30 e 12:00) tem uma janela de 90 min: acabam as 08:00 e as
# 13:30. O retry para de abrir trabalho novo aos 80 min; aos 90 o processo e morto.
RETRY_TEMPO_MIN = int(os.environ.get("RETRY_TEMPO_MAX_MINUTOS", "80"))
RETRY_TIMEOUT_MIN = RETRY_TEMPO_MIN + 10
DIAS_DE_LOG = 30


def iniciar_log_em_arquivo(pasta, dias=DIAS_DE_LOG):
    """Espelha stdout/stderr (deste processo e dos filhos) num arquivo por dia.

    O `docker logs` some a cada deploy (o Coolify troca o container); o volume
    `mega-dados` nao. Sem isso, a noite de 2026-10-20 (obra 630 sem nenhuma
    linha no banco) nao teve como ser explicada. O terminal/Coolify continua
    mostrando tudo: so acrescentamos a copia no arquivo.

    Funciona no descritor (dup2), entao os subprocessos herdam. Falha ao gravar
    no arquivo nunca derruba o robo.
    """
    pasta = Path(pasta)
    try:
        pasta.mkdir(parents=True, exist_ok=True)
    except OSError:
        return
    leitura, escrita = os.pipe()
    saida_original = os.dup(1)
    os.dup2(escrita, 1)
    os.dup2(escrita, 2)
    os.close(escrita)
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except (AttributeError, ValueError):
        pass

    def _limpar_antigos():
        corte = time.time() - dias * 86400
        for f in pasta.glob("mega-*.log"):
            try:
                if f.stat().st_mtime < corte:
                    f.unlink()
            except OSError:
                pass

    def _copiar():
        arquivo, nome_atual = None, None
        while True:
            try:
                bloco = os.read(leitura, 65536)
            except OSError:
                return
            if not bloco:
                return
            os.write(saida_original, bloco)
            try:
                nome = "mega-%s.log" % dt.date.today().isoformat()
                if nome != nome_atual:
                    if arquivo:
                        arquivo.close()
                    arquivo, nome_atual = open(pasta / nome, "ab"), nome
                    _limpar_antigos()
                arquivo.write(bloco)
                arquivo.flush()
            except OSError:
                pass

    threading.Thread(target=_copiar, daemon=True).start()


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


def proximo_evento(agora, cron_approvo, cron_noite, cron_retry, cron_retry_almoco=None):
    """Calcula o proximo evento mais proximo entre Approvo, rotina noturna e os retries."""
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

    if cron_retry_almoco and cron_retry_almoco.strip().lower() not in ("none", "disabled", "false"):
        candidatos.append((proxima_execucao(agora, cron_retry_almoco.strip()), "retry_almoco"))

    if not candidatos:
        raise ValueError("Nenhum agendamento cron valido configurado.")

    candidatos.sort(key=lambda x: x[0])
    return candidatos[0]


def main():
    import datetime as dt

    import config as cfgmod

    cron_approvo = os.environ.get("CRON_SCHEDULE_APPROVO", "0 22 * * *")
    cron_noite = os.environ.get("CRON_SCHEDULE_MEGA", "0 0 * * *")
    cron_retry = os.environ.get("CRON_SCHEDULE_MEGA_RETRY", "30 6 * * *")
    cron_retry_almoco = os.environ.get("CRON_SCHEDULE_MEGA_RETRY_ALMOCO", "0 12 * * *")

    iniciar_log_em_arquivo(SRC.parent / "dados" / "logs")
    print("[AGENDADOR] Iniciado com cron_approvo=%r, cron_noite=%r, cron_retry=%r, "
          "cron_retry_almoco=%r" % (cron_approvo, cron_noite, cron_retry, cron_retry_almoco),
          flush=True)

    while True:
        agora = dt.datetime.now()
        proxima, tipo = proximo_evento(
            agora, cron_approvo, cron_noite, cron_retry, cron_retry_almoco)
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
            rodar_isolado(["src/retry.py", "--tempo", str(RETRY_TEMPO_MIN)],
                          RETRY_TIMEOUT_MIN * 60)
        elif tipo == "retry_almoco":
            print("[AGENDADOR] Disparando retry do almoco...", flush=True)
            rodar_isolado(["src/retry.py", "--tempo", str(RETRY_TEMPO_MIN)],
                          RETRY_TIMEOUT_MIN * 60)


if __name__ == "__main__":
    main()
