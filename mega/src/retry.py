# -*- coding: utf-8 -*-
"""Checagem automatica e re-execucao (retry) direcionada para falhas da madrugada.

Roda as 06:00 (antes do inicio do expediente):
1. Audita no PostgreSQL e na pasta local o que falhou na rotina das 02:00.
2. Se houver arquivos brutos ja baixados mas pendentes de carga, carrega localmente.
3. Se NENHUMA obra/relatorio estiver pendente: conclui imediatamente sem abrir o ERP.
4. Se houver pendencias reais: abre o ERP, navega APENAS nas obras faltantes e executa
   SOMENTE os relatorios pendentes, carregando no banco e deslogando limpo em minutos.
"""
import datetime as dt
import os
import time
from pathlib import Path

import banco
import config as cfgmod
from biblioteca import Operador
from carregar import carregar_relatorio, purgar_arquivos
from executar import TESSERACT, _rodar_relatorio_na_obra_ativa, reconectar_sessao
from sessao import Sessao
from visao import Visao

RAIZ = Path(__file__).resolve().parent.parent
ORDEM_RELATORIOS = ["itens_solicitados", "analise_saldo_solicitacao",
                    "visualizacao_itens", "pedidos_compra", "solicitacoes_por_etapa"]
# Por padrao, retry foca nas telas operacionais diarias (evita loop em telas
# que estejam temporariamente fora do ar como Saldo Resumido). Configuravel por env.
RELATORIOS_RETRY_PADRAO = ["itens_solicitados", "visualizacao_itens", "pedidos_compra", "solicitacoes_por_etapa"]


def _log(msg):
    print("%s  [RETRY] %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def identificar_pendencias(cfg, conn, data_iso, pasta=None, marcador_parametro="%s",
                           relatorios_permitidos=None):
    """Consulta o banco e a pasta local para listar quais obras e relatorios
    precisam de re-execucao. Devolve {codigo_obra: [rel_id, ...]}."""
    if pasta is None:
        pasta = RAIZ / "dados" / "bruto" / data_iso

    if relatorios_permitidos is None:
        env_rels = os.environ.get("RETRY_RELATORIOS", "")
        if env_rels:
            if env_rels.strip().lower() == "todos":
                relatorios_permitidos = ORDEM_RELATORIOS
            else:
                relatorios_permitidos = [r.strip() for r in env_rels.split(",") if r.strip()]
        else:
            relatorios_permitidos = RELATORIOS_RETRY_PADRAO

    obras_todas = [o["codigo"] for o in cfgmod.obras(cfg)]
    cur = conn.cursor()
    m = marcador_parametro
    prefixo = "" if m == "?" else "mega."

    # 1. Conferir quais obras ja estao salvas nas tabelas principais para a data de hoje
    obras_ok_por_tabela = {}

    # visualizacao_itens
    try:
        cur.execute("SELECT DISTINCT obra FROM %svisualizacao_itens WHERE data_extracao = %s" % (prefixo, m), (data_iso,))
        obras_ok_por_tabela["visualizacao_itens"] = set(r[0] for r in cur.fetchall())
    except Exception:
        obras_ok_por_tabela["visualizacao_itens"] = set()

    # pedidos_compra
    try:
        cur.execute("SELECT DISTINCT obra FROM %spedidos_compra WHERE data_extracao = %s" % (prefixo, m), (data_iso,))
        obras_ok_por_tabela["pedidos_compra"] = set(r[0] for r in cur.fetchall())
    except Exception:
        obras_ok_por_tabela["pedidos_compra"] = set()

    # solicitacoes_por_etapa
    try:
        cur.execute("SELECT DISTINCT obra FROM %ssolicitacoes_por_etapa WHERE data_extracao = %s" % (prefixo, m), (data_iso,))
        obras_ok_por_tabela["solicitacoes_por_etapa"] = set(r[0] for r in cur.fetchall())
    except Exception:
        obras_ok_por_tabela["solicitacoes_por_etapa"] = set()

    def _para_set(val):
        if isinstance(val, (list, set)):
            return set(val)
        if isinstance(val, str) and val.startswith("["):
            import json
            try:
                return set(json.loads(val))
            except Exception:
                return set()
        return set()

    # itens_solicitados e analise_saldo: consultar carga
    cargas_hoje = {}
    try:
        cur.execute(
            "SELECT relatorio, obras_ok, obras_sem_movimento, obras_falhou, bloqueado "
            "FROM %scarga WHERE data_extracao = %s ORDER BY id ASC" % (prefixo, m), (data_iso,))
        for row in cur.fetchall():
            rel_id, ok, sem_mov, falhou, bloqueado = row
            cargas_hoje[rel_id] = {
                "ok": _para_set(ok),
                "sem_movimento": _para_set(sem_mov),
                "falhou": _para_set(falhou),
                "bloqueado": bloqueado,
            }
    except Exception:
        pass

    # Monta lista inicial de pendencias
    pendencias_por_obra = {}

    for rel_id in relatorios_permitidos:
        rel = cfgmod.relatorio(cfg, rel_id)
        for cod_obra in obras_todas:
            precisa_rodar = False

            if rel_id in obras_ok_por_tabela:
                # Se tem tabela propria particionada por data, checa presenca fisica
                if cod_obra not in obras_ok_por_tabela[rel_id]:
                    precisa_rodar = True
            else:
                # Se depende do log de carga (itens_solicitados / analise_saldo)
                info_carga = cargas_hoje.get(rel_id)
                if not info_carga:
                    precisa_rodar = True
                elif cod_obra in info_carga["falhou"] and cod_obra not in info_carga["ok"]:
                    precisa_rodar = True

            if not precisa_rodar:
                continue

            # Se precisa rodar, confere se o arquivo bruto ja foi baixado na madrugada
            # mas ficou pendente de carga (ex: carga em lote bloqueada por falha em outra obra)
            arquivo_base = rel["exportacoes"][0]["arquivo"]
            caminho_local = pasta / ("%s_%s_%s.xlsx" % (arquivo_base, cod_obra, data_iso))

            carregou_local = False
            if caminho_local.exists() and caminho_local.stat().st_size > 0:
                _log("Tentando carga local de %s para obra %s..." % (rel_id, cod_obra))
                try:
                    resultado_simulado = {"ok": [cod_obra], "sem_movimento": [], "falhou": []}
                    relatos = carregar_relatorio(cfg, conn, rel_id, data_iso, pasta, resultado_simulado,
                                                 marcador_parametro=marcador_parametro)
                    conn.commit()
                    purgar_arquivos(pasta, relatos, data_iso)
                    carregou_local = True
                    _log("   carga local de %s para obra %s efetuada com sucesso!" % (rel_id, cod_obra))
                except Exception as e:
                    conn.rollback()
                    _log("   carga local de %s falhou: %s" % (rel_id, str(e)[:100]))

            if not carregou_local:
                pendencias_por_obra.setdefault(cod_obra, []).append(rel_id)

    return pendencias_por_obra


def rodar_retry(cfg, conectar_fn=banco.conectar, abrir_sessao_fn=Sessao, data_iso=None,
                tempo_max_minutos=35, marcador_parametro="%s", aplicar_esquema=True):
    """Orquestra a checagem e execucao de retry para a data especificada."""
    if data_iso is None:
        data_iso = dt.date.today().isoformat()

    pasta = RAIZ / "dados" / "bruto" / data_iso
    pasta.mkdir(parents=True, exist_ok=True)
    falhas_dir = RAIZ / "dados" / "falhas"
    falhas_dir.mkdir(parents=True, exist_ok=True)

    conn = conectar_fn()
    if aplicar_esquema:
        banco.aplicar_esquema(conn)

    _log("Iniciando auditoria dos dados para a data %s..." % data_iso)
    pendencias = identificar_pendencias(cfg, conn, data_iso, pasta=pasta,
                                        marcador_parametro=marcador_parametro)

    if not pendencias:
        _log("Auditoria concluida: todas as obras e relatorios estao 100%% atualizados para %s." % data_iso)
        _log("Nenhuma acao de retry necessaria. ERP nao sera acessado.")
        return {"status": "OK", "pendencias": {}}

    _log("Pendencias detectadas para retry: %s" % pendencias)
    tempo_limite = time.time() + tempo_max_minutos * 60

    s = abrir_sessao_fn()
    op = None
    resultados = {}

    try:
        _log("Abrindo navegador e conectando ao Mega ERP...")
        s.abrir()
        _log("login: %s" % s.entrar())
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESSERACT)
        op = Operador(erp, visao=v, log=_log)
        op.esperar_erp_pronto(timeout=300)

        for cod_obra, rels_ids in pendencias.items():
            if time.time() > tempo_limite:
                _log("Tempo limite alcancado; encerrando retry preventivamente.")
                break

            obra = cfgmod.obra(cfg, cod_obra)
            _log("Processando obra %s (%s) - relatorios: %s" % (cod_obra, obra["nome"], rels_ids))

            # Trocar de empresa
            e_troca_final = None
            try:
                op.trocar_empresa(obra["codigo"], obra["nome"])
            except Exception as e_troca:
                _log("   falha ao trocar para empresa %s: %s" % (cod_obra, str(e_troca)[:80]))
                e_troca_final = e_troca
                if "closed" in str(e_troca).lower() or (op is not None and op.pagina.is_closed()):
                    try:
                        op, v = reconectar_sessao(s, _log)
                        op.trocar_empresa(obra["codigo"], obra["nome"])
                        e_troca_final = None
                    except Exception as e_rec:
                        _log("   reconexao falhou: %s" % str(e_rec)[:80])
                        e_troca_final = e_rec
                if e_troca_final is not None:
                    for rel_id in rels_ids:
                        resultados.setdefault(cod_obra, {})[rel_id] = "FALHOU_TROCA"
                    continue

            for rel_id in rels_ids:
                if time.time() > tempo_limite:
                    break

                rel = cfgmod.relatorio(cfg, rel_id)
                try:
                    estado, caminhos = _rodar_relatorio_na_obra_ativa(op, v, rel, obra, data_iso, pasta)
                    resultado_exec = {
                        "ok": [cod_obra] if estado != "sem_movimento" else [],
                        "sem_movimento": [cod_obra] if estado == "sem_movimento" else [],
                        "falhou": [],
                    }
                    _log("   [%s] extraido com sucesso (%s)" % (rel_id, estado))

                    # Carregar no Postgres imediatamente
                    try:
                        relatos = carregar_relatorio(cfg, conn, rel_id, data_iso, pasta, resultado_exec)
                        conn.commit()
                        purgar_arquivos(pasta, relatos, data_iso)
                        _log("   [%s] carregado no Postgres e purgado com sucesso" % rel_id)
                        resultados.setdefault(cod_obra, {})[rel_id] = "OK"
                    except Exception as e_carga:
                        conn.rollback()
                        _log("   [%s] falha ao carregar no Postgres: %s" % (rel_id, str(e_carga)[:80]))
                        resultados.setdefault(cod_obra, {})[rel_id] = "ERRO_CARGA"

                except Exception as e_rel:
                    _log("   [%s] falhou na extracao: %s" % (rel_id, str(e_rel)[:100]))
                    resultados.setdefault(cod_obra, {})[rel_id] = "FALHOU"
                    if "closed" in str(e_rel).lower() or (op is not None and op.pagina.is_closed()):
                        try:
                            op, v = reconectar_sessao(s, _log)
                            try:
                                op.trocar_empresa(obra["codigo"], obra["nome"])
                            except Exception:
                                pass
                        except Exception:
                            pass

    finally:
        if op is not None:
            try:
                _log("Encerrando sessao do Mega ERP...")
                op.encerrar_sessao()
            except Exception as e:
                _log("Falha ao encerrar sessao no ERP: %s" % str(e)[:80])
        try:
            s.fechar()
        except Exception as e:
            _log("Falha ao fechar navegador: %s" % str(e)[:80])

    _log("Retry concluido com resultados: %s" % resultados)
    return {"status": "CONCLUIDO", "resultados": resultados}


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Checagem e retry de relatorios do Mega ERP.")
    parser.add_argument("--data", default=dt.date.today().isoformat(), help="Data de referencia ISO.")
    args = parser.parse_args()

    cfg = cfgmod.carregar()
    return rodar_retry(cfg, data_iso=args.data)


if __name__ == "__main__":
    main()
