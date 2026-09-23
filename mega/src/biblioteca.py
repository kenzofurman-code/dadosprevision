# -*- coding: utf-8 -*-
"""Primitivas de operacao do Mega, com as regras aprendidas em campo embutidas.

Cada regra aqui veio de uma falha observada em 2026-09-01, nao de suposicao.
Estao comentadas onde aparecem para que ninguem as "simplifique" depois.
"""
import time
from pathlib import Path

from visao import Visao, centro


class FalhaDeEtapa(Exception):
    """Interrompe a obra atual. O robo registra, captura a tela e segue."""


class Operador:
    # Unicos alvos que sao icone e nao texto — medidos na barra lateral a 1600x900.
    # Tudo o mais e localizado por OCR justamente para nao depender de coordenada.
    ICONE_PESSOA = (33, 113)
    ICONE_LUPA = (33, 215)

    def __init__(self, pagina, visao=None, pasta_downloads=None, log=print):
        self.pagina = pagina
        self.v = visao or Visao(pagina)
        self.pasta_downloads = Path(pasta_downloads or "dados/downloads")
        self.pasta_downloads.mkdir(parents=True, exist_ok=True)
        self.log = log

    # ------------------------------------------------------------- primitivas
    def tela(self, cutucar=True, ponto=None):
        return self.v.capturar(cutucar=cutucar, ponto=ponto)

    def esperar_texto(self, alvo, timeout=60, intervalo=3, ponto_cutucao=None, regiao=None):
        """Espera um texto (ou qualquer um de uma lista/tupla de textos) aparecer e devolve sua caixa.
        Ancora de progresso.
        """
        limite = time.time() + timeout
        alvos = [alvo] if isinstance(alvo, str) else list(alvo)
        while time.time() < limite:
            img = self.tela(ponto=ponto_cutucao)
            erro = self.v.dialogo_de_erro(img=img)
            if erro:
                raise FalhaDeEtapa("dialogo de erro na tela: %r" % erro)
            if len(alvos) > 1:
                todas = self.v.palavras_todas(img)
                texto_tela = " ".join(p["texto"].lower() for p in todas)
                for a in alvos:
                    if a.lower() in texto_tela:
                        caixa = self.v.achar_texto(a, img=img, regiao=regiao)
                        if caixa:
                            return caixa
                        p_match = next((p for p in todas if a.lower() in p["texto"].lower()), None)
                        if p_match:
                            from visao import Caixa
                            return Caixa(p_match["x"], p_match["y"], p_match.get("w", 30), p_match.get("h", 16))
            else:
                caixa = self.v.achar_texto(alvos[0], img=img, regiao=regiao)
                if caixa:
                    return caixa
            time.sleep(intervalo)
        raise FalhaDeEtapa("texto %r nao apareceu em %ds" % (alvo, timeout))

    # A sessao pode ser NOVA (tela inicial "Bem-vindo") ou REAPROVEITADA, com
    # QUALQUER tela aberta de uma execucao anterior. Listar telas conhecidas nao
    # funciona: sempre aparece uma que nao esta na lista, e o robo conclui que o
    # ERP nao subiu quando ele esta pronto.
    #
    # "Mega ERP" e o item da barra de tarefas do Windows remoto: existe sempre que
    # o ERP esta rodando, seja qual for a tela. E a ancora certa.
    ANCORAS_PRONTO = ("Mega ERP", "Bem-vindo", "Gestao Empresarial", "Visoes",
                      "ITENS SOLICITADOS", "Saldo Resumido", "PEDIDOS DE COMPRA")

    # Telas do ERP ja carregado. Encontrar uma delas e prova de que a interface
    # esta desenhada e responde.
    ANCORAS_TELA = ("Bem-vindo", "Gestao Empresarial", "Visoes",
                    "ITENS SOLICITADOS", "Saldo Resumido", "PEDIDOS DE COMPRA",
                    "Solicitacoes", "Orcamento", "RELATÓRIOS", "Relatórios",
                    "Contratos", "Menu", "Procurar")

    def responder_sessao_duplicada(self, img=None):
        """Responde ao "usuario ja esta logado em uma sessao RDP. Desconecta-lo?".

        O Mega mostra esse dialogo quando o mesmo usuario entra de novo. Se
        ninguem responde, ele fica bloqueando a sessao e TUDO abaixo falha — o
        sintoma aparece como "painel nao abriu", "tela nao carregou", e leva a
        investigar a causa errada. Aconteceu aqui por horas.

        O robo responde "Sim": assume a sessao. O botao Sim e branco sobre azul e
        o OCR nao le; o "Nao" ao lado e escuro sobre claro e le bem. Ancoramos
        nele. Deslocamento medido a 1600x900: Nao em (992,493), Sim em (874,493).
        """
        img = self.tela() if img is None else img
        marcas = ("ja esta logado", "deseja desconecta", "sessao rdp")
        texto = " ".join(p["texto"] for p in self.v.palavras_todas(img)
                         if p["conf"] >= 40)
        from visao import _normalizar
        normalizado = _normalizar(texto)
        if not any(m in normalizado for m in marcas):
            return False

        # Ancoras possiveis, em ordem de preferencia. "Nao" e curto demais: com
        # o til, o OCR erra e a comparacao aproximada nao ajuda em palavra de 3
        # letras. "Confirmar" e o titulo do dialogo, escuro sobre claro e longo.
        # Deslocamentos medidos a 1600x900:
        #   Confirmar em (593,366) -> Sim em (874,493)
        #   Nao       em (992,493) -> Sim em (874,493)
        # Nenhum dos BOTOES e legivel (ambos com fundo colorido). O texto da
        # pergunta le com confianca 91-93, entao a ancora e ele. Deslocamentos
        # medidos a 1600x900, com o Sim em (874,493):
        for texto, dx, dy in (("desconecta-lo?", 145, 74),
                              ("Deseja", 220, 73),
                              ("Confirmar", 281, 127),
                              ("Nao", -118, 0)):
            caixa = self.v.achar_texto(texto, img=img)
            if not caixa:
                continue
            x, y = centro(caixa)
            self.log("   sessao duplicada: assumindo a sessao (Sim)")
            self.pagina.mouse.click(x + dx, y + dy)
            time.sleep(8)
            return True
        raise FalhaDeEtapa("dialogo de sessao duplicada na tela e nao achei ancora")

    def esperar_erp_pronto(self, timeout=240, intervalo=6, minimo_palavras=10):
        """Espera o ERP ficar utilizavel, nao apenas iniciado.

        Duas armadilhas ja pegas aqui:
        - listar telas conhecidas: a sessao reaproveitada pode estar em qualquer
          tela, e uma fora da lista fazia o robo desistir do ERP pronto;
        - aceitar so o item "Mega ERP" da barra de tarefas: ele aparece enquanto
          o app AINDA ESTA SUBINDO, e o robo entrava cedo, com nada respondendo.

        Por isso: uma tela conhecida, OU a barra de tarefas junto com uma tela
        efetivamente desenhada (contagem minima de palavras).
        """
        limite = time.time() + timeout
        ultimo_log = 0
        segundos_sem_palavras = 0
        segundos_com_launcher = 0
        ultimo_clique_taskbar = 0
        while time.time() < limite:
            img = self.tela()
            if self.responder_sessao_duplicada(img=img):
                continue
            for alvo in self.ANCORAS_TELA:
                if self.v.achar_texto(alvo, img=img):
                    self.log("   ERP pronto (tela: %s)" % alvo)
                    return alvo
            palavras = [p for p in self.v.palavras_todas(img) if p["conf"] >= 50]
            if len(palavras) >= minimo_palavras and self.v.achar_texto("Mega ERP", img=img):
                self.log("   ERP pronto (%d palavras na tela)" % len(palavras))
                return "conteudo"

            # Se a janela estiver minimizada (tela com menos de 6 palavras e sem ancoras)
            # e o item "Mega ERP" estiver na barra de tarefas (Y >= 840):
            # Clicar no botao da barra de tarefas para restaurar a tela (com debounce de 15s).
            if len(palavras) < 6 and (time.time() - ultimo_clique_taskbar > 15):
                caixa_erp_tb = self.v.achar_texto("Mega ERP", img=img)
                if caixa_erp_tb and caixa_erp_tb.y >= 840:
                    self.log("   'Mega ERP' detectado na barra de tarefas com tela minimizada; clicando para focar/restaurar")
                    cx, cy = centro(caixa_erp_tb)
                    try:
                        self.pagina.mouse.click(cx, cy)
                        ultimo_clique_taskbar = time.time()
                        time.sleep(3)
                    except Exception:
                        pass

            # Se o splash "Mega ERP Launcher" estiver na tela (card central com barra roxa):
            # No Linux sob Xvfb ele dura apenas ~5-10s enquanto o Auth Launcher valida o token.
            # Apenas garantimos foco no canvas se demorar mais que o normal.
            if self.v.achar_texto("Mega ERP Launcher", img=img):
                segundos_com_launcher += intervalo
                if segundos_com_launcher >= 20:
                    self.log("   'Mega ERP Launcher' ativo ha %ds; garantindo foco" % segundos_com_launcher)
                    try:
                        self.pagina.bring_to_front()
                        self.pagina.mouse.click(800, 450)
                    except Exception:
                        pass
                    segundos_com_launcher = 0
            else:
                segundos_com_launcher = 0

            # Se a tela esta totalmente sem texto (ex.: fundo azul solido do Windows
            # enquanto o app ou logon estao aguardando foco/interacao):
            if len(palavras) == 0:
                segundos_sem_palavras += intervalo
                if segundos_sem_palavras >= 15 and segundos_sem_palavras % 15 < intervalo:
                    self.log("   tela sem texto (%ds): focando canvas e enviando interacao de despertar"
                             % segundos_sem_palavras)
                    try:
                        self.pagina.bring_to_front()
                        self.pagina.mouse.click(20, 20)
                    except Exception:
                        pass
            else:
                segundos_sem_palavras = 0

            # Log periodico (a cada ~30s): sem isso, uma espera de ate 300s que
            # acaba estourando nao deixa NENHUM rastro do que estava acontecendo
            # na tela nesse meio-tempo -- so a mensagem final de timeout. BUG
            # REAL: em 2026-09-13 o ERP nao ficou pronto em 300s numa execucao
            # real e nao houve como saber o motivo depois.
            if time.time() - ultimo_log > 30:
                ultimo_log = time.time()
                self.log("   ainda esperando o ERP (%d palavras lidas, 'Mega ERP' achado: %s)"
                         % (len(palavras), bool(self.v.achar_texto("Mega ERP", img=img))))
            time.sleep(intervalo)
        # Screenshot da falha: o navegador fecha logo em seguida (finally de
        # rodar_noite.py), entao sem isso nao sobra nenhuma evidencia visual do
        # que travou.
        try:
            pasta_falhas = Path("dados/falhas")
            pasta_falhas.mkdir(parents=True, exist_ok=True)
            caminho = pasta_falhas / ("erp_nao_pronto_%d.png" % int(time.time()))
            self.pagina.screenshot(path=str(caminho))
            self.log("   screenshot da falha salvo: %s" % caminho)
        except Exception as e:
            self.log("   nao consegui salvar screenshot da falha: %s" % str(e)[:60])
        raise FalhaDeEtapa("o ERP nao ficou pronto em %ds" % timeout)

    def clicar_texto(self, alvo, ancora=None, timeout=45, tentativas=2):
        """Clica num texto e confirma pelo efeito, nao pela intencao.

        REGRA DE CAMPO: nao existe "clique de aquecimento" universal. O primeiro
        clique as vezes so entrega foco, mas em controles que alternam um segundo
        clique preventivo DESFAZ o primeiro. Por isso: clicar uma vez, verificar a
        ancora, e so repetir se ela nao apareceu.
        """
        for tentativa in range(1, tentativas + 1):
            caixa = self.esperar_texto(alvo, timeout=timeout)
            x, y = centro(caixa)
            self.pagina.mouse.click(x, y)
            time.sleep(2)
            if ancora is None:
                return caixa
            img = self.tela()
            if self.v.achar_texto(ancora, img=img):
                return caixa
            self.log("   %r nao surtiu efeito (tentativa %d); repetindo" % (alvo, tentativa))
        raise FalhaDeEtapa("cliquei em %r mas %r nunca apareceu" % (alvo, ancora))

    def clicar_relativo(self, texto_ancora, dx=0, dy=0, ancora=None, timeout=45):
        """Clica num deslocamento a partir de um texto legivel.

        Existe por um caso concreto: o botao "Filtrar" e texto branco sobre azul
        solido e o Tesseract nao le, em nenhum pre-processamento que testei
        (normal, invertido, binarizado, ampliado 5x). Ja o "Limpar Filtros" logo
        abaixo le com confianca 96. Entao ancoramos no vizinho legivel.

        E preferivel a coordenada fixa porque o par ancora-alvo se move junto.
        """
        caixa = self.esperar_texto(texto_ancora, timeout=timeout)
        x, y = centro(caixa)
        self.pagina.mouse.click(x + dx, y + dy)
        time.sleep(2)
        if ancora:
            img = self.tela()
            if not self.v.achar_texto(ancora, img=img):
                self.pagina.mouse.click(x + dx, y + dy)
                time.sleep(2)
        return (x + dx, y + dy)

    def digitar(self, texto, pausa=0.4):
        self.pagina.keyboard.type(texto, delay=60)
        time.sleep(pausa)

    def tecla(self, tecla, pausa=0.6):
        self.pagina.keyboard.press(tecla)
        time.sleep(pausa)

    def digitar_data(self, caixa_do_campo, dia, mes, ano):
        """Preenche campo de data mascarado.

        REGRA DE CAMPO: e a unica forma que funciona. Digitar "01/01/2025" faz as
        barras avancarem o segmento e embaralha o ano (virou 01/09/0101). Digitar
        "01012025" de uma vez o gateway nao acompanha e o ERP abre modal
        "Data Invalida". Ctrl+A nao seleciona neste controle; triple-click idem.
        Tem de ser: clicar no segmento do DIA, Home, e tres blocos com pausa.
        """
        x = caixa_do_campo.x + 8          # segmento do dia, nao o meio do campo
        y = caixa_do_campo.y + caixa_do_campo.altura // 2
        self.pagina.mouse.click(x, y)
        time.sleep(1.0)
        self.tecla("Home")
        for bloco in (dia, mes, ano):
            self.digitar(bloco, pausa=0.7)
        time.sleep(1.5)
        img = self.tela()
        erro = self.v.dialogo_de_erro(img=img)
        if erro:
            raise FalhaDeEtapa("data recusada pelo ERP (%s)" % erro)

    # ---------------------------------------------------------------- empresa
    def _barra_da_empresa(self, faixa=(0, 0, 900, 50)):
        """Acha por OCR onde esta o nome da empresa na barra do topo.

        Coordenada fixa aqui e armadilha: a barra muda de lugar conforme a
        resolucao da sessao. Uma versao anterior usava (200, 23), medido em
        capturas de 1568x753, e errava o alvo a 1600x900.
        """
        img = self.v.capturar(regiao=faixa, cutucar=True)
        palavras = [p for p in self.v.palavras_todas(img) if p["conf"] >= 45]
        if not palavras:
            raise FalhaDeEtapa("nao localizei o nome da empresa na barra do topo")
        p = min(palavras, key=lambda w: w["x"])       # o codigo vem primeiro
        return (faixa[0] + p["x"] + p["w"] // 2,
                faixa[1] + p["y"] + p["h"] // 2)

    def trocar_empresa(self, codigo, nome=None):
        """Troca a obra pelo NOME DA EMPRESA na barra do topo.

        REGRA DE CAMPO: nunca pelo menu do usuario. La, "Trocar de Empresa" e
        "Trocar Senha do Usuario" ficam a 35px, e a posicao deles muda conforme o
        tamanho do nome da empresa ativa - o que ja levou um clique a abrir a tela
        de senha e digitar o codigo da obra no campo "Senha atual".
        """
        # Abre o painel do usuario (icone de pessoa, primeiro da barra lateral).
        # A barra do topo com o nome da empresa costuma vir RECOLHIDA quando a
        # sessao e nova, entao nao da para depender dela. Confirma por QUALQUER
        # texto do painel que o OCR costume ler bem -- nao so "Trocar Senha do
        # Usuario". BUG REAL, confirmado ao vivo em 2026-09-13: numa execucao
        # real longa, "Trocar Senha do Usuario" ficou ilegivel por quase 20min
        # seguidos (todas as trocas de empresa falhando com "painel nao abriu"),
        # mas encerrar_sessao() -- que procura "Sair"/"Encerrar Sessao"/etc no
        # MESMO painel -- abriu de primeira. Ou seja, o painel provavelmente
        # estava aberto o tempo todo; so aquele texto especifico e que nao
        # estava legivel sob uso prolongado. Aceitar varios candidatos reduz
        # falso negativo.
        TEXTOS_PAINEL_ABERTO = ("Trocar Senha do Usuario", "Sair",
                                "Encerrar Sessão", "Desconectar", "Log Off")
        for tentativa in (1, 2, 3):
            # Envia Escape preventivo para fechar qualquer dialogo modal aberto (ex: Exportar Relatório pendente)
            self.tecla("Escape", pausa=0.5)
            # Se o visualizador do Crystal Reports ainda estiver na frente, fecha
            self.fechar_visualizador_crystal()

            self.pagina.mouse.click(self.ICONE_PESSOA[0], self.ICONE_PESSOA[1])
            time.sleep(3.0)
            img = self.tela()
            if any(self.v.achar_texto(t, img=img) for t in TEXTOS_PAINEL_ABERTO):
                break
            if tentativa == 3:
                raise FalhaDeEtapa("o painel do usuario nao abriu")

        # NUNCA clicar direto em "Trocar de Empresa": o OCR le o vizinho
        # "Trocar Senha do Usuario" com folga mas frequentemente NAO le "Trocar
        # de Empresa" (mesma cor, mesmo tamanho — nao sei por que), e um clique
        # mal calibrado ali ja abriu a tela de troca de senha em vez da arvore
        # de empresas. BUG REAL, confirmado ao vivo em 2026-09-13. Em vez de
        # tentar o texto ilegivel, ancorar sempre no vizinho legivel e clicar no
        # deslocamento MEDIDO (~35px acima) elimina essa ambiguidade de raiz.
        try:
            self.clicar_relativo("Trocar Senha do Usuario", dy=-35,
                                 ancora="ORGANIZACOES POR USUARIO", timeout=20)
        except FalhaDeEtapa:
            self.log("   'Trocar Senha do Usuario' ilegivel; ancorando no cabecalho Menu")
            self.clicar_relativo("Menu", dx=-90, dy=46,
                                 ancora="ORGANIZACOES POR USUARIO", timeout=25)

        # esperar_texto() tenta varias vezes (a cada 3s); um unico snapshot
        # aqui dava falso negativo quando a arvore so demorava um pouco mais a
        # renderizar sob uso prolongado.
        try:
            caixa_arvore = self.esperar_texto("ORGANIZACOES POR USUARIO", timeout=15)
        except FalhaDeEtapa:
            raise FalhaDeEtapa("nao consegui abrir a arvore de empresas")
        return self._digitar_codigo(codigo, caixa_arvore)

    def _digitar_codigo(self, codigo, caixa_arvore):
        # A arvore de organizacoes tem um icone de lupa (sem texto, entao o OCR
        # nunca "ve" ele) ~35px ACIMA do cabecalho "ORGANIZACOES POR USUARIO",
        # que abre o campo de busca de verdade. Digitar direto sem clicar nele
        # nao garante foco na busca incremental -- o teclado pode ir para outro
        # lugar e a arvore fica destacada num item ERRADO (de uma navegacao
        # anterior), travando aberta e quebrando toda troca de empresa seguinte
        # na mesma noite. BUG REAL, confirmado ao vivo (obra 340, 2026-09-13):
        # apos digitar "340", ficou destacada uma empresa completamente
        # diferente da digitada.
        self.pagina.mouse.click(caixa_arvore.x + 10, caixa_arvore.y - 35)
        time.sleep(1.5)
        self.digitar(str(codigo))         # busca incremental da arvore
        time.sleep(1.5)
        self.tecla("Enter")
        time.sleep(10)
        self.log("   troca solicitada para %s" % codigo)

    def conferir_filial(self, codigo):
        """Confirma a obra ativa pelo campo Filial da tela ja aberta.

        VERIFICACAO OBRIGATORIA. Sem ela, o robo exporta os dados de uma obra
        dentro do arquivo de outra — a unica falha do projeto que passaria semanas
        despercebida. Usa o campo Filial, que a propria tela preenche a partir da
        empresa ativa, em vez da barra do topo (que vem recolhida em sessao nova).
        """
        img = self.tela()
        texto = " ".join(p["texto"] for p in self.v.palavras_todas(img) if p["conf"] >= 45)
        alvo = str(codigo).lstrip("0")
        if alvo not in texto:
            raise FalhaDeEtapa("esperava a filial %s na tela, nao encontrei" % codigo)
        self.log("   filial %s confirmada na tela" % codigo)

    # ------------------------------------------------------------------- tela
    def abrir_tela(self, busca, ancora_titulo, palavra_modulo=None, timeout=60):
        """Abre uma tela pela busca do menu e confirma pelo TITULO da tela.

        REGRA DE CAMPO: ha duas telas chamadas "Follow-up de solicitacoes", e as
        duas sao usadas de verdade. Conferir o titulo depois de abrir e mais
        confiavel do que conferir o caminho do modulo antes de clicar: verifica o
        resultado, nao a intencao.
        """
        # 1. Garantir que o painel de busca lateral esta aberto.
        # Envia Escape preventivo para fechar qualquer menu de contexto residual que bloqueie a tela.
        self.tecla("Escape", pausa=0.5)
        # Se ja estiver aberto ("Procurar" visivel), nao clica na lupa para nao recolher.
        for tentativa in (1, 2, 3):
            img = self.tela()
            if self.v.achar_texto("Procurar", img=img):
                break
            self.pagina.mouse.click(self.ICONE_LUPA[0], self.ICONE_LUPA[1])
            time.sleep(3)
            if tentativa == 3:
                raise FalhaDeEtapa("o painel de busca de telas nao abriu")

        # 2. Clicar explicitamente dentro do campo de busca (x=140, y=203) para garantir foco.
        # Medido a 1600x900: o campo de busca branco fica entre x=80..219, y=190..217 (centro y=203).
        self.pagina.mouse.click(140, 203)
        time.sleep(0.4)
        # Limpar campo de busca de forma infalivel no canvas RDP (sem depender de Ctrl+A que costuma falhar no canvas)
        self.tecla("End", pausa=0.1)
        for _ in range(35):
            self.pagina.keyboard.press("Backspace")
            time.sleep(0.015)
        self.tecla("Home", pausa=0.1)
        for _ in range(35):
            self.pagina.keyboard.press("Delete")
            time.sleep(0.015)
        time.sleep(0.3)
        self.digitar(busca)
        time.sleep(3.0)
        img = self.tela()

        # 3. Localizar o card na gaveta de resultados.
        # REGIAO_GAVETA = (50, 240, 240, 600) para nunca casar texto identico da tela principal.
        REGIAO_GAVETA = (50, 240, 240, 600)
        clicou = False
        limite_busca = time.time() + 15

        import unicodedata
        def _remover_acentos(texto):
            return unicodedata.normalize('NFKD', texto).encode('ASCII', 'ignore').decode('ASCII').lower()

        # Termos discriminatorios da busca (ex: 'pedidos' em 'follow-up de pedidos')
        palavras_busca = [_remover_acentos(p) for p in busca.split()
                          if len(p) >= 4 and _remover_acentos(p) not in ("follow-up", "follow", "visao", "visoes")]

        while time.time() < limite_busca:
            # 1a prioridade: desambiguacao por modulo (ex: 'Contratos de Empreiteiros', 'Compras') quando informado explicitamente
            if palavra_modulo:
                caixa = self.v.achar_texto(palavra_modulo, img=img, regiao=REGIAO_GAVETA)
                if caixa:
                    self.log("   card localizado pelo modulo %r em y=%d" % (palavra_modulo, caixa.y))
                    # o titulo do resultado fica na linha imediatamente acima do modulo (~18px acima).
                    # O clique em x=110 acerta no centro do titulo e nunca na estrela de favoritos a direita.
                    self.pagina.mouse.click(110, max(0, caixa.y - 18))
                    clicou = True
                    break

            # 2a prioridade: se a busca tem palavra discriminatoria (ex: 'pedidos'), procurar diretamente por ela no titulo
            for termo in palavras_busca:
                if termo not in ("solicita", "solicitacao", "solicitacoes", "operacionais"):
                    caixa = self.v.achar_texto(termo, img=img, regiao=REGIAO_GAVETA)
                    if caixa:
                        self.log("   card localizado pelo termo da busca %r em y=%d" % (termo, caixa.y))
                        self.pagina.mouse.click(110, caixa.y)
                        clicou = True
                        break
            if clicou:
                break

            time.sleep(1.5)
            img = self.tela()

        if not clicou:
            # Fallback: tentar achar o texto da busca na gaveta
            caixa = self.v.achar_texto(busca, img=img, regiao=REGIAO_GAVETA)
            if caixa:
                self.pagina.mouse.click(110, caixa.y)
                clicou = True

        if not clicou:
            self.log("   aviso: clicando no primeiro resultado da busca por posicao padrao (110, 310)")
            self.pagina.mouse.click(110, 310)

        tempo_espera = max(timeout, 120)
        try:
            self.esperar_texto(ancora_titulo, timeout=tempo_espera)
        except FalhaDeEtapa:
            raise FalhaDeEtapa("abri a busca %r mas a tela %r nao apareceu em %ds"
                               % (busca, ancora_titulo, tempo_espera))
        self.log("   tela confirmada: %s" % (ancora_titulo,))

    # -------------------------------------------------------------- exportacao
    def exportar_grid(self, caminho_menu, destino, x=700, y=300,
                      timeout_download=300, tentativas=3):
        """Tenta exportar mais de uma vez.

        A abertura do menu de contexto e o clique no item falham de forma
        INTERMITENTE (mesmas obras passam numa execucao e falham na seguinte), o
        mesmo comportamento de foco que aparece em toda esta interface. Entao a
        defesa e repetir, limpando o estado com Escape entre as tentativas, em vez
        de esperar mais tempo por algo que nao vai acontecer.
        """
        ultimo = None
        for tentativa in range(1, tentativas + 1):
            try:
                return self._exportar_uma_vez(caminho_menu, destino, x, y,
                                              timeout_download)
            except Exception as e:
                ultimo = e
                self.log("   exportacao falhou (tentativa %d/%d): %s"
                         % (tentativa, tentativas, str(e).splitlines()[0][:70]))
                for _ in range(3):
                    self.tecla("Escape", pausa=0.8)
                # Um popup inesperado (ex.: detalhe de um item, aberto por um
                # clique que caiu numa celula clicavel da grade em vez do menu)
                # cobre o texto que estamos esperando, e Escape sozinho pode nao
                # fechar esse tipo de janela. Um clique esquerdo no mesmo ponto
                # do right-click original (garantido dentro da grade, nunca na
                # barra lateral) tira o foco do popup antes da proxima tentativa.
                # BUG REAL: travou ~2h sem nenhum log, obra 340, relatorio
                # visualizacao_itens (2026-09-11) -- Escape sozinho nao bastou.
                self.pagina.mouse.click(x, y)
                time.sleep(3)
        raise FalhaDeEtapa("exportacao falhou em %d tentativas: %s"
                           % (tentativas, str(ultimo).splitlines()[0][:80]))

    def _exportar_uma_vez(self, caminho_menu, destino, x=700, y=300,
                          timeout_download=300):
        """Botao direito no grid, percorre o menu por TEXTO, captura o download.

        Duas coisas importantes:

        1. O menu de contexto tem formato diferente em cada tela (um nivel,
           submenu, ou submenu com item extra no topo). Por isso o caminho vem
           como lista de textos e e percorrido por OCR - nunca por posicao.

        2. O nome do arquivo NAO e digitado na janela do Windows remoto. Aquele
           era o passo mais fragil do fluxo: clicar no campo tira o foco e o texto
           se perde sem erro visivel (um arquivo foi gravado como "Gd_Edicao"
           assim, e so a inspecao da pasta revelou). Com Playwright, o salvar
           dispara um download que interceptamos e gravamos com o nome que
           quisermos. O passo perigoso deixa de existir.
        """
        self.log("      clique direito em (%d, %d)" % (x, y))
        self.pagina.mouse.click(x, y, button="right")
        time.sleep(5)
        ponto_menu = (x + 15, y + 15)
        img = self.tela(ponto=ponto_menu)
        if not self.v.achar_texto(caminho_menu[0], img=img):
            self.log("      item %r nao visivel no 1o clique; repetindo clique direito" % caminho_menu[0])
            self.pagina.mouse.click(x, y, button="right")   # 1o clique so deu foco
            time.sleep(5)

        pai = ponto_menu
        for i, item in enumerate(caminho_menu):
            self.log("      aguardando item do menu: %r" % item)
            caixa = self.esperar_texto(item, timeout=25, ponto_cutucao=pai)
            cx = caixa.x + min(45, max(15, caixa.largura // 4))
            cy = caixa.y + caixa.altura // 2
            if i < len(caminho_menu) - 1:
                self.log("      movendo mouse para submenu: %r em (%d, %d)" % (item, cx, cy))
                self.pagina.mouse.move(cx, cy)               # abre o submenu
                time.sleep(5)
                pai = (cx, cy)      # daqui em diante, cutucar sem sair do item
            else:
                self.log("      clicando em %r (%d, %d) e aguardando janela 'Salvar como'..." % (item, cx, cy))
                with self.pagina.expect_download(timeout=timeout_download * 1000) as info:
                    self.pagina.mouse.click(cx, cy)
                    apareceu = False
                    limite = time.time() + 75    # com retentativa, nao vale esperar mais
                    while time.time() < limite:
                        img = self.tela()
                        palavras = [p["texto"].lower() for p in self.v.palavras_todas(img)]
                        texto_tela = " ".join(palavras)
                        if any(k in texto_tela for k in ("salvar como", "salvar", "ocultar pastas", "pastas")):
                            apareceu = True
                            break
                        time.sleep(2)
                    if not apareceu:
                        raise FalhaDeEtapa("a janela 'Salvar como' nao apareceu")
                    self.log("      janela 'Salvar como' confirmada; enviando Enter")
                    time.sleep(1.5)
                    self.tecla("Enter")                      # confirma "Salvar como"
                    self.log("      aguardando recepcao do arquivo baixado...")
                    time.sleep(2)
                baixado = info.value
                destino = Path(destino)
                destino.parent.mkdir(parents=True, exist_ok=True)
                baixado.save_as(str(destino))
                self._conferir_formato(destino)
                self.log("   arquivo salvo: %s (%d bytes)" % (destino.name, destino.stat().st_size))
                return destino
        raise FalhaDeEtapa("caminho de menu vazio")

    # xlsx e um zip (comeca com PK); xls antigo e um documento composto OLE2.
    ASSINATURAS = {".xlsx": bytes([80, 75]),
                   ".xls": bytes([208, 207, 17, 224])}

    def _conferir_formato(self, caminho):
        """O conteudo tem que corresponder a extensao."""
        caminho = Path(caminho)
        esperado = self.ASSINATURAS.get(caminho.suffix.lower())
        if not esperado:
            return
        with open(str(caminho), "rb") as arquivo:
            conteudo = arquivo.read()
        if not conteudo.startswith(esperado):
            caminho.unlink(missing_ok=True)
            raise FalhaDeEtapa(
                "o arquivo saiu no formato errado (assinatura %r, esperava %s) — "
                "provavelmente o item errado do menu" % (conteudo[:4], caminho.suffix))
        if caminho.suffix.lower() == ".xls":
            # Validar que e uma planilha Excel real contendo o stream Workbook (em UTF-16LE).
            # Evita que um relatorio do Crystal Reports (.rpt) salvo com extensao .xls passe.
            stream_workbook = "Workbook".encode("utf-16le")
            if stream_workbook not in conteudo:
                caminho.unlink(missing_ok=True)
                raise FalhaDeEtapa(
                    "o arquivo %s foi salvo como documento OLE2 mas nao contem o stream 'Workbook' "
                    "(foi exportado como .rpt em vez de .xls)" % caminho.name)

    def fechar_visualizador_crystal(self):
        """Fecha o visualizador do Crystal Reports caso esteja aberto na tela.

        Seguindo a recomendação de segurança do usuário:
        1. Envia Escape preventivo para fechar qualquer diálogo modal/dropdown
           remanescente (ex: 'Exportar Relatório').
        2. Confere se alguma âncora do Crystal Reports está visível na tela em passo único de OCR.
           Se não estiver, sai imediatamente.
        3. Clica no botão azul 'OK' no canto inferior direito (1554, 850).
        4. Confere novamente se o visualizador fechou. Se ainda estiver presente, clica no botão 'X'
           no canto superior direito da janela (1588, 12).
        5. Se ainda persistir, envia tecla Escape.
        NUNCA envia Alt+F4 para evitar risco de fechar a sessão/janela remota inteira.
        """
        ANCORAS_CRYSTAL = ("relatorio principal", "caminho do relatorio", "caminho do rel",
                           "total de paginas", "fator de zoom", "pagina atual", ".rpt")

        def _tem_ancora(img):
            import unicodedata
            palavras = self.v._palavras(img, escala=1.0)
            texto_unificado = unicodedata.normalize('NFKD', " ".join(p["texto"].lower() for p in palavras)).encode('ASCII', 'ignore').decode('ASCII')
            return any(anc in texto_unificado for anc in ANCORAS_CRYSTAL)

        # 1. Enviar Escape preventivo para fechar qualquer diálogo ou menu aberto na frente do visualizador
        self.tecla("Escape", pausa=0.5)

        img = self.tela()
        if not _tem_ancora(img):
            return True

        self.log("      fechando visualizador do Crystal Reports...")
        for tentativa in range(1, 3):
            # 1. Tentar primeiro o botão OK em (1554, 850)
            self.pagina.mouse.click(1554, 850)
            time.sleep(2.0)
            if not _tem_ancora(self.tela()):
                self.log("      visualizador fechado com sucesso pelo botão OK.")
                return True

            # 2. Se ainda presente, clicar no botão 'X' no canto superior direito (1588, 12)
            self.log("      visualizador ainda presente; tentando fechar pelo 'X' em (1588, 12)...")
            self.pagina.mouse.click(1588, 12)
            time.sleep(2.0)
            if not _tem_ancora(self.tela()):
                self.log("      visualizador fechado com sucesso pelo botão 'X'.")
                return True

            # 3. Se ainda presente, enviar Escape
            self.log("      visualizador ainda presente; enviando Escape...")
            self.tecla("Escape", pausa=1.5)
            if not _tem_ancora(self.tela()):
                self.log("      visualizador fechado com sucesso pelo Escape.")
                return True

        return False

    def exportar_crystal_relatorio(self, destino, timeout_espera_geracao=300, timeout_download=120, tipo="excel"):
        """Exporta relatorio gerado no visualizador do Crystal Reports para Excel (.xls).

        1. Aguarda a renderizacao no visualizador do Crystal Reports (identificado
           por ancoras como 'Relatório Principal', 'Caminho do relatório'
           ou 'No. Total de Páginas').
        2. Clica no 1o icone da barra de ferramentas superior (Exportar).
        3. Aguarda a janela 'Exportar Relatório'.
        4. Seleciona o formato Excel (ou Data-Only) no campo Tipo.
        5. Preenche o campo Nome e confirma Salvar.
        6. Captura o download disparado pelo gateway Web RDP.
        7. Salva no arquivo de destino e valida a assinatura binaria OLE2 (.xls).
        8. Fecha o visualizador do Crystal Reports clicando em 'OK'.
        """
        self.log("      aguardando geracao no Crystal Reports (ate %ds)..." % timeout_espera_geracao)
        ANCORAS_DOCUMENTO = ("cnpj", "inscric", "emissao", "liberac", "ltd", "contrato", "espelho")
        limite = time.time() + timeout_espera_geracao
        caixa_aba = False
        ultimo_snap = 0
        while time.time() < limite:
            img = self.tela()
            palavras = [p["texto"].lower() for p in self.v._palavras(img, escala=1.0)]
            texto_tela = " ".join(palavras)
            # O documento so esta pronto de verdade quando:
            # 1. O visualizador do Crystal Reports abriu na tela
            # 2. O conteudo da tabela do relatorio renderizou (colunas e dados presentes)
            viewer_aberto = any(v in texto_tela for v in ("relatorio principal", "relatório principal", "caminho do rel", "fator de zoom", ".rpt"))
            tem_conteudo = any(anc in texto_tela for anc in ANCORAS_DOCUMENTO)
            if viewer_aberto and tem_conteudo:
                self.log("      relatorio gerado! Documento pronto na tela.")
                caixa_aba = True
                break
            if time.time() - ultimo_snap > 30:
                ultimo_snap = time.time()
                try:
                    caminho_snap = Path("dados/falhas") / ("espera_crystal_%d.png" % int(time.time()))
                    caminho_snap.parent.mkdir(parents=True, exist_ok=True)
                    self.pagina.screenshot(path=str(caminho_snap))
                    self.log("      ainda processando relatorio (screenshot: %s)..." % caminho_snap.name)
                except Exception:
                    pass
            time.sleep(3)

        if not caixa_aba:
            try:
                caminho_falha = Path("dados/falhas") / ("falha_crystal_%d.png" % int(time.time()))
                caminho_falha.parent.mkdir(parents=True, exist_ok=True)
                self.pagina.screenshot(path=str(caminho_falha))
                self.log("      screenshot salvo: %s" % caminho_falha)
            except Exception:
                pass
            raise FalhaDeEtapa("o visualizador do Crystal Reports nao abriu em %ds" % timeout_espera_geracao)

        time.sleep(3)

        # O icone de exportar fica na barra superior: x ~ 15, y ~ 45
        x_icone = 15
        y_icone = 45

        destino = Path(destino)
        destino.parent.mkdir(parents=True, exist_ok=True)

        self.log("      clicando no icone de exportar em (%d, %d)..." % (x_icone, y_icone))
        self.pagina.mouse.click(x_icone, y_icone)
        time.sleep(2)

        # Aguardar janela 'Exportar Relatório'
        self.log("      aguardando dialogo 'Exportar Relatório'...")
        alvos_exportar = ("exportar relatorio", "exportar relatório", "exportar", "salvar", "tipo:", "nome:")
        limite_diag = time.time() + 60
        apareceu_diag = False
        while time.time() < limite_diag:
            img = self.tela()
            todas = self.v.palavras_todas(img)
            texto_tela = " ".join(p["texto"].lower() for p in todas)
            if any(a in texto_tela for a in alvos_exportar):
                apareceu_diag = True
                break
            # Se apos 10s ainda nao abriu, repete clique no icone
            if (time.time() - (limite_diag - 60)) > 10 and int(time.time() - (limite_diag - 60)) % 10 < 4:
                self.log("      dialogo ainda nao abriu; repetindo clique no icone em (%d, %d)..." % (x_icone, y_icone))
                self.pagina.mouse.click(x_icone, y_icone)
            time.sleep(2.5)
        if not apareceu_diag:
            raise FalhaDeEtapa("o dialogo 'Exportar Relatório' nao apareceu em 60s")
        time.sleep(1.5)

        # Selecionar pasta 'Downloads' no painel lateral esquerdo (x ~ 80, y ~ 227)
        # para que o arquivo seja gravado na pasta redirecionada do cliente e baixado via gateway
        self.log("      selecionando pasta 'Downloads' na barra lateral...")
        img_side = self.tela()
        todas_palavras = self.v.palavras_todas(img_side)
        caixa_down = next((p for p in todas_palavras if "download" in p["texto"].lower() and p["x"] < 120 and p["y"] < 350), None)
        if caixa_down:
            cx = caixa_down["x"] + caixa_down.get("w", 30) // 2
            cy = caixa_down["y"] + caixa_down.get("h", 16) // 2
            self.pagina.mouse.click(cx, cy)
        else:
            self.pagina.mouse.click(80, 227)
        time.sleep(0.5)
        self.tecla("Enter", pausa=1.0)
        time.sleep(1.0)

        # 1. Ajustar o Tipo para Microsoft Excel (*.xls)
        # Na janela 'Exportar Relatório', o campo Tipo fica em (440, 421)
        self.log("      clicando na combobox Tipo em (440, 421)...")
        self.pagina.mouse.click(440, 421)
        time.sleep(1.0)

        # Navegar pelo teclado para selecionar o tipo Excel Data-Only
        deslocamento = 5 if tipo == "data_only" else 4
        self.log("      enviando Home + %dx ArrowDown + Enter na combobox Tipo..." % deslocamento)
        self.tecla("Home", pausa=0.3)
        for _ in range(deslocamento):
            self.tecla("ArrowDown", pausa=0.2)
        self.tecla("Enter", pausa=1.0)
        time.sleep(1.0)

        # Screenshot de confirmacao da selecao do tipo
        try:
            Path("dados/falhas").mkdir(parents=True, exist_ok=True)
            self.pagina.screenshot(path="dados/falhas/pos_selecao_tipo.png")
        except Exception:
            pass

        # 2. Preencher campo Nome (x=250, y=395)
        self.log("      preenchendo nome do arquivo (%s)..." % destino.name)
        self.pagina.mouse.click(250, 395)
        time.sleep(0.5)
        self.tecla("End", pausa=0.1)
        for _ in range(35):
            self.pagina.keyboard.press("Backspace")
        self.digitar(destino.stem)
        time.sleep(0.8)

        # 3. Confirmar Salvar no botão (628, 470) e aguardar recepção do download
        self.log("      confirmando salvamento do arquivo em (628, 470)...")
        with self.pagina.expect_download(timeout=180000) as info:
            self.pagina.mouse.click(628, 470)
            time.sleep(0.5)
            self.tecla("Enter", pausa=1.0)
            self.log("      aguardando recepcao do arquivo baixado...")
            baixado = info.value

        baixado.save_as(str(destino))
        self._conferir_formato(destino)
        self.log("   arquivo salvo com sucesso: %s (%d bytes)" % (destino.name, destino.stat().st_size))

        # 4. Fechar visualizador do Crystal Reports
        time.sleep(2)
        if not self.fechar_visualizador_crystal():
            self.log("      aviso: visualizador do Crystal Reports pode ainda estar visivel.")

        time.sleep(1)
        return destino

    # ------------------------------------------------------------------ saida
    def encerrar_sessao(self):
        """Desloga do Windows remoto pelo painel do usuario.

        CORRIGIDO 2026-09-07: Ctrl+Alt+Delete NAO atravessa o gateway HTML5 —
        e um atalho do SO local, nao da sessao remota. O caminho confirmado
        pelo usuario e o mesmo painel usado em trocar_empresa: icone de pessoa,
        depois a opcao de sair. Fechar so a aba do Playwright deixa a sessao
        viva no servidor Mega; sem deslogar, o usuario acumula sessoes orfas
        que o proprio Mega derruba na entrada seguinte (ver
        responder_sessao_duplicada), transformando isso numa falha
        intermitente sem sintoma claro.

        Os textos candidatos seguem o mesmo padrao de responder_sessao_duplicada:
        tenta cada um, na ordem, e usa o primeiro que aparecer na tela — o Mega
        nao usa sempre o mesmo rotulo em todo lugar.
        """
        TEXTOS_SAIR = ("Sair", "Encerrar Sessão", "Desconectar", "Log Off")
        try:
            self.pagina.mouse.click(self.ICONE_PESSOA[0], self.ICONE_PESSOA[1])
            time.sleep(3.0)
            img = self.tela()
            for texto in TEXTOS_SAIR:
                caixa = self.v.achar_texto(texto, img=img)
                if caixa:
                    x, y = centro(caixa)
                    self.pagina.mouse.click(x, y)
                    time.sleep(5)
                    self.log("   sessao encerrada via painel do usuario (%r)" % texto)
                    return True
            self.log("   painel do usuario abriu mas nenhum texto de saida foi achado")
        except Exception as e:
            self.log("   nao consegui encerrar a sessao: %s" % str(e)[:60])
        return False
