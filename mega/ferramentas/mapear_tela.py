# -*- coding: utf-8 -*-
"""Abre o ERP e imprime tudo que o OCR enxerga, com posicao.

Ferramenta de calibragem: em vez de adivinhar coordenadas, olhar uma vez.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from sessao import Sessao
from visao import Visao
from biblioteca import Operador
from plataforma import caminho_tesseract

TESS = caminho_tesseract()
RAIZ = Path(__file__).resolve().parent.parent


def main():
    with Sessao() as s:
        print(s.entrar(), flush=True)
        s.pagina.wait_for_timeout(8000)
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESS)
        op = Operador(erp, visao=v)

        op.esperar_texto("Bem-vindo", timeout=180)
        print("ERP carregado\n", flush=True)

        img = v.capturar(cutucar=True)
        print("dimensao da captura: %dx%d" % (img.shape[1], img.shape[0]), flush=True)
        destino = RAIZ / "dados" / "mapa.png"
        erp.screenshot(path=str(destino))

        palavras = [p for p in v._palavras(img) if p["conf"] >= 40]
        print("%d palavras reconhecidas\n" % len(palavras), flush=True)
        print("%-28s %6s %6s %5s %5s %6s" % ("TEXTO", "X", "Y", "L", "A", "CONF"))
        print("-" * 62)
        for p in sorted(palavras, key=lambda w: (w["y"], w["x"]))[:60]:
            print("%-28s %6d %6d %5d %5d %6.0f"
                  % (p["texto"][:28], p["x"], p["y"], p["w"], p["h"], p["conf"]),
                  flush=True)
        print("\ncaptura salva em", destino, flush=True)


if __name__ == "__main__":
    main()
