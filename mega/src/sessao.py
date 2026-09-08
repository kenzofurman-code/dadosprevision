# -*- coding: utf-8 -*-
"""Sessao do navegador contra o Mega Cloud.

Duas camadas bem diferentes:
  * o LOGIN e web de verdade (Keycloak em key.megaerp.online) — DOM, seletores;
  * o ERP e um app Windows transmitido como pixels — so imagem e coordenada.

O viewport e fixado de proposito: o gateway HTML5 negocia a resolucao da sessao
remota com o tamanho da janela. Viewport fixo => resolucao remota estavel => a
tela nao muda de geometria entre execucoes.

A senha NUNCA aparece no codigo nem no log: vem do ambiente (ou de um .env que
fica fora do git).
"""
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
URL_PORTAL = "https://orion-sso.seniorcloud.com.br/"
ESTADO_PADRAO = RAIZ / ".sessao.json"


class CredenciaisAusentes(Exception):
    pass


def carregar_dotenv(caminho=None):
    """Le um .env simples, sem dependencia externa. Nao sobrescreve o ambiente."""
    caminho = Path(caminho or RAIZ / ".env")
    if not caminho.exists():
        return
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def credenciais():
    carregar_dotenv()
    usuario = os.environ.get("MEGA_USUARIO")
    senha = os.environ.get("MEGA_SENHA")
    if not usuario or not senha:
        raise CredenciaisAusentes(
            "Defina MEGA_USUARIO e MEGA_SENHA no ambiente ou num arquivo .env "
            "na raiz do projeto (o .env esta no .gitignore)."
        )
    return usuario, senha


class Sessao:
    # DESCOBERTO EM CAMPO (2026-09-01): o gateway HTML5 da Senior NAO funciona no
    # Chromium empacotado do Playwright — o Mega ERP Launcher fica em "Carregando"
    # para sempre, ou a tela nunca pinta. No Google Chrome instalado, o ERP sobe em
    # ~20s. Headless tambem nao serve nem com o Chrome (tela branca e crash).
    # Portanto: canal="chrome" e headless=False, sempre. Na VPS Linux, isso
    # significa Google Chrome sob Xvfb (display virtual) — que, ao contrario do
    # Windows, nao tem bloqueio de tela ao desconectar.
    def __init__(self, largura=1600, altura=900, headless=False, canal="chrome",
                 pasta_downloads=None, estado=None, devagar=0):
        self.largura, self.altura = largura, altura
        self.headless = headless
        self.pasta_downloads = Path(pasta_downloads or RAIZ / "dados" / "downloads")
        self.estado = Path(estado) if estado else ESTADO_PADRAO
        self.devagar = devagar
        self.canal = canal          # "chrome" usa o Chrome instalado, nao o Chromium do Playwright
        self._pw = self._nav = self._ctx = None
        self.pagina = None

    def __enter__(self):
        self.abrir()
        return self

    def __exit__(self, *exc):
        self.fechar()

    def abrir(self):
        self.pasta_downloads.mkdir(parents=True, exist_ok=True)
        self._pw = sync_playwright().start()
        args = dict(headless=self.headless, slow_mo=self.devagar)
        if self.canal:
            args["channel"] = self.canal
        self._nav = self._pw.chromium.launch(**args)
        ctx_args = {
            "viewport": {"width": self.largura, "height": self.altura},
            "accept_downloads": True,
            "locale": "pt-BR",
        }
        if self.estado.exists():
            ctx_args["storage_state"] = str(self.estado)
        self._ctx = self._nav.new_context(**ctx_args)
        self.pagina = self._ctx.new_page()
        return self.pagina

    def fechar(self):
        for obj, metodo in ((self._ctx, "close"), (self._nav, "close"), (self._pw, "stop")):
            if obj is not None:
                try:
                    getattr(obj, metodo)()
                except Exception:
                    pass

    # ------------------------------------------------------------------- login
    def entrar(self, forcar=False):
        """Autentica no Keycloak. Reaproveita a sessao salva quando possivel."""
        pag = self.pagina
        pag.goto(URL_PORTAL, wait_until="domcontentloaded", timeout=90000)
        pag.wait_for_timeout(3000)

        if "key.megaerp.online" not in pag.url and not forcar:
            return "sessao reaproveitada"

        usuario, senha = credenciais()
        pag.wait_for_selector("#username", timeout=30000)
        pag.fill("#username", usuario)
        pag.fill("#password", senha)
        pag.click("#kc-login")
        pag.wait_for_url(lambda u: "key.megaerp.online" not in u, timeout=90000)
        pag.wait_for_timeout(5000)

        if "key.megaerp.online" in pag.url:
            raise RuntimeError("login recusado — confira MEGA_USUARIO/MEGA_SENHA")

        self._ctx.storage_state(path=str(self.estado))
        return "login efetuado"

    # --------------------------------------------------------------------- ERP
    def abrir_erp(self, espera_canvas=90):
        """Dispara o lancador do portal e devolve a pagina do ERP.

        O portal preenche sozinho as credenciais do terminal server depois do
        SSO (o campo de login vem com um token gerado), entao nao ha segundo
        login a tratar. cplogon() abre a sessao numa aba nova; e ela que
        interessa daqui em diante.

        Navegar direto para .../software/html5.html NAO funciona: sem o token
        que o portal cria, o gateway devolve o portal de volta.
        """
        # Simples de proposito. Tentar ser esperto aqui (expect_page + escolher a
        # "mais recente") acabava capturando a aba errada e provocando duas
        # sessoes que se derrubavam. cplogon abre UMA aba de gateway; basta achar.
        ctx = self.pagina.context
        self.pagina.evaluate("() => cplogon()")
        erp = None
        for _ in range(30):
            self.pagina.wait_for_timeout(2000)
            gws = [p for p in ctx.pages
                   if not p.is_closed() and "/software/html5" in (p.url or "")]
            if gws:
                erp = gws[0]
                break
        if erp is None:
            raise RuntimeError("cplogon nao abriu a aba do gateway")
        erp.wait_for_load_state("domcontentloaded", timeout=60000)

        # A aba abre em about:blank e navega em seguida; a navegacao destroi o
        # contexto de execucao no meio da checagem. Por isso o try/except.
        limite = espera_canvas
        while limite > 0:
            try:
                c = erp.query_selector("canvas")
                if c:
                    caixa = c.bounding_box()
                    if caixa and caixa["width"] > 200:
                        self.erp = erp
                        return erp
            except Exception:
                pass
            try:
                erp.wait_for_timeout(2000)
            except Exception:
                import time as _t
                _t.sleep(2)
            limite -= 2
        raise RuntimeError("o canvas do ERP nao apareceu em %ds" % espera_canvas)

    def salvar_estado(self):
        self._ctx.storage_state(path=str(self.estado))
