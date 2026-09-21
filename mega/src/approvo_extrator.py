# -*- coding: utf-8 -*-
"""Extrator do portal Approvo Mega ERP via Playwright.

Fluxo:
1. Login em https://approvopiemonte.megaerp.online/Login.aspx?SE=true
2. Acessa aba #Documentos
3. Abre drawer lateral (se fechado) e seleciona 'Últimos 7 dias'
4. Aguarda carregamento e clica em 'Exportar' -> baixa XLSX de Documentos
5. Acessa aba #Ocorrencias
6. Garante selecao de 'Últimos 7 dias' e clica em 'Exportar' -> baixa XLSX de Ocorrencias
7. Realiza logout via menu lateral -> 'Sair'
"""
import datetime as dt
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

URL_LOGIN = "https://approvopiemonte.megaerp.online/Login.aspx?SE=true"
URL_DOCUMENTOS = "https://approvopiemonte.megaerp.online/Indicadores/indicadores.aspx#Documentos"
URL_OCORRENCIAS = "https://approvopiemonte.megaerp.online/Indicadores/indicadores.aspx#Ocorrencias"


def _log(msg):
    print("%s  [APPROVO] %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def extrair_relatorios_approvo(usuario, senha, pasta_destino, headless=True, timeout_espera=60):
    """Executa a extracao automatizada dos relatorios de Documentos e Ocorrencias."""
    pasta_destino = Path(pasta_destino)
    pasta_destino.mkdir(parents=True, exist_ok=True)
    falhas_dir = pasta_destino.parent / "falhas"
    falhas_dir.mkdir(parents=True, exist_ok=True)

    data_iso = dt.date.today().isoformat()
    arquivo_docs = pasta_destino / f"Approvo_Documentos_{data_iso}.xlsx"
    arquivo_ocorr = pasta_destino / f"Approvo_Ocorrencias_{data_iso}.xlsx"

    with sync_playwright() as p:
        _log(f"Iniciando navegador (headless={headless})...")
        launch_args = [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--window-size=1600,900",
        ]
        try:
            browser = p.chromium.launch(channel="chrome", headless=headless, args=launch_args)
        except Exception:
            browser = p.chromium.launch(headless=headless, args=launch_args)
        context = browser.new_context(
            viewport={"width": 1600, "height": 900},
            accept_downloads=True
        )
        page = context.new_page()

        try:
            # 1. Login
            _log(f"Acessando tela de login: {URL_LOGIN}")
            page.goto(URL_LOGIN, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(1000)

            _log("Preenchendo credenciais...")
            page.fill("input#txtLogin, input[name='txtLogin']", usuario)
            page.fill("input#txtPassword, input[name='txtPassword']", senha)

            _log("Clicando em Entrar...")
            page.click("button#btn-login, button:has-text('Entrar')")

            # Aguarda navegacao / saida da tela de login
            _log("Aguardando conclusao do login...")
            try:
                page.wait_for_url(lambda u: "Login.aspx" not in u, timeout=30000)
                _log("Login autenticado com sucesso!")
            except Exception:
                _log("Aviso: URL nao mudou em 30s; verificando se ja estamos autenticados...")

            page.wait_for_timeout(2000)

            # 2. Navegar para Documentos
            _log("Acessando Indicadores / Documentos...")
            page.goto(URL_DOCUMENTOS, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)

            # Clicar na aba Relatório para sair dos cards/gráficos de Indicadores e ir para o grid
            _log("Acessando aba Relatório...")
            page.click("text=/Relat[oó]rio/i")
            page.wait_for_timeout(1500)

            # Selecionar 'Últimos 7 dias'
            _selecionar_ultimos_7_dias(page)

            # Aguardar o botão de exportação ficar ativo (sem disabled e com o ícone/texto de exportar)
            _log("Aguardando carregamento dos dados de Documentos e liberação do botão Exportar...")
            for _ in range(40):
                pronto = page.evaluate("""() => {
                    const btn = document.querySelector('button.exportButton');
                    return btn && !btn.hasAttribute('disabled');
                }""")
                if pronto:
                    break
                page.wait_for_timeout(2000)

            # Exportar Documentos
            _log("Acionando exportacao de Documentos...")
            with page.expect_download(timeout=60000) as download_info:
                page.click("button.exportButton")
            download = download_info.value
            download.save_as(str(arquivo_docs))
            _log(f"Documentos baixado com sucesso em: {arquivo_docs} ({arquivo_docs.stat().st_size} bytes)")

            # 3. Navegar para Ocorrências
            _log("Acessando aba Ocorrências...")
            page.click("#tabOccurrences")
            page.wait_for_timeout(2000)

            # O filtro de 7 dias é mantido automaticamente na sessão pelo portal
            _log("Aguardando carregamento dos dados de Ocorrências e liberação do botão Exportar...")
            for _ in range(40):
                pronto = page.evaluate("""() => {
                    const btn = document.querySelector('button.exportButton');
                    return btn && !btn.hasAttribute('disabled');
                }""")
                if pronto:
                    break
                page.wait_for_timeout(2000)

            # Exportar Ocorrências
            _log("Acionando exportacao de Ocorrências...")
            with page.expect_download(timeout=60000) as download_info_ocorr:
                page.click("button.exportButton")
            download_ocorr = download_info_ocorr.value
            download_ocorr.save_as(str(arquivo_ocorr))
            _log(f"Ocorrências baixado com sucesso em: {arquivo_ocorr} ({arquivo_ocorr.stat().st_size} bytes)")

            # 4. Logout limpo
            _efetuar_logout(page)

            return {
                "documentos": str(arquivo_docs),
                "ocorrencias": str(arquivo_ocorr),
                "data": data_iso,
                "sucesso": True,
            }

        except Exception as e:
            _log(f"ERRO durante a extracao do Approvo: {e}")
            try:
                print_path = falhas_dir / f"approvo_erro_{int(time.time())}.png"
                page.screenshot(path=str(print_path))
                _log(f"Screenshot salvo para analise em: {print_path}")
            except Exception:
                pass
            raise
        finally:
            try:
                browser.close()
            except Exception:
                pass


def _selecionar_ultimos_7_dias(page):
    """Marca o radio button 'Últimos 7 dias' e dispara a atualizacao."""
    _log("Selecionando filtro 'Últimos 7 dias'...")
    page.evaluate("""() => {
        $('#radioLast7Days').prop('checked', true);
        if (typeof changeDateRange === 'function') {
            changeDateRange($('#radioLast7Days'));
        }
    }""")
    page.wait_for_timeout(1500)


def _efetuar_logout(page):
    """Efetua logout limpo da sessao."""
    try:
        _log("Efetuando logout da sessao...")
        deslogou = page.evaluate("""() => {
            const form = document.querySelector('#formLogout');
            if (form) {
                form.submit();
                return true;
            }
            return false;
        }""")
        if not deslogou:
            page.goto("https://approvopiemonte.megaerp.online/Logout.aspx", timeout=15000)
        page.wait_for_timeout(2000)
        _log("Logout efetuado com sucesso.")
    except Exception as e:
        _log(f"Aviso logout: {e}")
