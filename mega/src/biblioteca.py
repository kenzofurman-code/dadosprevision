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

    def esperar_texto(self, alvo, timeout=60, intervalo=3, ponto_cutucao=None):
        """Espera um texto aparecer e devolve sua caixa. Ancora de progresso.

        ponto_cutucao existe para menus: ao esperar um submenu, o cutucao precisa
        acontecer DENTRO do item pai, senao o proprio movimento do mouse fecha o
        submenu.
        """
        limite = time.time() + timeout
        while time.time() < limite:
            img = self.tela(ponto=ponto_cutucao)
            erro = self.v.dialogo_de_erro(img=img)
            if erro:
                raise FalhaDeEtapa("dialogo de erro na tela: %r" % erro)
            caixa = self.v.achar_texto(alvo, img=img)
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
                    "Solicitacoes", "Orcamento")

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
            time.sleep(intervalo)
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
        # sessao e nova, entao nao da para depender dela.
        for tentativa in (1, 2, 3):
            self.pagina.mouse.click(self.ICONE_PESSOA[0], self.ICONE_PESSOA[1])
            time.sleep(3.0)
            img = self.tela()
            if self.v.achar_texto("Trocar de Empresa", img=img):
                break
            if tentativa == 3:
                raise FalhaDeEtapa("o painel do usuario nao abriu")

        # Preferencia: clicar no proprio texto. Mas o OCR le "Trocar Senha do
        # Usuario" com folga e frequentemente NAO le "Trocar de Empresa" (mesma
        # cor, mesmo tamanho — nao sei por que). Ou seja: o item que eu preciso e
        # o ilegivel, e o vizinho legivel e o perigoso.
        #
        # A alternativa ancora no cabecalho "Menu", que fica ACIMA dos dois. Se o
        # deslocamento errar, o clique cai no cabecalho (inofensivo) e nao na
        # troca de senha. Errar para cima aqui e uma decisao de projeto.
        try:
            self.clicar_texto("Trocar de Empresa",
                              ancora="ORGANIZACOES POR USUARIO", timeout=20)
            return self._digitar_codigo(codigo)
        except FalhaDeEtapa:
            self.log("   'Trocar de Empresa' ilegivel; ancorando no cabecalho Menu")

        self.clicar_relativo("Menu", dx=-90, dy=46,
                             ancora="ORGANIZACOES POR USUARIO", timeout=25)
        img = self.tela()
        if not self.v.achar_texto("ORGANIZACOES POR USUARIO", img=img):
            raise FalhaDeEtapa("nao consegui abrir a arvore de empresas")
        return self._digitar_codigo(codigo)

    def _digitar_codigo(self, codigo):

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
        for tentativa in (1, 2, 3):
            self.pagina.mouse.click(self.ICONE_LUPA[0], self.ICONE_LUPA[1])
            time.sleep(3)
            img = self.tela()
            if self.v.achar_texto("Procurar", img=img):
                break
            if tentativa == 3:
                raise FalhaDeEtapa("o painel de busca de telas nao abriu")
        self.digitar(busca)
        time.sleep(3.5)
        img = self.tela()

        # Escolher o resultado pela PALAVRA DO MODULO, nao pela posicao.
        # Ha duas telas chamadas "Follow-up de solicitacoes" e as duas sao usadas:
        # uma em Materiais|Suprimentos|Visoes, outra em Construcao|...|Orcamentos.
        # Pegar "o primeiro da lista" acertaria uma e erraria a outra, sempre.
        if palavra_modulo:
            caixa = self.v.achar_texto(palavra_modulo, img=img)
            if not caixa:
                raise FalhaDeEtapa(
                    "nao achei nenhum resultado do modulo %r para a busca %r"
                    % (palavra_modulo, busca))
            # o titulo do resultado fica na linha imediatamente acima do modulo
            self.pagina.mouse.click(caixa.x + 30, caixa.y - 18)
        else:
            caixa = self.v.achar_texto(busca, img=img)
            if not caixa:
                raise FalhaDeEtapa("a busca %r nao retornou resultado legivel" % busca)
            x, y = centro(caixa)
            self.pagina.mouse.click(x, y)
        try:
            self.esperar_texto(ancora_titulo, timeout=timeout)
        except FalhaDeEtapa:
            raise FalhaDeEtapa("abri a busca %r mas a tela %r nao apareceu"
                               % (busca, ancora_titulo))
        self.log("   tela confirmada: %s" % ancora_titulo)

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
        self.pagina.mouse.click(x, y, button="right")
        # 5s (era 2s): o menu pode ainda estar renderizando no gateway remoto
        # quando o OCR le a tela. Um frame "no meio do caminho" faz o OCR achar
        # uma posicao de clique errada -- caindo numa celula clicavel da grade
        # por baixo em vez do item do menu. BUG REAL: abriu um popup de detalhe
        # do item (obra 340, relatorio visualizacao_itens, 2026-09-11).
        time.sleep(5)
        # O cutucao (ver Visao.cutucar) cutuca por padrao em (800,450) para forcar
        # o gateway a repintar antes do OCR. Esse ponto fixo pode cair fora do
        # menu recem-aberto (ou bem na borda dele) e o simples HOVER ali fecha o
        # menu antes da leitura -- mesma causa ja documentada para submenus, so
        # que aqui no proprio menu de primeiro nivel. Ancorar perto do clique
        # (que e onde o menu sempre abre) mantem o cutucao dentro do menu.
        # BUG REAL, confirmado ao vivo contra a obra 340 (2026-09-10): o menu
        # abria normalmente (visivel no screenshot), mas o OCR nunca o achava.
        ponto_menu = (x + 15, y + 15)
        img = self.tela(ponto=ponto_menu)
        if not self.v.achar_texto(caminho_menu[0], img=img):
            self.pagina.mouse.click(x, y, button="right")   # 1o clique so deu foco
            time.sleep(5)

        pai = ponto_menu
        for i, item in enumerate(caminho_menu):
            caixa = self.esperar_texto(item, timeout=25, ponto_cutucao=pai)
            # CLICAR NO INICIO DO TEXTO, NAO NO CENTRO DA CAIXA.
            # O menu de contexto fica sobreposto ao grid, e o OCR agrupa numa
            # mesma linha o texto do menu e o texto do grid que aparece a direita.
            # A caixa de "Exportar para Excel 2007 (xlsx)" chegou a 564px de
            # largura, e o centro caia sobre o GRID, fora do menu. Era por isso
            # que 410, 630 e 650 falhavam sempre e as demais passavam: depende do
            # que ha no grid naquela altura, nao do tamanho da obra.
            cx = caixa.x + min(45, max(15, caixa.largura // 4))
            cy = caixa.y + caixa.altura // 2
            if i < len(caminho_menu) - 1:
                self.pagina.mouse.move(cx, cy)               # abre o submenu
                time.sleep(5)
                pai = (cx, cy)      # daqui em diante, cutucar sem sair do item
            else:
                with self.pagina.expect_download(timeout=timeout_download * 1000) as info:
                    self.pagina.mouse.click(cx, cy)
                    # ESPERAR a janela "Salvar como" aparecer, nao dormir um tempo
                    # fixo: em obras com mais dados ela demora mais, e um Enter
                    # disparado cedo se perde — foi assim que a obra 410 ficou
                    # 300s esperando um download que nunca comecou.
                    apareceu = False
                    limite = time.time() + 75    # com retentativa, nao vale esperar mais
                    while time.time() < limite:
                        img = self.tela()
                        if (self.v.achar_texto("Salvar como", img=img)
                                or self.v.achar_texto("Ocultar pastas", img=img)):
                            apareceu = True
                            break
                        time.sleep(3)
                    if not apareceu:
                        raise FalhaDeEtapa("a janela 'Salvar como' nao apareceu")
                    time.sleep(1.5)
                    self.tecla("Enter")                      # confirma "Salvar como"
                    time.sleep(2)
                baixado = info.value
                destino = Path(destino)
                destino.parent.mkdir(parents=True, exist_ok=True)
                baixado.save_as(str(destino))
                self._conferir_formato(destino)
                self.log("   arquivo salvo: %s" % destino.name)
                return destino
        raise FalhaDeEtapa("caminho de menu vazio")

    # xlsx e um zip (comeca com PK); xls antigo e um documento composto OLE2.
    ASSINATURAS = {".xlsx": bytes([80, 75]),
                   ".xls": bytes([208, 207, 17, 224])}

    def _conferir_formato(self, caminho):
        """O conteudo tem que corresponder a extensao.

        O menu tem "Exportar para Excel (xls)" e "Exportar para Excel 2007
        (xlsx)" lado a lado, quase identicos. Um clique no item errado produz um
        arquivo com o NOME certo, os DADOS certos e o FORMATO errado — e passa
        despercebido ate alguem tentar abrir. Ja aconteceu uma vez.
        """
        esperado = self.ASSINATURAS.get(caminho.suffix.lower())
        if not esperado:
            return
        with open(str(caminho), "rb") as arquivo:
            inicio = arquivo.read(4)
        if not inicio.startswith(esperado):
            caminho.unlink(missing_ok=True)
            raise FalhaDeEtapa(
                "o arquivo saiu no formato errado (assinatura %r, esperava %s) — "
                "provavelmente o item errado do menu" % (inicio, caminho.suffix))

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
