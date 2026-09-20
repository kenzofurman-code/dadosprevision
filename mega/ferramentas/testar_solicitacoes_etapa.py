# -*- coding: utf-8 -*-
"""Teste piloto ao vivo do novo relatorio 'Solicitacoes por Etapa' na obra 650."""
import datetime as dt
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))

import banco
import config as cfgmod
from biblioteca import FalhaDeEtapa, Operador, centro
from carregar import carregar_relatorio
from executar import TESSERACT
from sessao import Sessao
from visao import Visao


def log(msg):
    print("%s  [PILOTO] %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def executar_piloto(obra_cod="650"):
    cfg = cfgmod.carregar()
    obra = cfgmod.obra(cfg, obra_cod)
    data_iso = dt.date.today().isoformat()
    pasta = RAIZ / "dados" / "bruto" / data_iso
    pasta.mkdir(parents=True, exist_ok=True)
    falhas_dir = RAIZ / "dados" / "falhas"
    falhas_dir.mkdir(parents=True, exist_ok=True)

    log("Iniciando teste piloto na obra %s (%s)..." % (obra["codigo"], obra["nome"]))

    with Sessao() as s:
        log("login: %s" % s.entrar())
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESSERACT)
        op = Operador(erp, visao=v, log=log)
        op.esperar_erp_pronto(timeout=300)

        # 1. Troca de empresa
        log("Troca para empresa %s (%s)..." % (obra["codigo"], obra["nome"]))
        op.trocar_empresa(obra["codigo"], obra["nome"])

        # 2. Abrir tela 'Solicitações' -> módulo 'Compras'
        log("Abrindo menu Solicitações -> Compras...")
        op.abrir_tela("Solicitações", ("RELATÓRIOS", "LISTAGENS"), palavra_modulo="Compras")

        # 3. Selecionar o relatório 'SOLICITAÇÕES POR ETAPA'
        log("Procurando 'SOLICITAÇÕES POR ETAPA' na listagem...")
        op.clicar_texto("SOLICITAÇÕES POR ETAPA")
        time.sleep(2)

        # 4. Clicar no botão 'Executar'
        log("Clicando em Executar...")
        try:
            op.clicar_texto("Executar", timeout=5)
        except FalhaDeEtapa:
            log("   'Executar' ilegivel pelo OCR; ancorando em 'Visualizar'")
            caixa_vis = op.esperar_texto("Visualizar", timeout=15)
            op.pagina.mouse.click(caixa_vis.x + 65, caixa_vis.y + caixa_vis.altura // 2)

        # 5. Esperar janela de parâmetros
        log("Aguardando janela de parâmetros (R_ADM_SOLICITACAO_DBM_TESTE4.RPT)...")
        caixa_solic = op.esperar_texto("Solicitações emitidas", timeout=60)
        time.sleep(2)

        # Localizar o campo da data final após 'até' na mesma linha de 'Solicitações emitidas'
        log("Preenchendo data final de emissão para hoje...")
        img = op.tela()
        palavras_linha = [p for p in op.v.palavras_todas(img)
                          if abs(p["y"] - caixa_solic.y) <= 18]
        caixa_ate = None
        for p in palavras_linha:
            if p["texto"].lower() in ("ate", "até"):
                caixa_ate = p
                break

        if caixa_ate:
            campo_data_x = caixa_ate["x"] + caixa_ate.get("w", 25) + 65
            campo_data_y = caixa_ate["y"] + caixa_ate.get("h", 16) // 2
        else:
            campo_data_x = caixa_solic.x + caixa_solic.largura + 225
            campo_data_y = caixa_solic.y + caixa_solic.altura // 2

        op.pagina.mouse.click(campo_data_x, campo_data_y)
        time.sleep(1)

        # Limpar a data antiga
        op.tecla("End")
        for _ in range(15):
            op.tecla("Backspace", pausa=0.04)

        # Digitar data de hoje no formato BR
        hoje_br = dt.date.today().strftime("%d/%m/%Y")
        log("Digitando data final: %s" % hoje_br)
        op.digitar(hoje_br, pausa=0.1)
        time.sleep(1)

        # Clicar no botão azul 'Confirmar'
        log("Clicando em Confirmar...")
        img = op.tela()
        caixa_conf = op.v.achar_texto("Confirmar", img=img)
        caixa_canc = op.v.achar_texto("Cancelar", img=img)
        caixa_relat = op.v.achar_texto("Relatórios", img=img) or op.v.achar_texto("Relatorios", img=img)

        if caixa_conf:
            log("   'Confirmar' localizado diretamente em (%d, %d)" % (caixa_conf.x, caixa_conf.y))
            op.pagina.mouse.click(caixa_conf.x + caixa_conf.largura // 2,
                                  caixa_conf.y + caixa_conf.altura // 2)
        elif caixa_canc:
            log("   'Confirmar' ancorado a esquerda de 'Cancelar' (%d, %d)" % (caixa_canc.x - 70, caixa_canc.y))
            op.pagina.mouse.click(caixa_canc.x - 70,
                                  caixa_canc.y + caixa_canc.altura // 2)
        elif caixa_relat:
            log("   'Confirmar' ancorado a direita de 'Relatórios'")
            op.pagina.mouse.click(caixa_relat.x + caixa_relat.largura + 60,
                                  caixa_relat.y + caixa_relat.altura // 2)
        else:
            log("   nenhum botao lido; enviando Enter")
            op.tecla("Enter", pausa=1.0)

        # Enviar Enter adicional como garantia
        op.tecla("Enter", pausa=1.0)
        time.sleep(2)

        # Salvar screenshot de confirmacao
        try:
            op.pagina.screenshot(path=str(falhas_dir / "pos_confirmar.png"))
            log("   screenshot de confirmacao salvo em pos_confirmar.png")
        except Exception:
            pass

        # 6 e 7. Exportar via Crystal Reports Viewer
        destino_final = pasta / ("Solicitacoes_Por_Etapa_%s_%s.xls" % (obra["codigo"], data_iso))
        op.exportar_crystal_relatorio(destino_final, timeout_espera_geracao=300)

        # 8. Encerrar sessão
        log("Encerrando sessão no ERP...")
        op.encerrar_sessao()

    # 10. Carregar no Postgres
    log("Iniciando carga no PostgreSQL...")
    conn = banco.conectar()
    res_simulado = {"ok": [obra["codigo"]], "sem_movimento": [], "falhou": []}
    relatos = carregar_relatorio(cfg, conn, "solicitacoes_por_etapa", data_iso, pasta, res_simulado)
    conn.commit()
    log("Resultado da carga: %s" % relatos)

    log("TESTE PILOTO CONCLUIDO COM SUCESSO ABSOLUTO!")


if __name__ == "__main__":
    executar_piloto()
