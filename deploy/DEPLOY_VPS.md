# Deploy do robo Mega na VPS (dentro da stack do Dados Prevision)

Pre-requisito: o Dados Prevision ja rodando na VPS via Docker Compose (ver
`deploy.md` daquele repositorio), com `postgres` saudavel.

## 1. Aplicar o schema `mega`

Antes de subir o container `mega` pela primeira vez, aplicar o schema
manualmente (o container tambem tenta aplicar sozinho no boot, via
`banco.aplicar_esquema`, mas confirmar manualmente na primeira vez evita
depurar dois problemas ao mesmo tempo):

    docker compose exec -T postgres psql -U postgres -d dadosprevision \
      < sql/schema_mega.sql

Conferir: `docker compose exec postgres psql -U postgres -d dadosprevision -c '\dt mega.*'`
deve listar as 9 tabelas (obra_projeto, itens_solicitados, visualizacao_itens,
item_situacao_hist, pedidos_compra, analise_realizado, analise_pedidos_hist,
analise_contratos_hist, carga).

## 2. Preencher a tabela de-para de obras

A correspondencia entre obra do Mega e projeto da Prevision e PARCIAL
(confirmado com o usuario). Preencher manualmente, uma vez:

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
manualmente pelo nome — a correspondencia foi confirmada como parcial, então
nem toda obra vai ter um `id_prevision`).

## 3. Merge do serviço no `docker-compose.yml`

Copiar o conteúdo de `deploy/docker-compose.mega.snippet.yml` para dentro do
`docker-compose.yml` do Dados Prevision (serviço `mega`, ao lado de `postgres`
e `app`). Adicionar as variáveis `MEGA_USUARIO`, `MEGA_SENHA` e
`CRON_SCHEDULE_MEGA` ao `.env` da VPS (nunca commitado).

## 4. Subir e verificar

    docker compose up -d --build mega
    docker compose logs -f mega

Esperado no log: `login: login efetuado` (ou `sessao reaproveitada`), seguido
da extração dos 4 relatórios. A primeira execução real só acontece no próximo
horário de `CRON_SCHEDULE_MEGA` — para testar sem esperar até de madrugada,
rodar manualmente uma vez:

    docker compose exec mega python src/rodar_noite.py

## 5. Verificação manual do banco com Postgres real (pendência da Tarefa 5)

A Tarefa 5 (`src/banco.py`) foi testada nesta fase só contra SQLite, por falta
de um Postgres real na máquina de desenvolvimento. Antes de confiar na carga em
produção, rodar manualmente, com o Postgres real da VPS (ou um Postgres local
via `docker compose up postgres`):

    docker compose exec mega python -c "
    import sys; sys.path.insert(0, 'src')
    import banco
    conn = banco.conectar()
    banco.aplicar_esquema(conn)
    banco.substituir_obra(conn, 'itens_solicitados',
        ['obra', 'codigo_solicitacao'], '340', [('340', 1)])
    conn.commit()
    print('ok')
    "

Conferir especificamente se `registrar_carga` grava corretamente as colunas
`TEXT[]` (`obras_ok`, `obras_sem_movimento`, `obras_falhou`) — o rascunho da
Tarefa 5 usa `json.dumps()` para compatibilidade com o teste em SQLite; se o
psycopg aceitar `list[str]` Python diretamente para uma coluna `TEXT[]` (o
caminho normal), trocar por atribuição direta em `src/banco.py` antes do
primeiro deploy real.

## 6. Primeira semana: acompanhar `mega.carga`

    SELECT relatorio, data_extracao, obras_ok, obras_falhou, bloqueado
    FROM mega.carga ORDER BY executado_em DESC LIMIT 20;

Sem notificação ativa (decisão do usuário) — a conferência é manual nesta
consulta.
