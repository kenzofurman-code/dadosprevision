# -*- coding: utf-8 -*-
"""Orquestra uma noite inteira: os 4 relatorios, numa unica sessao do ERP,
seguidos da carga no Postgres e da purga dos arquivos que carregaram OK.

Ponto de entrada do container `mega` (chamado pelo agendador.py). As
dependencias externas (sessao do navegador, conexao com o banco) entram por
parametro para permitir testar a ORQUESTRACAO sem abrir Chrome nem Postgres.
"""
import datetime as dt
from pathlib import Path

import banco
import config as cfgmod
from biblioteca import Operador
from carregar import carregar_relatorio, purgar_arquivos
from executar import TESSERACT, executar_relatorio
from sessao import Sessao
from visao import Visao

RAIZ = Path(__file__).resolve().parent.parent
ORDEM_RELATORIOS = ["itens_solicitados", "analise_saldo_solicitacao",
                    "visualizacao_itens", "pedidos_compra"]


def _log(msg):
    print("%s  %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def rodar_relatorios_da_noite(cfg, conectar_fn, abrir_sessao_fn, data_iso):
    pasta = RAIZ / "dados" / "bruto" / data_iso
    pasta.mkdir(parents=True, exist_ok=True)
    falhas_dir = RAIZ / "dados" / "falhas"
    falhas_dir.mkdir(parents=True, exist_ok=True)

    obras = cfgmod.obras(cfg)
    conn = conectar_fn()
    banco.aplicar_esquema(conn)

    s = abrir_sessao_fn()
    resultados = {}
    op = None
    try:
        # abrir() e o que de fato lanca o Chrome/Playwright e cria a pagina
        # (self.pagina) — sem ele, entrar() chama .goto() num self.pagina
        # ainda None. executar.py usa "with Sessao() as s:", que aciona
        # abrir() sozinho via __enter__; aqui, sem context manager, precisa
        # ser explicito. BUG REAL, confirmado na primeira execucao noturna
        # de verdade (2026-09-09): "'NoneType' object has no attribute
        # 'goto'", capturado pelo try/except do agendador.py sem derrubar o
        # container, mas sem extrair nada — mega.carga ficou vazia.
        s.abrir()
        _log("login: %s" % s.entrar())
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESSERACT)
        op = Operador(erp, visao=v, log=_log)
        # O ERP demora a montar a area de trabalho depois do login; sem esta
        # espera o primeiro relatorio da noite comeca a clicar numa tela ainda
        # vazia.
        op.esperar_erp_pronto(timeout=300)

        for rel_id in ORDEM_RELATORIOS:
            rel = cfgmod.relatorio(cfg, rel_id)
            resultado_execucao = executar_relatorio(op, v, s, rel, obras, data_iso,
                                                    pasta, falhas_dir, _log)
            # Uma carga que explode no meio deixaria a transacao aberta e
            # meio relatorio gravado; reverter e seguir para o proximo
            # relatorio preserva o que ja carregou nesta noite.
            try:
                relatos = carregar_relatorio(cfg, conn, rel_id, data_iso, pasta,
                                             resultado_execucao)
                conn.commit()
                purgar_arquivos(pasta, relatos, data_iso)
            except Exception as e:
                conn.rollback()
                _log("   carga de %s falhou, revertida: %s" % (rel_id, str(e)[:110]))
                relatos = [{"arquivo": rel_id, "estado": "ERRO", "obras": 0,
                           "motivo": str(e)[:200]}]
            resultados[rel_id] = {"execucao": resultado_execucao, "carga": relatos}
    finally:
        # A sessao do ERP e um recurso escasso (uma por usuario): deixar de
        # encerra-la trava a noite seguinte. Guardado: se encerrar_sessao()
        # levantar (ex.: pagina ja fechada por uma queda anterior), a excecao
        # nao pode substituir o "return resultados" e apagar tudo que ja foi
        # apurado nesta noite. "op" pode ser None se s.abrir()/entrar()/
        # abrir_erp() falharem antes de Operador ser criado — nesse caso so
        # fechar() a sessao do navegador.
        if op is not None:
            try:
                op.encerrar_sessao()
            except Exception as e:
                _log("   nao consegui encerrar a sessao: %s" % str(e)[:110])
        # agendador.py roda no MESMO processo todo dia (nao reinicia o
        # container a cada noite) — sem fechar(), o Chrome/Playwright desta
        # execucao vaza e acumula a cada noite. BUG REAL, confirmado junto
        # com o de s.abrir() acima.
        try:
            s.fechar()
        except Exception as e:
            _log("   nao consegui fechar o navegador: %s" % str(e)[:110])

    return resultados


def main():
    cfg = cfgmod.carregar()
    data_iso = dt.date.today().isoformat()
    resultados = rodar_relatorios_da_noite(
        cfg, conectar_fn=banco.conectar, abrir_sessao_fn=Sessao, data_iso=data_iso)
    for rel_id, r in resultados.items():
        exec_r = r["execucao"]
        _log("%s: ok=%d sem_movimento=%d falhou=%d" % (
            rel_id, len(exec_r["ok"]), len(exec_r["sem_movimento"]),
            len(exec_r["falhou"])))
    return resultados


if __name__ == "__main__":
    main()
