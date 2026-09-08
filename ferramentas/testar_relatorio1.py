# -*- coding: utf-8 -*-
"""Executa o relatorio 1 para uma obra, de ponta a ponta, usando a biblioteca.

Primeiro exercicio real do Operador. Cada etapa loga antes e depois, para que
uma falha diga exatamente onde parou em vez de "nao funcionou".
"""
import sys
import time
import datetime as dt
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.stdout.reconfigure(encoding="utf-8")

import config as cfgmod
from sessao import Sessao
from visao import Visao, centro
from biblioteca import Operador, FalhaDeEtapa
from plataforma import caminho_tesseract

TESS = caminho_tesseract()
OBRA = sys.argv[1] if len(sys.argv) > 1 else "490"
RAIZ = Path(__file__).resolve().parent.parent


def etapa(n, descricao):
    print("\n[%d] %s" % (n, descricao), flush=True)


def diagnosticar_agora(op, erp, motivo):
    """Toda falha deve ensinar algo: captura a tela e lista o que o OCR le.

    Roda DENTRO da sessao, antes do navegador fechar — senao o Playwright ja
    encerrou e nao sobra nada para olhar.
    """
    print("\nFALHA: %s" % motivo, flush=True)
    try:
        destino = RAIZ / "dados" / "falha.png"
        erp.screenshot(path=str(destino))
        img = op.tela()
        palavras = [p for p in op.v._palavras(img) if p["conf"] >= 45]
        vistos, unicas = set(), []
        for p in sorted(palavras, key=lambda w: (w["y"], w["x"])):
            chave = (p["texto"], p["y"] // 8)
            if chave in vistos:
                continue
            vistos.add(chave)
            unicas.append(p)
        print("\ntela no momento da falha (%d palavras):" % len(unicas), flush=True)
        for p in unicas[:45]:
            print("   %-30s x=%-5d y=%-5d" % (p["texto"][:30], p["x"], p["y"]), flush=True)
        print("\ncaptura: %s" % destino, flush=True)
    except Exception as e:
        print("(diagnostico falhou: %s)" % str(e)[:70], flush=True)


def main():
    cfg = cfgmod.carregar()
    rel = cfgmod.relatorio(cfg, "itens_solicitados")
    obra = cfgmod.obra(cfg, OBRA)
    hoje = dt.date.today().isoformat()
    destino = RAIZ / "dados" / "bruto" / hoje / cfgmod.nome_arquivo(
        rel["exportacoes"][0], obra["codigo"], hoje)

    with Sessao() as s:
        etapa(0, "login e abertura do ERP")
        print("   ", s.entrar(), flush=True)
        s.pagina.wait_for_timeout(8000)
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESS)
        op = Operador(erp, visao=v, log=lambda m: print(m, flush=True))

        op.esperar_texto("Bem-vindo", timeout=180)
        print("    ERP carregado", flush=True)

        try:
            executar(op, v, erp, cfg, rel, obra, destino)
        except FalhaDeEtapa as e:
            diagnosticar_agora(op, erp, str(e))
            raise


def executar(op, v, erp, cfg, rel, obra, destino):
        etapa(1, "trocar para a obra %s (%s)" % (obra["codigo"], obra["nome"]))
        op.trocar_empresa(obra["codigo"], obra["nome"])

        etapa(2, "abrir a tela de itens solicitados")
        op.abrir_tela(rel["busca_tela"], "ITENS SOLICITADOS", palavra_modulo="Suprimentos")
        op.conferir_filial(obra["codigo"])

        etapa(3, "marcar a visao 'apenas Itens Solicitados'")
        op.clicar_texto("Mostrar apenas Itens Solicitados")

        etapa(4, "preencher a data inicial 01/01/2025")
        rotulo = op.esperar_texto("Data de emissao", timeout=30)
        # o campo fica logo abaixo do rotulo
        from visao import Caixa
        campo = Caixa(rotulo.x, rotulo.y + rotulo.altura + 4, 90, 18, "", 0)
        op.digitar_data(campo, "01", "01", "2025")
        print("    data aplicada", flush=True)

        etapa(5, "filtrar e aguardar o grid")
        # o botao Filtrar e ilegivel para o OCR (branco sobre azul); ancoramos no
        # "Limpar Filtros" logo abaixo, que le com confianca alta
        op.clicar_relativo("Limpar Filtros", dy=-26)
        time.sleep(25)
        img = op.tela()
        if v.achar_texto("Nenhum Registro Encontrado", img=img):
            print("    obra sem movimento no periodo — nada a exportar", flush=True)
            return
        print("    grid carregado", flush=True)

        etapa(6, "exportar para Excel e capturar o download")
        caminho = op.exportar_grid(
            rel["exportacoes"][0]["caminho_menu"], destino)
        print("\nARQUIVO: %s (%d bytes)" % (caminho, caminho.stat().st_size), flush=True)


if __name__ == "__main__":
    try:
        main()
    except FalhaDeEtapa:
        sys.exit(1)
