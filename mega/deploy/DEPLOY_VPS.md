# Deploy do robô Mega na VPS (dentro da stack do Dados Prevision)

Pré-requisito: o Dados Prevision já rodando na VPS via Docker Compose (ver
`deploy.md` na raiz do repositório), com `postgres` saudável. O serviço `mega`
já está integrado ao `docker-compose.yml` da raiz — os comandos abaixo rodam
a partir da raiz do repositório (`dadosprevision/`), não desta pasta.

## 1. Aplicar o schema `mega`

Antes de subir o container `mega` pela primeira vez, aplicar o schema
manualmente (o container também tenta aplicar sozinho no boot, via
`banco.aplicar_esquema`, mas confirmar manualmente na primeira vez evita
depurar dois problemas ao mesmo tempo):

    docker compose exec -T postgres psql -U postgres -d dadosprevision \
      < mega/sql/schema_mega.sql

Conferir: `docker compose exec postgres psql -U postgres -d dadosprevision -c '\dt mega.*'`
deve listar as 9 tabelas (obra_projeto, itens_solicitados, visualizacao_itens,
item_situacao_hist, pedidos_compra, analise_realizado, analise_pedidos_hist,
analise_contratos_hist, carga).

## 2. Preencher a tabela de-para de obras

A correspondência entre obra do Mega e projeto da Prevision é PARCIAL
(confirmado com o usuário). Preencher manualmente, uma vez:

    docker compose exec -T postgres psql -U postgres -d dadosprevision <<'SQL'
    INSERT INTO mega.obra_projeto (obra, id_prevision, observacao) VALUES
      ('340', NULL, 'confirmar codigo Prevision'),
      ('410', NULL, 'confirmar codigo Prevision'),
      ('430', NULL, 'confirmar codigo Prevision'),
      ('480', NULL, 'confirmar codigo Prevision'),
      ('490', NULL, 'confirmar codigo Prevision'),
      ('601', NULL, 'confirmar codigo Prevision'),
      ('630', NULL, 'confirmar codigo Prevision'),
      ('650', NULL, 'confirmar codigo Prevision')
    ON CONFLICT (obra) DO NOTHING;
    SQL

Depois, atualizar `id_prevision` obra por obra com o `id_prevision` real
(consultar `SELECT id_prevision, nome_projeto FROM public.projetos;` e casar
manualmente pelo nome — a correspondência foi confirmada como parcial, então
nem toda obra vai ter um `id_prevision`).

## 3. Variáveis de ambiente

`MEGA_USUARIO`, `MEGA_SENHA` e `CRON_SCHEDULE_MEGA` já estão declaradas no
`.env.example` da raiz do repositório, junto com as demais variáveis da
stack. Preencher no `.env` real da VPS (nunca commitado) — não existe `.env`
separado dentro de `mega/`.

## 4. Subir e verificar

    docker compose up -d --build mega
    docker compose logs -f mega

Esperado no log: `login: login efetuado` (ou `sessao reaproveitada`), seguido
da extração dos 4 relatórios. A primeira execução real só acontece no próximo
horário de `CRON_SCHEDULE_MEGA` — para testar sem esperar até de madrugada,
rodar manualmente uma vez:

    docker compose exec mega python src/rodar_noite.py

## 5. Primeira semana: acompanhar `mega.carga`

    SELECT relatorio, data_extracao, obras_ok, obras_falhou, bloqueado
    FROM mega.carga ORDER BY executado_em DESC LIMIT 20;

Sem notificação ativa (decisão do usuário) — a conferência é manual nesta
consulta.

## Verificação já feita contra Postgres real (2026-09-08)

O carregador foi testado de ponta a ponta contra um Postgres 16 real (fora
desta VPS, container descartável) com os dados reais de uma extração
completa: os 4 relatórios, as 8 obras, a trilha de situação e a checagem de
contaminação entre obras. Três bugs que só apareciam contra Postgres real
(não contra SQLite, usado nos testes automatizados) foram encontrados e
corrigidos nessa verificação — `registrar_carga` com `TEXT[]`, `NaN` do
pandas em coluna numérica, e a linha de rodapé do grid de Visualização de
Itens. Detalhes no histórico do repositório original (`mega-relatorios`,
commit `c8933cb`) ou em `git log -- mega/src/banco.py mega/src/carregar.py`.

O que **não** foi testado ainda: o robô contra o ERP real rodando de dentro
de um container Linux (Chrome sob Xvfb) — isso só é possível na própria VPS,
é o primeiro passo real desta seção.
