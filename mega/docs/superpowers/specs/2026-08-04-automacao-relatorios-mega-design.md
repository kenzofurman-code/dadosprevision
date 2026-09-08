# Automação de extração de relatórios do Mega ERP

**Criado:** 2026-08-04
**Revisado:** 2026-09-01 — reescrito após descoberta em ambiente real
**Status:** Os quatro relatorios automatizados e executados pelo robo nas 8 obras
(2026-09-02): 48 arquivos, 129.828 linhas, nenhum em formato errado, nenhuma
contaminacao entre obras.

## Correção da versão anterior

A primeira versão desta spec assumia que o Mega era um sistema web e propunha
automação de navegador com Playwright. **Isso está errado.**

O Mega é um aplicativo Windows (DevExpress) executado num terminal server da Senior
(`OCMEGTS102`) e transmitido para o navegador via gateway HTML5. A página não tem DOM
da aplicação — apenas seis ícones de barra de ferramentas do gateway. Playwright não
teria o que clicar.

A abordagem correta é automação por reconhecimento de imagem sobre a tela transmitida.

## Problema

Extrair, para cada obra, o relatório de Itens Solicitados do Mega, hoje baixado
manualmente, e consolidá-lo para consumo do Power BI.

## Ambiente

| | |
|---|---|
| ERP | Mega (Senior), produto `megaxt` |
| Acesso | `orion-sso.seniorcloud.com.br` → gateway HTML5 → terminal server |
| Natureza | Aplicativo Windows transmitido como imagem |
| Entrega de arquivos | Salvar em `\\tsclient\WebFile` → chega em `C:\Users\HomePC\Downloads` |
| Estrutura | Cada obra é uma SPE (empresa própria) |

## Tela alvo

`Follow-up de solicitações` — **ERP | Empresarial | Materiais | Suprimentos | Visões**

ATENÇÃO: existem duas telas com este nome exato. A outra fica em
`ERP | Construção | Administração de obras | Orçamentos | Solicitações` e contém
dados diferentes. O robô deve selecionar pelo texto do módulo, nunca pela posição
do resultado na busca.

Dentro da tela: aba `ITENS SOLICITADOS`, visão `Mostrar apenas Itens Solicitados`.

## Comportamento observado ao abrir a tela

| Campo | Estado inicial | Ação necessária |
|---|---|---|
| Filial inicial/final | Preenchida com a empresa ativa | Nenhuma |
| Data de emissão | Hoje até hoje | **Reconfigurar** |
| Visão | "Solicitações e Itens Solicitados" | **Trocar** |
| Grid | Vazio | Filtrar |

Trocar de empresa **fecha a tela aberta** e retorna à home. O percurso completo se
repete a cada obra.

## Roteiro por obra

Validado numa execucao completa das 8 obras em 2026-09-01.

```
PARA CADA obra (codigo, nome):

   1  clicar no NOME DA EMPRESA na barra do topo   -> abre a arvore direto
   2  VERIFICAR que a arvore abriu                 -> se nao, PARAR
   3  digitar <codigo>                             (type-ahead, sem pausas)
   4  Enter
   5  VERIFICAR barra do topo contem <codigo>      -> se nao, PARAR
   6  clicar na lupa da barra esquerda
   7  digitar "follow-up de solicita"              (sem acentos)
   8  localizar resultado "Materiais | Suprimentos | Visoes"
                                                   -> se nao achar, PARAR
   9  clicar nesse resultado
  10  aguardar ancora: aba "ITENS SOLICITADOS"
  11  marcar "Mostrar apenas Itens Solicitados"
  12  data inicial: clicar no segmento do dia, Home,
      "01" pausa "01" pausa "2025"                 (ver regra da data)
  13  a data final ja vem como hoje                -> nao mexer
  14  clicar Filtrar
  15  aguardar o grid carregar
      -> se vazio, registrar "sem movimento" e IR PARA A PROXIMA OBRA
  16  botao direito sobre o grid
  17  "Exportar para Excel 2007 (xlsx)"
  18  aguardar janela "Salvar como"
  19  VERIFICAR caminho == \\tsclient\WebFile
  20  digitar o nome SEM CLICAR no campo
  21  Enter                                        (nao clicar em Salvar)
  22  VERIFICAR arquivo novo em Downloads          -> se nao houver, PARAR
```

Nome do arquivo: `Itens_Solicitados_<obra>_<AAAA-MM-DD>.xlsx`

## Regras aprendidas em campo

Cada uma veio de uma falha observada.

**Trocar empresa pelo nome na barra do topo, nunca pelo menu do usuario.**
O menu do usuario tem `Trocar de Empresa` e `Trocar Senha do Usuario` a 35 px um do
outro, e **a posicao deles muda conforme o tamanho do nome da empresa ativa** — nomes
longos ocupam duas linhas no cabecalho e empurram o menu para baixo. Durante a execucao
isso levou um clique a abrir a tela de troca de senha, e o codigo da obra digitado em
seguida foi parar no campo `Senha atual`. Clicar no nome da empresa na barra do topo
abre a mesma arvore com um clique e sem essa vizinhanca perigosa.

**Data: digitos em blocos, jamais o texto completo.**
A receita que funciona e a unica que funciona:
`clicar no segmento do dia -> Home -> "01" -> pausa -> "01" -> pausa -> "2025"`.
Falharam: digitar `01/01/2025` (as barras viram avanco de segmento e embaralham o ano,
resultando em `01/09/0101`); digitar `01012025` de uma vez (o gateway nao acompanha e o
ERP abre modal `Data Invalida`); `Ctrl+A` seguido de digitacao (nao seleciona neste
controle); triple-click (idem). Foram cinco tentativas ate acertar.

**Nao existe "clique de aquecimento" universal.**
O primeiro clique apos mudanca de contexto as vezes so entrega foco. Mas em controles
que alternam (a lupa, por exemplo) um segundo clique preventivo **fecha** o que o
primeiro abriu. Regra correta: clicar uma vez, verificar a ancora, e repetir **apenas**
se ela nao apareceu.

**Verificacao tem que enxergar a tela inteira.**
Um modal `Data Invalida` ficou aberto no centro da tela durante tres tentativas
seguidas, bloqueando toda entrada, enquanto a conferencia por recorte de 230x40 px em
volta do campo mostrava tudo "normal". Verificacao estreita da confianca falsa e e pior
que nenhuma. Conferir com captura completa, ou checar explicitamente a presenca de
dialogo de erro.

**Digitar sem clicar no campo.** Na janela "Salvar como" o nome ja vem selecionado.
Clicar remove o foco e o texto se perde sem erro visivel — um arquivo foi gravado como
`Gd_Edicao` assim, e so a inspecao da pasta revelou.

**Teclado em vez de coordenada, quando houver a opcao.** Um clique em `Salvar` errou o
alvo por 20 px depois que a area util da sessao mudou de altura. Investigado depois: o
usuario confirma que a resolucao **nao** oscila em uso normal — a mudanca coincidia com
a barra de tarefas do Windows aparecendo na sessao remota, provavelmente provocada pela
propria automacao ao clicar perto da borda inferior. Ou seja, nao e caracteristica do
ERP e nao se deve desenhar em torno disso. Ainda assim, preferir `Enter` a clicar num
botao de confirmacao custa nada e remove uma classe inteira de erro.

**Busca por digitacao em vez de navegacao.** Arvore de empresas e menu de telas
respondem a busca textual, eliminando rolagem e coordenadas variaveis.

**Obra sem movimento e resultado valido** — mas cuidado ao declarar uma.
A 430 retornou grid vazio nas duas tentativas manuais de 2026-09-01 e foi
registrada aqui como "sem movimento no periodo". **Estava errado.** Na execucao
automatizada de 2026-09-02 ela trouxe 1.675 linhas, com datas a partir de
24/01/2025 — dados que ja existiam. Foi falso negativo do procedimento manual,
provavelmente um filtro que nao chegou a rodar. O robo, que confere a filial na
tela antes de exportar, nao repetiu o erro.

A licao vale alem deste caso: "vazio" e uma afirmacao sobre os dados e merece a
mesma desconfianca que qualquer outra. Registrar e seguir, sim; mas nao tratar
como fato estabelecido.

## Verificacoes obrigatorias

O risco central nao e o robo quebrar — e ele **nao** quebrar e produzir um arquivo com
o nome de uma obra e o conteudo de outra.

1. **Barra do topo** confirma a empresa ativa antes de exportar. Durante a execucao
   essa checagem pegou duas trocas que nao aconteceram.
2. **Caminho do modulo** confirma a tela correta entre as duas homonimas.
3. **Arquivo em Downloads** confirma que a exportacao chegou.

## Resultado da primeira execucao completa

2026-09-01, 8 obras, conduzida passo a passo:

| Obra | Empresa | Resultado |
|---|---|---|
| 340 | BALNEARIO DE GUARATUBA | 377.903 bytes |
| 410 | PIEMONTE CROMA | 622.923 bytes |
| 430 | PIEMONTE 909 | sem movimento no periodo |
| 480 | PIEMONTE COMPORTA | 160.692 bytes |
| 490 | PIEMONTE P70 RUA BUENOS AIRES | 359.020 bytes |
| 601 | PIEMONTE P73 RUA GUARATUBA AHU | 444.589 bytes |
| 630 | PIEMONTE P74 CARMELO RANGEL | 473.738 bytes |
| 650 | PIEMONTE P78 CARNEIRO LOBO | 394.052 bytes |

## Riscos confirmados na pratica

**Expiracao de senha.** Durante a execucao apareceu o dialogo `O prazo de validade da
sua senha expirou`. Um robo desatendido para aqui. O tratamento e detectar o dialogo
pelo titulo, interromper a rotina e notificar — nunca tentar interagir com ele.

**A pasta \\tsclient\WebFile nao e a pasta Downloads.** Os arquivos chegam em Downloads, mas uma
copia permanece em \\tsclient\WebFile. Limpeza local nao limpa a origem; a pasta cresce
indefinidamente e vai precisar de rotina propria de expurgo.

## Consolidação

Arquivos chegam em `C:\Users\HomePC\Downloads`. Etapa local, sem relação com o ERP:

1. Mover os `.xlsx` do dia para `dados/bruto/AAAA-MM-DD/`.
2. Validar: abre, tem as colunas esperadas, tem ao menos uma linha.
3. Unificar acrescentando colunas `obra` e `data_extracao`.
4. Gravar `dados/consolidado/itens_solicitados.parquet`.

O gateway entrega duas cópias de cada arquivo (uma com carimbo de data/hora, uma com
o nome limpo). A consolidação usa a de nome limpo e ignora a carimbada.

**Publicação conservadora:** se qualquer obra falhar, o consolidado não é sobrescrito.

## Ferramenta

Automação por imagem com gravador, para que a manutenção não dependa de quem escreveu.
Candidatos: Power Automate Desktop (incluso no Windows 11) ou AutoHotkey v2 (já baixado
na máquina). Decisão pendente; o roteiro acima vale para os dois.

Descartado: Playwright/Selenium (não há DOM) e API REST oficial da Mega (descartada pelo
usuário).

## Parâmetro: data de emissão

Data inicial fixa até a data de hoje. A data final é calculada pelo robô a cada
execução; a inicial é constante e vive na configuração.

Consequência: cada extração traz o histórico completo, e o arquivo de cada obra cresce
ao longo do tempo. A consolidação substitui a obra inteira a cada execução, em vez de
acumular incrementos — mais simples e sem risco de duplicar linhas.

Valor observado em uso manual: `01/01/2025`. A confirmar.

## Pendências

1. **Data inicial fixa.** Confirmar se é `01/01/2025`.
2. **Lista de obras.** Códigos e nomes das SPEs. Conhecidos até agora: 310, 311, 320,
   340, 350, 360, 370, 650. A árvore continua além da área visível.

## Notas

Arquivos de teste deixados em `Downloads` durante o mapeamento, a remover quando o
usuário autorizar: `20260901T002257.354-Gd_Edicao.xlsx`,
`Itens_Solicitados_2026-09-01.xlsx` e sua cópia carimbada.


## Execucao automatica completa — 2026-09-02

| Relatorio | Arquivos | Linhas |
|---|---|---|
| Itens Solicitados | 8 | 25.358 |
| Analise de Saldo — Pedidos | 8 | 1.614 |
| Analise de Saldo — Contratos | 8 | 3.093 |
| Analise de Saldo — Realizado | 8 | 51.909 |
| Visualizacao de Itens | 8 | 25.244 |
| Pedidos de Compra | 8 | 22.610 |
| **total** | **48** | **129.828** |

### O que a automacao exigiu alem do roteiro

O roteiro mapeado a mao estava certo no percurso e incompleto nas defesas. O que
precisou ser descoberto ao automatizar:

**O gateway so repinta o canvas quando algo muda na tela remota.** Capturar sem
mover o mouse antes devolve quadro velho, e o OCR "nao acha" o que esta visivel.
Mas o proprio cutucao move o cursor e FECHA submenu que depende de hover — ao
navegar menu, ele precisa cutucar dentro do item pai.

**Nao existe um pre-processamento de OCR que sirva para a tela toda.** O painel
lateral (texto branco fino sobre escuro) so e lido em escala 1; ampliar borra. O
texto do ERP sobre fundo claro so e lido ampliado. Sao variantes, tentadas em
ordem.

**Varios botoes sao ilegiveis em qualquer pre-processamento** — "Filtrar" e
"Executar" sao brancos sobre fundo colorido, e os botoes "Sim"/"Nao" dos dialogos
tambem. Todos foram ancorados em vizinhos legiveis, com deslocamento medido na
resolucao real, nunca estimado.

**O Mega sublinha a letra de atalho** e o Tesseract le "Filtrar" como "Eiltrar".
Exigir igualdade nunca acharia botao nenhum; a comparacao e aproximada. Mas
tolerancia tem preco: ela casou "Exportar para Excel (xls)" com "Exportar para
Excel 2007 (xlsx)" e produziu um arquivo com o nome certo, os dados certos e o
formato errado. O desempate passou a ser pela semelhanca, e o formato do arquivo
baixado e conferido pela assinatura de bytes.

**O menu de contexto fica sobreposto ao grid**, e o OCR agrupa numa mesma linha o
texto do menu e o do grid a direita. A caixa de um item chegou a 564px e o CENTRO
caia fora do menu — falhava sempre nas mesmas obras, dependendo do que havia no
grid naquela altura. Clica-se no inicio do texto.

**O dialogo "usuario ja logado em sessao RDP"** aparece quando o mesmo usuario
entra de novo. Sem resposta, bloqueia a sessao e tudo abaixo falha com sintomas
que apontam para a causa errada.
