# -*- coding: utf-8 -*-
"""Executa um relatorio para todas as obras, numa unica sessao.

Uma obra que falha nao derruba as outras: registra, captura a tela e segue.
Ao final grava o manifesto que o consolidador le para distinguir "obra sem
movimento" de "obra que falhou" — sem isso a regra conservadora bloquearia o
consolidado para sempre por causa de obras legitimamente vazias.
"""
import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config as cfgmod
from sessao import Sessao
from visao import Visao, Caixa, centro
from biblioteca import Operador, FalhaDeEtapa

from plataforma import caminho_tesseract

RAIZ = Path(__file__).resolve().parent.parent
TESSERACT = caminho_tesseract()


def agora():
    return dt.datetime.now().strftime("%H:%M:%S")


def log(msg):
    print("%s  %s" % (agora(), msg), flush=True)


def preparar_itens_solicitados(op, rel, obra):
    """Passos especificos da tela de Itens Solicitados."""
    op.clicar_texto("Mostrar apenas Itens Solicitados")

    rotulo = op.esperar_texto("Data de emissao", timeout=30)
    campo = Caixa(rotulo.x, rotulo.y + rotulo.altura + 4, 90, 18, "", 0)
    inicial = "01/01/2025"
    for passo in rel.get("preparo", []):
        if passo.get("tipo") == "data" and passo.get("valor"):
            inicial = passo["valor"]
    dia, mes, ano = inicial.split("/")
    op.digitar_data(campo, dia, mes, ano)

    # o botao Filtrar e ilegivel para o OCR (branco sobre azul solido);
    # ancoramos no "Limpar Filtros" logo abaixo
    op.clicar_relativo("Limpar Filtros", dy=-26)


def preparar_pedidos_compra(op, rel, obra):
    """Pedidos de Compra: so a data inicial; a final ja vem como fim do mes.

    Diferente de itens_solicitados, aqui NAO ha visao a marcar, e o padrao da
    data e o mes corrente (nao hoje-ate-hoje).
    """
    rotulo = op.esperar_texto("Data de emissao", timeout=30)
    campo = Caixa(rotulo.x, rotulo.y + rotulo.altura + 4, 90, 18, "", 0)
    inicial = "01/01/2025"
    for passo in rel.get("preparo", []):
        if passo.get("tipo") == "data" and passo.get("valor"):
            inicial = passo["valor"]
    dia, mes, ano = inicial.split("/")
    op.digitar_data(campo, dia, mes, ano)
    op.clicar_relativo("Limpar Filtros", dy=-26)


def preparar_visualizacao_itens(op, rel, obra):
    """Visualizacao de Itens Solicitados: digitar o orcamento da obra.

    Aqui NAO ha campo Filial — a tela filtra por orcamento. A conferencia
    anticontaminacao muda de forma: como a lista de orcamentos e por empresa,
    digitar o codigo de outra obra deixa a DESCRICAO ao lado vazia. Entao a
    descricao preenchida e a prova de que a empresa ativa e a certa.
    """
    rotulo = op.esperar_texto("Orcamento", timeout=40)
    op.pagina.mouse.click(rotulo.x + rotulo.largura + 55,
                          rotulo.y + rotulo.altura // 2)
    time.sleep(1.2)
    op.digitar(str(obra["orcamento"]))
    time.sleep(1.5)
    op.tecla("Tab")               # sair do campo dispara a validacao do codigo
    time.sleep(4)

    # A descricao aparece a DIREITA do campo. Nao da para procurar um texto
    # especifico (cada obra tem o seu); o que importa e que o campo resolveu em
    # ALGUMA descricao. Se ficar vazio, o codigo nao pertence a empresa ativa —
    # e essa e a conferencia anticontaminacao desta tela, que nao tem Filial.
    faixa = (rotulo.x + 140, max(0, rotulo.y - 8), 460, rotulo.altura + 18)
    img = op.v.capturar(regiao=faixa, cutucar=True)
    descricao = [p["texto"] for p in op.v.palavras_todas(img)
                 if p["conf"] >= 45 and len(p["texto"]) >= 3]
    if not descricao:
        raise FalhaDeEtapa(
            "o orcamento %s nao resolveu em descricao nenhuma — a empresa ativa "
            "provavelmente nao e a obra %s" % (obra["orcamento"], obra["codigo"]))
    op.log("   orcamento %s aceito: %s" % (obra["orcamento"],
                                           " ".join(descricao)[:40]))

    # Aqui "Filtrar" e "Limpar filtro" ficam LADO A LADO, nao empilhados como na
    # outra tela: o deslocamento e horizontal.
    op.clicar_relativo("Limpar filtro", dx=-94, dy=0)
    op.log("   Filtrar clicado; aguardando carregamento do grid de itens...")

    limite = time.time() + 180
    while time.time() < limite:
        img = op.tela()
        if (op.v.achar_texto("Status do Item", img=img)
                or op.v.achar_texto("Nenhum Registro Encontrado", img=img)):
            op.log("   grid carregado com sucesso")
            time.sleep(5)
            return
        time.sleep(5)
    op.log("   aviso: timeout aguardando conclusao do grid; prosseguindo")


def preparar_analise_saldo(op, rel, obra):
    """Analise de Saldo: digitar o orcamento, marcar Nominal, Executar.

    CORRECAO de uma conclusao anterior: eu havia registrado que o campo Orcamento
    "ja vem preenchido pela empresa ativa". NAO vem. O que observei na exploracao
    manual era estado remanescente de uma tela usada antes na mesma sessao; numa
    sessao limpa o campo esta vazio.

    A verificacao anticontaminacao continua valendo, so muda de forma: como a
    lista de orcamentos e por empresa, digitar um codigo que nao pertence a
    empresa ativa deixa a descricao vazia.
    """
    rotulo = op.esperar_texto("Orcamento", timeout=60)
    op.pagina.mouse.click(rotulo.x + rotulo.largura + 45,
                          rotulo.y + rotulo.altura // 2)
    time.sleep(1.2)
    op.digitar(str(obra["orcamento"]))
    time.sleep(1.5)
    op.tecla("Tab")
    time.sleep(4)

    # Recorte estreito nao funciona para um numero de 3 digitos; le-se a faixa do
    # painel na altura do rotulo, larga o bastante para pegar codigo e descricao.
    faixa = (0, max(0, rotulo.y - 14), 780, rotulo.altura + 30)
    img = op.v.capturar(regiao=faixa, cutucar=True)
    lidos = [p["texto"] for p in op.v.palavras_todas(img) if p["conf"] >= 35]
    juntos = " ".join(lidos)
    if str(obra["orcamento"]) not in juntos:
        raise FalhaDeEtapa(
            "digitei o orcamento %s e a tela nao o refletiu (li %r) — o codigo "
            "pode nao pertencer a empresa ativa"
            % (obra["orcamento"], juntos[:60]))
    op.log("   orcamento %s aceito (%s)" % (obra["orcamento"], juntos[:45]))

    # Localizar "Nominal" UMA VEZ e reusar a posicao para as duas acoes. Procurar
    # duas vezes dobra a chance de uma leitura falhar — e ela falha de forma
    # intermitente mesmo em texto que costuma sair com confianca 96.
    caixa = op.esperar_texto("Nominal", timeout=90)
    x, y = centro(caixa)

    # O radio NAO vem em Nominal por padrao: a tela abre em "Real Atualizado".
    op.pagina.mouse.click(x, y)
    time.sleep(2)

    # "Executar" e branco sobre azul e o OCR nao le, igual ao "Filtrar".
    # Deslocamento MEDIDO a 1600x900: Nominal em (618,177), Executar em (874,185).
    op.pagina.mouse.click(x + 256, y + 8)
    time.sleep(30)


PREPARADORES = {
    "analise_saldo_solicitacao": preparar_analise_saldo,
    "itens_solicitados": preparar_itens_solicitados,
    "pedidos_compra": preparar_pedidos_compra,
    "visualizacao_itens": preparar_visualizacao_itens,
}


def uma_obra(op, v, rel, obra, data_iso, pasta):
    op.trocar_empresa(obra["codigo"], obra["nome"])
    return _rodar_relatorio_na_obra_ativa(op, v, rel, obra, data_iso, pasta)


def _rodar_relatorio_na_obra_ativa(op, v, rel, obra, data_iso, pasta):
    """O corpo de uma_obra() sem a troca de empresa.

    Extraido para o modo "por obra" (executar_por_obra): la, a troca de
    empresa acontece UMA vez por obra, nao uma vez por (obra, relatorio) --
    esta funcao roda o relatorio pressupondo que a empresa ativa ja e a
    da obra.
    """
    op.abrir_tela(rel["busca_tela"], rel["ancora_titulo_tela"],
                  palavra_modulo=rel.get("palavra_modulo"))
    if rel.get("confere_filial", True):
        op.conferir_filial(obra["codigo"])

    PREPARADORES[rel["id"]](op, rel, obra)
    time.sleep(25)

    img = op.tela()
    if v.achar_texto("Nenhum Registro Encontrado", img=img):
        return ("sem_movimento", [])

    # Uma tela pode produzir varias exportacoes (a Analise de Saldo gera tres,
    # uma por aba). Trocar de aba NAO exige reexecutar a consulta.
    caminhos = []
    for exp in rel["exportacoes"]:
        if exp.get("aba"):
            op.log("   clicando na aba: %s" % exp["aba"])
            op.clicar_texto(exp["aba"])
            time.sleep(8)
        destino = pasta / cfgmod.nome_arquivo(exp, obra["codigo"], data_iso)
        # x/y sao opcionais no config.yaml: o padrao (700,300) de exportar_grid
        # so funciona em telas com cabecalho de UMA linha. Telas com cabecalho
        # de duas linhas (ex.: Analise de Saldo) precisam de um y maior, senao
        # o clique cai no cabecalho e abre o menu de coluna, nao o de exportar.
        op.log("   exportando grid para %s (x=%s, y=%s)..."
               % (destino.name, exp.get("x", 700), exp.get("y", 300)))
        caminhos.append(op.exportar_grid(
            exp["caminho_menu"], destino,
            x=exp.get("x", 700), y=exp.get("y", 300)))
    return ("ok", caminhos)


def executar_relatorio(op, v, s, rel, obras, data_iso, pasta, falhas_dir, log):
    """O laço de uma execucao de relatorio por todas as obras, extraido de
    main() para ser reutilizavel por rodar_noite.py (varias execucoes numa
    unica sessao) sem duplicar a logica de reconexao e falha por obra."""
    resultado = {"ok": [], "sem_movimento": [], "falhou": []}
    for i, obra in enumerate(obras, 1):
        log("")
        log("[%d/%d] obra %s - %s" % (i, len(obras), obra["codigo"], obra["nome"]))
        try:
            if op is not None and op.pagina.is_closed():
                log("   sessao caida; reconectando")
                erp = s.abrir_erp()
                v = Visao(erp, binario_tesseract=TESSERACT)
                op = Operador(erp, visao=v, log=log)
                op.esperar_erp_pronto(timeout=300)
                log("   reconectado")
            estado, caminhos = uma_obra(op, v, rel, obra, data_iso, pasta)
            if estado == "sem_movimento":
                log("   sem movimento no periodo")
                resultado["sem_movimento"].append(obra["codigo"])
            else:
                for c in caminhos:
                    log("   OK: %s (%d bytes)" % (c.name, c.stat().st_size))
                resultado["ok"].append(obra["codigo"])
        except Exception as e:
            log("   FALHOU: %s" % str(e).splitlines()[0][:110])
            resultado["falhou"].append({"obra": obra["codigo"], "motivo": str(e)})
            if op is not None and "closed" in str(e).lower():
                try:
                    erp = s.abrir_erp()
                    v = Visao(erp, binario_tesseract=TESSERACT)
                    op = Operador(erp, visao=v, log=log)
                    op.esperar_erp_pronto(timeout=300)
                    log("   reconectado apos queda")
                except Exception as e2:
                    log("   reconexao falhou: %s" % str(e2).splitlines()[0][:80])
            if op is not None:
                try:
                    op.pagina.screenshot(path=str(falhas_dir / ("%s_%s.png"
                                         % (data_iso, obra["codigo"]))))
                except Exception:
                    pass
    return resultado


def executar_por_obra(op, v, s, relatorios, obras, data_iso, pasta, falhas_dir, log,
                      tempo_limite=None):
    """Para cada obra, troca de empresa UMA vez e roda todos os relatorios em
    seguida, em vez de rodar um relatorio inteiro (todas as obras) por vez
    como executar_relatorio() faz.

    Reduz as trocas de empresa de uma por (obra, relatorio) para uma por
    obra -- de 32 para 8 numa noite de 4 relatorios x 8 obras. A troca de
    empresa e a operacao mais fragil do robo (ver Operador.trocar_empresa);
    trocar menos vezes reduz a exposicao a ela.

    tempo_limite (um valor de time.time()) interrompe o loop de obras assim
    que estourado -- sem ele, uma execucao lenta o bastante (ex.: VPS
    sobrecarregada) pode rodar por tempo indefinido. BUG REAL: sem esse
    limite, a execucao noturna de 2026-09-14 ficou presa por ~24h, consumindo
    a CPU da VPS inteira e afetando outros servicos hospedados nela.
    """
    resultados = {rel["id"]: {"ok": [], "sem_movimento": [], "falhou": []}
                 for rel in relatorios}
    for i, obra in enumerate(obras, 1):
        if tempo_limite is not None and time.time() > tempo_limite:
            log("")
            log("tempo limite da noite estourado -- pulando as %d obras restantes"
                % (len(obras) - i + 1))
            break
        log("")
        log("[%d/%d] obra %s - %s" % (i, len(obras), obra["codigo"], obra["nome"]))
        try:
            if op is not None and op.pagina.is_closed():
                log("   sessao caida; reconectando")
                erp = s.abrir_erp()
                v = Visao(erp, binario_tesseract=TESSERACT)
                op = Operador(erp, visao=v, log=log)
                op.esperar_erp_pronto(timeout=300)
                log("   reconectado")
            op.trocar_empresa(obra["codigo"], obra["nome"])
        except Exception as e:
            log("   FALHOU ao trocar de empresa: %s" % str(e).splitlines()[0][:110])
            for rel in relatorios:
                resultados[rel["id"]]["falhou"].append(
                    {"obra": obra["codigo"], "motivo": "troca de empresa: %s" % str(e)})
            if op is not None:
                try:
                    op.pagina.screenshot(path=str(falhas_dir / (
                        "%s_%s_trocar.png" % (data_iso, obra["codigo"]))))
                except Exception:
                    pass
            continue

        for rel in relatorios:
            try:
                estado, caminhos = _rodar_relatorio_na_obra_ativa(
                    op, v, rel, obra, data_iso, pasta)
                if estado == "sem_movimento":
                    log("   [%s] sem movimento no periodo" % rel["id"])
                    resultados[rel["id"]]["sem_movimento"].append(obra["codigo"])
                else:
                    for c in caminhos:
                        log("   [%s] OK: %s (%d bytes)"
                            % (rel["id"], c.name, c.stat().st_size))
                    resultados[rel["id"]]["ok"].append(obra["codigo"])
            except Exception as e:
                log("   [%s] FALHOU: %s" % (rel["id"], str(e).splitlines()[0][:110]))
                resultados[rel["id"]]["falhou"].append(
                    {"obra": obra["codigo"], "motivo": str(e)})
                if op is not None and "closed" in str(e).lower():
                    try:
                        erp = s.abrir_erp()
                        v = Visao(erp, binario_tesseract=TESSERACT)
                        op = Operador(erp, visao=v, log=log)
                        op.esperar_erp_pronto(timeout=300)
                        log("   reconectado apos queda")
                    except Exception as e2:
                        log("   reconexao falhou: %s" % str(e2).splitlines()[0][:80])
                if op is not None:
                    try:
                        op.pagina.screenshot(path=str(falhas_dir / (
                            "%s_%s_%s.png" % (data_iso, obra["codigo"], rel["id"]))))
                    except Exception:
                        pass
    return resultados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--relatorio", default="itens_solicitados")
    ap.add_argument("--obras", default="", help="lista separada por virgula")
    ap.add_argument("--data", default=dt.date.today().isoformat())
    args = ap.parse_args()

    cfg = cfgmod.carregar()
    rel = cfgmod.relatorio(cfg, args.relatorio)
    obras = cfgmod.obras(cfg)
    if args.obras:
        querem = [c.strip() for c in args.obras.split(",")]
        obras = [o for o in obras if o["codigo"] in querem]

    pasta = RAIZ / "dados" / "bruto" / args.data
    pasta.mkdir(parents=True, exist_ok=True)
    falhas_dir = RAIZ / "dados" / "falhas"
    falhas_dir.mkdir(parents=True, exist_ok=True)

    with Sessao() as s:
        log("login: %s" % s.entrar())
        s.pagina.wait_for_timeout(8000)
        erp = s.abrir_erp()
        v = Visao(erp, binario_tesseract=TESSERACT)
        op = Operador(erp, visao=v, log=log)
        op.esperar_erp_pronto(timeout=300)

        resultado = executar_relatorio(op, v, s, rel, obras, args.data, pasta,
                                       falhas_dir, log)

        log("")
        log("encerrando a sessao do Windows remoto")
        op.encerrar_sessao()

    manifesto_path = pasta / "_execucao.json"
    manifesto = {}
    if manifesto_path.exists():
        manifesto = json.loads(manifesto_path.read_text(encoding="utf-8"))
    manifesto.setdefault("data", args.data)
    manifesto.setdefault("exportacoes", {})
    for exp in rel["exportacoes"]:
        manifesto["exportacoes"][exp["arquivo"]] = {
            "sem_movimento": resultado["sem_movimento"],
            "falhou": [f["obra"] for f in resultado["falhou"]],
            "ok": resultado["ok"],
        }
    manifesto_path.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2),
                              encoding="utf-8")

    log("")
    log("RESUMO  ok=%d  sem_movimento=%d  falhou=%d"
        % (len(resultado["ok"]), len(resultado["sem_movimento"]),
           len(resultado["falhou"])))
    for f in resultado["falhou"]:
        log("   obra %s: %s" % (f["obra"], f["motivo"][:70]))
    log("manifesto: %s" % manifesto_path)
    return 1 if resultado["falhou"] else 0


if __name__ == "__main__":
    sys.exit(main())
