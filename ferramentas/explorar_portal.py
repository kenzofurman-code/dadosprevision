# -*- coding: utf-8 -*-
"""Loga no portal e descreve o que existe nele.

Serve para descobrir como se chega ao ERP (o gateway HTML5) a partir do portal,
que e a unica parte do caminho ainda desconhecida.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from sessao import Sessao


def main():
    with Sessao(headless=True) as s:
        print("estado do login:", s.entrar())
        pag = s.pagina
        print("URL   :", pag.url)
        print("titulo:", pag.title())

        pag.wait_for_timeout(4000)
        print("\n--- elementos clicaveis ---")
        vistos = set()
        for el in pag.query_selector_all("a, button, [role=button], img[alt], div[onclick]"):
            try:
                txt = (el.inner_text() or "").strip()
                alt = el.get_attribute("alt") or ""
                href = el.get_attribute("href") or ""
                rotulo = (txt or alt)[:40]
                if not rotulo and not href:
                    continue
                chave = (rotulo, href[:60])
                if chave in vistos:
                    continue
                vistos.add(chave)
                print("  %-42s %s" % (rotulo, href[:70]))
            except Exception:
                pass

        print("\n--- iframes ---")
        for f in pag.frames:
            print("  ", f.url[:110])

        destino = Path(__file__).resolve().parent.parent / "dados" / "portal.png"
        destino.parent.mkdir(parents=True, exist_ok=True)
        pag.screenshot(path=str(destino), full_page=False)
        print("\ncaptura:", destino)


if __name__ == "__main__":
    main()
