# Deploy na VPS e integração com o app Dados Prevision

**Criado:** 2026-09-07
**Status:** design aprovado por seção; implementação não iniciada.

## Contexto

A extração dos 4 relatórios × 8 obras está completa e verificada rodando na máquina
Windows do usuário (ver
[2026-08-04-automacao-relatorios-mega-design.md](2026-08-04-automacao-relatorios-mega-design.md)).
Falta: (1) rodar isso na VPS Linux do usuário, e (2) decidir o destino dos dados —
inicialmente cogitado como "banco vs. Excel", mas a pergunta certa acabou sendo outra.

A VPS já hospeda outro app do usuário, **Dados Prevision**
(`C:\Users\HomePC\Documents\GITHUBS\dadosprevision`): um painel React/Node que
sincroniza a API GraphQL/REST da Prevision para um PostgreSQL em Docker Compose, e o
usuário quer juntar os dados do Mega a esse mesmo app, não criar uma segunda base
isolada.

Objetivo confirmado com o usuário: **acompanhar prazo de compra** e **consultar
suprimentos** por obra. Não é objetivo (por ora): cruzar item de orçamento da
Prevision com item comprado no Mega — isso exigiria código de item compatível entre
os dois sistemas, o que não foi verificado.

## Correspondência de obras — parcial

As 8 obras do Mega (340, 410, 430, 480, 490, 601, 630, 650) **não correspondem
integralmente** a projetos existentes na Prevision — o usuário confirmou que a
sobreposição é parcial. Uma tabela de-para resolve isso sem exigir 100% de match
(ver Modelo de dados). Os dois objetivos definidos acima não dependem dessa
correspondência para ter valor: a data de necessidade e a situação de cada item já
vêm do próprio Mega.

## Arquitetura

Novo serviço `mega` no mesmo `docker-compose.yml` do Dados Prevision, ao lado de
`postgres` e `app`:

```
┌─────────────────────────────────────────────────────┐
│  VPS · rede interna do Compose                      │
│                                                     │
│   ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│   │   app    │───▶│ postgres │◀───│     mega     │  │
│   │  Node    │ lê │          │escr│ Python+Chrome│  │
│   │ :3000    │    │ (sem     │eve │  +Xvfb+Tess  │  │
│   └────┬─────┘    │  porta   │    └──────┬───────┘  │
│        │          │ pública) │           │          │
└────────┼──────────┴──────────┴───────────┼──────────┘
         │ nginx/HTTPS                     │ HTTPS
         ▼                                 ▼
      navegador                    gateway Mega ERP
```

A porta do PostgreSQL **continua não publicada** — decisão já registrada no
[README do Dados Prevision](../../../dadosprevision/README.md) por segurança. Os dois
escritores (app Node e mega Python) falam com o banco pela rede interna do Compose.

**Alternativas descartadas:**

- **Robô no host, fora de container** — exigiria publicar a porta do Postgres em
  localhost, revertendo uma decisão de segurança já tomada, só por conveniência de
  depuração.
- **Python extrai, Node carrega via endpoint HTTP** — 130 mil linhas por requisição a
  cada carga, e duplicaria em JavaScript a lógica de leitura de planilha que já existe
  em Python. Um único dono de schema (ver abaixo) resolve isso sem essa duplicação.

**Recursos da VPS confirmados pelo usuário:** 8 GB+ de RAM livre — folgado para o
Chrome sob Xvfb (1–2 GB durante a execução noturna) rodar ao lado do Postgres e do
app Node sem disputa.

### Localização do código

O repositório `mega-relatorios` será trazido para dentro de `dadosprevision`, como
subpasta `mega/`, quando o usuário decidir fazer a migração (fora do escopo desta
spec — ele orientou "depois vou trazer para o dadosprevision"). Até lá, esta spec
assume a estrutura final (`mega/Dockerfile`, `mega/src/...`) para que o
`docker-compose.yml` já preveja `build: ./mega`; ajustar o caminho é o único passo
necessário quando a migração acontecer.

## Modelo de dados

Novo schema `mega` no mesmo banco Postgres do Dados Prevision. Um dono por schema:

| Schema | Dono (escreve) | Quem lê |
|---|---|---|
| `public` (projetos, atividades, cff_itens…) | `app` Node, via `server/sync.js` | app |
| `mega` (novo) | serviço `mega`, em Python | app, somente leitura |

### Tabela de-para

```sql
CREATE SCHEMA IF NOT EXISTS mega;

CREATE TABLE mega.obra_projeto (
  obra          TEXT PRIMARY KEY,   -- 340, 410, 430...
  id_prevision  TEXT,               -- NULL = obra sem projeto correspondente
  observacao    TEXT
);
```

Preenchida manualmente uma vez. **Sem chave estrangeira** para `public.projetos`: o
sync da Prevision recria projetos com `ON DELETE CASCADE`, e uma FK rígida faria a
carga do Mega falhar sempre que o lado Prevision mudasse. O vínculo é validado na
leitura (JOIN opcional), não imposto na escrita.

### Chaves naturais — verificadas contra os dados reais de 2026-09-02

Antes de desenhar as tabelas, cada candidata a chave primária foi testada contra os
129.828 registros já extraídos (`dados/consolidado/*.xlsx`), em vez de assumida:

| Arquivo | Chave natural verificada | Situação |
|---|---|---|
| `Itens_Solicitados` | obra + Código da solicitação + Nr. RM + Sequencial do item | única |
| `Visualizacao_Itens` | obra + Solicitação + Sequência + **Fornecedor** | única — um item repete por fornecedor cotado; sem incluir Fornecedor a carga perde linhas |
| `Pedidos_Compra` | obra + Número do pedido + Item Pedido | única |
| `Analise_Pedidos` | obra + Cód. Estruturado + Cód. Item + Código do pedido + Sequência Item + Cód. Insumo | única |
| `Analise_Contratos` | — | 182 grupos com chave repetida, porém **nenhuma linha idêntica** — usa id sintético |
| `Analise_Realizado` | — | 609 grupos repetidos, e **35 linhas exatamente iguais** (0,1% — apropriações legitimamente idênticas, não erro de extração) — usa id sintético |

Consequência: só `Visualizacao_Itens` precisa de chave natural estável entre
execuções, porque é a única com trilha histórica de situação (ver política de
retenção). É, por sorte, a que tem chave limpa.

### Política de retenção — definida pelo usuário, arquivo por arquivo

| Arquivo | Origem (ERP) | Tabela(s) | Política | Volume/ano estimado |
|---|---|---|---|---|
| `Itens_Solicitados` | Follow-up de solicitações → Suprimentos | `mega.itens_solicitados` | **Só estado atual** — recarga por obra a cada execução | ~25 mil linhas fixas |
| `Visualizacao_Itens` | Follow-up de solicitações → Orçamentos, aba APROVAÇÕES | `mega.visualizacao_itens` + `mega.item_situacao_hist` | **Atual + trilha de situação** | ~25 mil + trilha |
| `Pedidos_Compra` | Follow-up de pedidos → Suprimentos | `mega.pedidos_compra` | **Atual, sem as ~70 colunas fiscais** (IPI, ICMS, ISS, PIS, COFINS, CSLL, INSS) | ~23 mil linhas fixas |
| `Analise_Pedidos` | Saldo Resumido, aba Pedidos | `mega.analise_pedidos_hist` | **Histórico completo**, empilhado por `data_extracao` | ~400 mil |
| `Analise_Contratos` | Saldo Resumido, aba Contratos | `mega.analise_contratos_hist` | **Histórico completo**, empilhado por `data_extracao` | ~770 mil |
| `Analise_Realizado` | Saldo Resumido, aba Realizado | `mega.analise_realizado` | **Só estado atual** — é um razão, cada linha já carrega sua própria data; histórico da extração seria redundante (~13 milhões de linhas/ano se guardado) | ~52 mil linhas fixas |

Total estimado no primeiro ano: ~1,3 milhão de linhas — confortável para o Postgres
da VPS.

### Trilha de situação

```sql
CREATE TABLE mega.item_situacao_hist (
  obra        TEXT NOT NULL,
  solicitacao BIGINT NOT NULL,
  sequencia   INTEGER NOT NULL,
  fornecedor  TEXT NOT NULL,
  situacao    TEXT,   -- "Situação do Item", como vem do ERP
  etapa       TEXT,   -- derivada: solicitado / cotado / pedido / contratado
  desde       DATE NOT NULL,
  ate         DATE,   -- NULL = situação vigente hoje
  PRIMARY KEY (obra, solicitacao, sequencia, fornecedor, desde)
);
```

`etapa` é derivada de quais códigos estão preenchidos na linha do dia
(`Cód. Cotação` → `Cód. Pedido` → `Cod. Contrato`). É o que sustenta o objetivo de
"acompanhar prazo de compra": cruzando com `Data de Necessidade`, dá para responder
"este item está vencido e parado na etapa de cotação há N dias" — pergunta que o
próprio ERP não responde, porque ele só guarda o estado de agora.

### Carga por obra, não global

A recarga das tabelas "atual" é `DELETE WHERE obra = :codigo` seguido de `INSERT`,
numa transação, e **só para as obras que a extração da noite concluiu com sucesso**.
Se a obra 410 falhar hoje, os dados de ontem dela permanecem no banco em vez de
desaparecerem do app — mesma regra conservadora que `consolidar.py` já aplica hoje
antes de sobrescrever o consolidado (bloqueia em vez de publicar parcial, a menos que
a obra esteja marcada como "sem movimento").

### Tradução de colunas — pendência explícita

O ERP entrega colunas repetidas por posição (`Descrição`, `Descrição.1`,
`Descrição.2`; `Código`, `Código.1`) que o pandas desambigua por sufixo mas que não
podem virar nome de coluna de banco como estão. São ~60 colunas ao todo (o pior caso,
`Pedidos_Compra`, tem 132 colunas brutas, das quais ~70 são fiscais e serão
descartadas por decisão já tomada acima). A tradução final nome-a-nome será feita
durante a implementação; onde o significado de uma coluna repetida não for óbvio pelo
contexto (ex.: qual `Código.1` é qual fornecedor vs. qual centro de custo), a dúvida
será levantada com o usuário antes de fixar o schema — não adivinhada.

## Pipeline diário

Um único ponto de entrada, `mega/src/rodar_noite.py`, substituindo a execução manual
atual de `executar.py` um relatório por vez:

1. Roda os 4 relatórios em sequência, **na mesma sessão** do ERP (evita logins
   repetidos e o conflito de sessão duplicada descrito abaixo).
2. Ao final de cada relatório, chama o carregador (`mega/src/carregar.py`), que lê os
   `.xlsx` de `dados/bruto/<data>/` e executa o `DELETE+INSERT` por obra descrito
   acima, dentro de uma transação por obra.
3. Grava o resultado em `mega.carga` (relatório, data, obras ok/falhou/sem-movimento,
   duração) — substitui o `_execucao.json` por arquivo por uma tabela que o app
   também pode consultar no futuro (ex.: "última sincronização" na tela).
4. Ao final dos 4 relatórios, apaga os `.xlsx` do dia de `dados/bruto/<data>/` — **só
   os arquivos cuja carga não ficou `BLOQUEADO`** (mesma regra conservadora). Um
   `BLOQUEADO` mantém o Excel bruto como evidência para investigação manual.

### Agendamento

Processo de longa duração dentro do próprio container `mega` (`restart: always`):
um laço que dorme até o horário configurado (`CRON_SCHEDULE_MEGA`, formato cron) e
então dispara `rodar_noite.py`. Mantém tudo num único container, sem depender de cron
do host nem de uma ferramenta de orquestração externa.

**Horário: 02:00, único por dia.** Não é preferência — é requisito. A execução
completa leva cerca de 2h a 2h30 (medido nos logs reais: Análise de Saldo ~70 min,
Pedidos de Compra ~11 min, Itens Solicitados ~15–20 min, Visualização de Itens
~23 min) e mantém a sessão do usuário aberta no ERP o tempo todo. Se o usuário entrar
no Mega durante essa janela, o diálogo de sessão duplicada dispara — e como o robô
está programado para responder "Sim" a esse diálogo (ver spec de automação), ele
**derrubaria a sessão do usuário**. A janela de execução tem que cair fora de
qualquer horário de uso plausível.

### Notificação de falha

**Decisão do usuário: só registrar no banco, sem alerta ativo por enquanto.**
`mega.carga` guarda o que falhou por relatório e por obra; a conferência é manual.
Um indicador de "última carga: N falhas" no app Dados Prevision fica como extensão
futura, fora do escopo desta spec.

### Limitações conhecidas, não resolvidas por esta spec

- **`\\tsclient\WebFile` acumula cópias no servidor Windows do Mega**, fora do
  alcance do container — é limpeza do lado do provedor do ERP, não algo que o robô
  possa fazer remotamente.
- **Encerramento de sessão**: a implementação atual (`encerrar_sessao()`) usa
  `Ctrl+Alt+Del`, que não atravessa o gateway HTML5. **Confirmado pelo usuário
  (2026-09-07) que o caminho correto é: ícone de pessoa → opção de sair/deslogar** —
  a implementação será ajustada para usar esse caminho em vez do atual.

## Empacotamento

### `mega/Dockerfile`

Base Debian (não Alpine — o Chrome real não roda de forma confiável em musl), com
Xvfb, Tesseract com o pacote de português, e Chrome estável via repositório oficial
do Google — não o Chromium empacotado do Playwright, pelo mesmo motivo já documentado
na spec de automação (o gateway HTML5 não carrega nele).

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb tesseract-ocr tesseract-ocr-por wget gnupg \
    && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install-deps chromium   # so as libs de sistema; o navegador usado e o Chrome acima
COPY . .

CMD ["xvfb-run", "-a", "--server-args=-screen 0 1600x900x24", "python", "src/agendador.py"]
```

`requirements.txt` ganha `psycopg[binary]` para a escrita no Postgres — mesma família
de driver que o `pg` do Node já usa do outro lado.

`xvfb-run` substitui o monitor real que hoje faz o Chrome renderizar no Windows do
usuário — sem ele, `headless=False` não tem onde desenhar. É a mesma combinação
descoberta empiricamente na máquina Windows: Chrome real, headed, resolução fixa
1600×900 (controla a geometria da sessão remota).

### `docker-compose.yml` — o que se soma

```yaml
services:
  postgres: {}   # sem mudança
  app: {}        # sem mudança

  mega:
    build: ./mega
    container_name: dadosprevision-mega
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PGHOST: postgres
      PGPORT: 5432
      PGDATABASE: ${POSTGRES_DB:-dadosprevision}
      PGUSER: ${POSTGRES_USER:-postgres}
      PGPASSWORD: ${POSTGRES_PASSWORD:?defina POSTGRES_PASSWORD}
      MEGA_USUARIO: ${MEGA_USUARIO:?defina MEGA_USUARIO}
      MEGA_SENHA: ${MEGA_SENHA:?defina MEGA_SENHA}
      CRON_SCHEDULE_MEGA: ${CRON_SCHEDULE_MEGA:-0 2 * * *}
    volumes:
      - mega_dados:/app/dados   # so para BLOQUEADO reter evidencia; nao e fonte de verdade

volumes:
  pgdata: {}       # sem mudança
  mega_dados:
    driver: local
```

Nenhuma porta nova publicada, nenhum serviço além do já existente `postgres`/`app`.
`MEGA_SENHA` entra no `.env` da VPS do mesmo jeito que `POSTGRES_PASSWORD` e
`PREVISION_API_KEY` já entram hoje — nunca no código, nunca logado.

## Riscos não verificáveis sem execução real na VPS

1. **Download através do gateway em Chrome Linux** — nunca testado. O caminho
   (ERP salva em `\\tsclient\WebFile` → gateway converte em download do navegador →
   interceptado via `page.expect_download()`) depende de redirecionamento feito pelo
   gateway, não pelo SO cliente, então deveria funcionar igual — mas é suposição até
   ser executado.
2. **Estabilidade das chaves naturais entre execuções** — verificadas apenas dentro
   da extração de um único dia (2026-09-02). Não há garantia de que o ERP não
   renumere um código de solicitação ou cotação entre execuções. A primeira semana
   de carga real é a validação; o carregador deve registrar em `mega.carga` quando
   uma chave antes vista desaparecer, em vez de falhar em silêncio.

## Fora de escopo desta spec

- Migração do repositório `mega-relatorios` para dentro de `dadosprevision/mega`
  (o usuário fará isso separadamente).
- Cruzamento de item de orçamento (Prevision) com item comprado (Mega) — depende de
  compatibilidade de código de item entre os dois sistemas, não verificada.
- Qualquer UI nova no Dados Prevision para exibir os dados do Mega — esta spec cobre
  só a ingestão; consumo pelo frontend é trabalho futuro, a ser desenhado quando
  o schema `mega` estiver populado e estável.
- Notificação ativa de falha (e-mail/webhook) — adiada por decisão do usuário.
