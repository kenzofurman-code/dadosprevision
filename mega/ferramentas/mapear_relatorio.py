# -*- coding: utf-8 -*-
"""Abre a tela de um relatorio numa obra e lista tudo que o OCR ve, com posicao.

Ferramenta de calibragem: usada quando um alvo e ilegivel (texto claro sobre
botao colorido) e e preciso ancora-lo num vizinho legivel. Em vez de estimar o
deslocamento, medir.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.stdout.reconfigure(encoding="utf-8")

import config as cfgmod
from sessao import Sessao
from visao import Visao
from biblioteca import Operador
from plataforma import caminho_tesseract

TESS = caminho_tesseract()
RAIZ = Path(__file__).resolve().parent.parent
RELATORIO = sys.argv[1] if len(sys.argv) > 1 else "analise_saldo_solicitacao"
OBRA = sys.argv[2] if len(sys.argv) > 2 else "480"


def main():
    cfg = cfgmod.carregar()
    rel = cfgmod.relatorio(cfg, RELATORIO)
    obra = cfgmod.obra(cfg, OBRA)

    with Sessao() as s:
        print(s.entrar(), flush=True)
        s.pagina.wait_for_timeout(8000)
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESS)
        op = Operador(erp, visao=v, log=lambda m: print(m, flush=True))
        op.esperar_erp_pronto(timeout=300)

        op.trocar_empresa(obra["codigo"])
        op.abrir_tela(rel["busca_tela"], rel["ancora_titulo_tela"],
                      palavra_modulo=rel.get("palavra_modulo"))
        time.sleep(5)

        destino = RAIZ / "dados" / ("mapa_%s.png" % RELATORIO)
        erp.screenshot(path=str(destino))
        img = op.tela()
        palavras = [p for p in v.palavras_todas(img) if p["conf"] >= 45]

        vistos, unicas = set(), []
        for p in sorted(palavras, key=lambda w: (w["y"], w["x"])):
            chave = (p["texto"], p["y"] // 10)
            if chave not in vistos:
                vistos.add(chave)
                unicas.append(p)

        print("\n%d palavras (y ate 320, onde ficam os controles):" % len(unicas),
              flush=True)
        for p in unicas:
            if p["y"] <= 320:
                print("   %-28s x=%-5d y=%-5d w=%-4d" % (p["texto"][:28], p["x"],
                                                        p["y"], p["w"]), flush=True)
        print("\ncaptura: %s" % destino, flush=True)


if __name__ == "__main__":
    main()
