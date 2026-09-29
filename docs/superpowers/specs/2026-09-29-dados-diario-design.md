# Dados Diário — design

Data: 2026-09-29

## Objetivo

Trazer os diários de obra (RDO) de todas as obras, extraídos da API externa do App Diário de Obra, em duas
entregas:

1. Aba **Dados Diário** — tela de consulta ao banco, no mesmo padrão das telas de dados do Mega
   (`dados_mega`): tabelas navegáveis, filtro por obra, busca, paginação, colunas configuráveis.
2. Painel de **indicadores diários de obras** dentro da **Gestão à Vista** (efetivo, clima/dias parados,
   ocorrências, preenchimento).

Fica para depois: cruzar obras do Diário com projetos da Prevision e obras do Mega.

## Fonte de dados (verificado em 2026-09-29 com o token real)

- Base: `https://apiexterna.diariodeobra.app/v1`; somente leitura; header `token` (env `TOKEN_DIARIO`).
- Limite: 150 requisições/min por empresa; excedido → HTTP 429.
- Endpoints usados: `/obras`, `/obras/{id}`, `/obras/{id}/relatorios` (filtros `dataInicio`/`dataFim`
  `AAAA-MM-DD`, `limite`, `ordem`), `/obras/{id}/relatorios/{id}`. `/cadastros` e `/empresa` só se necessário.
- Volume hoje: 16 obras, 2.099 relatórios (2025-04-01 a 2026-09-28), ~48 MB de JSON, 11.617 fotos.
- Todos os relatórios usam o modelo "Relatório Diário de Obra (RDO)".
- Chave do relatório é o `_id`: há 8 casos de mais de um relatório na mesma obra e data.
- Campos sempre vazios hoje (não modelar): `controleDeMaterial`, `checklist`, cronograma (só 2 atividades
  ligadas). `horarioDeTrabalho` e dados cadastrais da obra vêm nulos em vários casos.
- Mão de obra vem só no formato `padrao` (função + quantidade + categoria). A categoria é o nome da
  empreiteira (~120, com grafias duplicadas: "FARIAS"/"Farias").
- URLs de fotos (original e miniatura) abrem sem autenticação.

## Decisões

- Sincronizar para o Postgres (schema `diario`) em carga periódica; a tela consulta o banco, nunca a API.
- Tabelas normalizadas para o que os indicadores usam + JSON bruto do relatório (nenhum campo se perde).
- Dia parado = tag de ocorrência ("Dia parado" e correlatas), sem regra de negócio adicional.
- "Dia sem diário" = dias corridos entre a primeira e a última data da obra sem relatório, sem descontar
  domingo/feriado; exibido como número informativo.
- Relatórios em qualquer status (preenchendo, revisão, aprovado) entram; o status é filtro/indicador.

## Componentes

### 1. Sincronização — `server/diario-sync.js`
- Cron no servidor: `CRON_SCHEDULE_DIARIO` (padrão diário à noite). Só roda se `TOKEN_DIARIO` estiver definido.
- Cliente HTTP com controle de taxa (≤ ~130 req/min) e espera + repetição em 429.
- Fluxo: `/obras` → upsert em `diario.obra`; por obra, lista relatórios (`/relatorios`, ordem asc) → compara
  `modified` com o gravado → baixa o detalhe só dos novos/alterados → grava tudo do relatório em uma transação
  (apaga e recria as filhas daquele relatório).
- Primeira carga ~20 min; incremental = 16 listagens + detalhes dos alterados.
- Relatório que deixou de aparecer na lista → `removido_em` preenchido, sem apagar. Falha em uma obra é
  registrada e não interrompe as demais.
- Cada execução registra uma linha em `diario.carga` (início, fim, obras, relatórios novos/alterados,
  erros), como `mega.carga`.
- Token nunca em log, coluna ou resposta de API.

### 2. Banco — schema `diario` (criado no `initDb`, dono exclusivo deste sync)
- `obra` (id da API, nome, status, totais, dados cadastrais, `modified`).
- `relatorio` (`relatorio_id` PK, obra, `data` date, `data_fim`, `numero`, `dia_semana`, status id/descrição,
  clima manhã/tarde/noite + condição + ativo, `indice_pluviometrico`, horário de trabalho, criado/modificado
  por, `modified` da API, `removido_em`, `raw` jsonb).
- `mao_obra` (relatório, função, quantidade, empreiteira, empreiteira normalizada).
- `equipamento` (relatório, descrição, quantidade).
- `ocorrencia` (relatório, descrição, tags text[]) e/ou `ocorrencia_tag`.
- `atividade` (relatório, descrição, observação, status, fotos count).
- `foto` (relatório, url, url miniatura, descrição, origem: galeria/atividade/ocorrência).
- `carga`.
- Índices: (obra, data), (relatorio_id) nas filhas.
- Normalização de empreiteira: trim + maiúsculas + colapso de espaços/pontuação para agrupar; o texto
  original é preservado.

### 3. API — `/api/diario/*`
Consulta (aba Dados Diário), no padrão de `/api/mega/*`:
- `GET /obras` — obras do Diário com totais e última data.
- `GET /summary?obra` — contagens por tabela e data da última carga.
- `GET /data?table&obra&page&limit&search` — tabela paginada; `table` numa lista fixa (relatórios, atividades,
  mão de obra, equipamentos, ocorrências, fotos, cargas); busca e ordenação por whitelist de colunas.
- `GET /relatorios/:id` — diário completo (filhas + fotos), usado no modal de detalhe.

Indicadores (Gestão à Vista):
- `GET /indicadores?obra&dataInicio&dataFim` — agregados: efetivo por dia (e por empreiteira/função), clima e
  dias parados, ocorrências por tag, preenchimento (por status, dias sem diário, atraso de aprovação).
- `obra` opcional (todas); filtros validados.

### 4. Telas
**4a. Aba Dados Diário — `src/DiarioView.tsx` + `src/components/diario/*`**
- Registrada como `dados_diario` ao lado de `dados_mega` em `App.tsx`, replicando o padrão do `MegaView`:
  sub-abas por tabela, seletor de obra, busca, paginação, escolha de colunas e visões salvas (reaproveitando o
  que for genérico do Mega sem refatorá-lo; o que for específico do Mega é duplicado de forma enxuta).
- Cada linha de relatório abre um modal com o diário completo: atividades, efetivo, equipamentos, clima,
  ocorrências, comentários e fotos (miniatura abre a original).

**4b. Gestão à Vista — painel "Indicadores diários"**
- Nova sub-aba do painel (novo valor em `GestaoPanelTab`, ao lado de `contratacoes`), componente próprio em
  `src/components/diario/DiarioIndicadores.tsx`.
- Os painéis da Gestão à Vista são por projeto Prevision, e obra do Diário ainda não está ligada a projeto;
  por isso este painel tem seletor de obra do Diário e período próprios (padrão: todas as obras, últimos 30 dias).
  Quando o cruzamento existir, o seletor pode passar a seguir o projeto selecionado.
- Quatro grupos: efetivo por dia, clima e dias parados, ocorrências, preenchimento. Cartões e gráficos SVG no
  padrão dos gráficos existentes.

### 5. Infra
- `.env.example`: `TOKEN_DIARIO`, `CRON_SCHEDULE_DIARIO`.
- `docker-compose.yml`/`docker-compose.coolify.yml`: repassar as duas variáveis ao serviço `app`
  (hoje `TOKEN_DIARIO` não é repassado).
- Porta do Postgres continua não publicada.

## Testes
- `node --test` em `server/diario-*.test.js`: mapeamento do JSON → linhas (com fixtures pequenas tiradas dos
  JSONs reais), relatório novo × alterado × removido, duas ocorrências na mesma data, 429 com repetição, falha
  de uma obra sem derrubar as outras, normalização de empreiteira, cálculo dos indicadores.
- Interface (aba Dados Diário e painel da Gestão à Vista) verificada no navegador com dados reais; `npm run build` e `npm run lint` limpos.

## Fora de escopo
Cruzamento com Prevision/Mega; controle de material e checklist (vazios); edição de dados; download de mídia;
notificações; regras de feriado/domingo.

## Riscos
- Mudança de contrato da API (v1.0.4) → o `raw` preserva o dado e a carga registra erro por relatório.
- Limite de 429 compartilhado por empresa: a carga usa taxa abaixo do teto.
