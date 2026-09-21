# -*- coding: utf-8 -*-
"""Orquestrador da rotina de extracao e carga do Approvo Mega ERP.

Executa:
1. Extracao via Playwright dos relatorios Documentos e Ocorrencias (ultimos 7 dias)
2. Carga com UPSERT nas tabelas mega.approvo_documentos e mega.approvo_ocorrencias
3. Registro da execucao na tabela mega.carga

Pode ser executado diretamente via terminal:
  python mega/src/rodar_approvo.py [--headless True/False]
"""
import argparse
import datetime as dt
import os
import sys
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))

try:
    from dotenv import load_dotenv
    # Carrega .env da raiz do projeto se existir
    load_dotenv(RAIZ.parent / ".env")
    load_dotenv(RAIZ / ".env")
except ImportError:
    pass

import banco
import approvo_carregar
from approvo_extrator import extrair_relatorios_approvo


def _log(msg):
    print("%s  [RODAR_APPROVO] %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def rodar(headless=True):
    usuario = os.environ.get("APPROVO_USUARIO")
    senha = os.environ.get("APPROVO_SENHA")

    if not usuario or not senha:
        raise ValueError(
            "Credenciais do Approvo nao encontradas no ambiente! "
            "Defina APPROVO_USUARIO e APPROVO_SENHA no arquivo .env."
        )

    data_iso = dt.date.today().isoformat()
    pasta_destino = RAIZ / "dados" / "bruto" / "approvo" / data_iso
    pasta_destino.mkdir(parents=True, exist_ok=True)

    _log(f"Iniciando ciclo do Approvo para a data {data_iso}...")
    _log(f"Usuario configurado: {usuario}")

    # 1. Extracao
    res_extracao = extrair_relatorios_approvo(
        usuario=usuario,
        senha=senha,
        pasta_destino=pasta_destino,
        headless=headless
    )

    docs_xlsx = res_extracao["documentos"]
    ocorr_xlsx = res_extracao["ocorrencias"]

    # 2. Carga no Postgres
    _log("Conectando ao PostgreSQL para carga...")
    conn = None
    try:
        conn = banco.conectar()
        banco.aplicar_esquema(conn)

        _log(f"Carregando documentos de: {docs_xlsx}...")
        total_docs = approvo_carregar.carregar_documentos(conn, docs_xlsx, data_extracao=data_iso)
        _log(f"Sucesso: {total_docs} documentos processados e atualizados.")

        _log(f"Carregando ocorrencias de: {ocorr_xlsx}...")
        total_ocorr = approvo_carregar.carregar_ocorrencias(conn, ocorr_xlsx, data_extracao=data_iso)
        _log(f"Sucesso: {total_ocorr} ocorrencias processadas e atualizadas.")

        # Registrar carga com sucesso
        try:
            banco.registrar_carga(
                conn,
                relatorio="approvo_completo",
                arquivo=f"Approvo_{data_iso}",
                data_extracao=data_iso,
                obras_ok=["TODAS"],
                obras_sem_movimento=[],
                obras_falhou=[],
                bloqueado=False,
                motivo_bloqueio=None
            )
            conn.commit()
        except Exception as e:
            _log(f"Aviso ao registrar carga no manifesto: {e}")

        _log("ROTINA DO APPROVO CONCLUIDA COM SUCESSO ABSOLUTO!")
        return {
            "sucesso": True,
            "documentos": total_docs,
            "ocorrencias": total_ocorr,
            "data": data_iso
        }

    except Exception as e:
        _log(f"Falha na conexao ou carga do banco: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(description="Executa extracao e carga do Approvo Mega ERP.")
    parser.add_argument("--no-headless", action="store_true", help="Abre o navegador visivel na tela.")
    args = parser.parse_args()

    rodar(headless=not args.no_headless)


if __name__ == "__main__":
    main()
