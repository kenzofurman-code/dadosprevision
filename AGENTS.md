# AGENTS.md — Dados Prevision

Contexto para qualquer agente (Codex, Claude, etc.) trabalhando neste
repositório. Complementa o `README.md` — leia os dois.

## O que este repositório é

Uma stack Docker Compose com três serviços:

- **`app`** — painel React/Vite + backend Node/Express, sincroniza a API da
  Prevision. Já em produção antes desta integração.
- **`postgres`** — banco único, compartilhado por `app` e `mega`. Porta
  **nunca publicada** (decisão de segurança — só a rede interna do Compose
  acessa). Schema `public` é do `app`; schema `mega` é do serviço `mega`.
- **`mega`** (pasta `mega/`) — **integrado em 2026-09-08**, ainda não
  deployado em produção. Robô Python que extrai relatórios de Suprimentos do
  Mega ERP por OCR sobre a tela transmitida (não há API oficial acessível) e
  carrega no schema `mega` do Postgres, numa rotina noturna.

## De onde veio o `mega/`

Importado do repositório `mega-relatorios` (`../mega-relatorios` na mesma
máquina de desenvolvimento) via `git subtree --squash` — um único commit de
importação, não o histórico completo. **Se precisar entender o *porquê* de
uma decisão dentro de `mega/`** (por que OCR e não API, por que Chrome real e
não headless, por que uma coluna tem o nome que tem), o histórico detalhado
com a razão de cada escolha está no repositório `mega-relatorios`, não aqui.
Ele continua existindo, intacto, e pode ser trazido de novo com o mesmo
`git subtree` se `mega/` precisar de uma atualização.

Documentação de design de `mega/` (specs e plano de implementação) está em
`mega/docs/superpowers/`.

## Estado do deploy (2026-09-08)

- **Local apenas.** Nada foi enviado para `origin` (GitHub). `git push
  origin main` quando estiver pronto.
- **Não deployado na VPS.** A stack roda numa VPS compartilhada (múltiplos
  projetos, gerenciada por Coolify — o projeto deste app lá se chama
  `dadospiemonte`). Nenhum container `dadosprevision-*`/`mega-*` existe lá
  ainda.
- **Testado isoladamente na VPS**, sem tocar em nada do stack real: build da
  imagem `mega/Dockerfile` num diretório descartável, com um Postgres também
  descartável. Confirmado ao vivo: a imagem builda, Chrome real sobe sob
  Xvfb e navega, Tesseract com o pacote de português presente. Todos os
  containers/imagens/arquivos de teste foram removidos depois — nada ficou
  na VPS.
- **Nunca testado**: o robô logando no Mega ERP de verdade a partir de um
  container Linux. Precisa de `MEGA_USUARIO`/`MEGA_SENHA` reais, e login
  real pode derrubar uma sessão ativa do usuário no ERP (ver
  "Cuidados" abaixo) — só deve ser feito de propósito, no horário certo.

## Achado importante já corrigido

O container `mega` **precisa rodar com um init de verdade como PID 1**
(`init: true` no `docker-compose.yml`, já aplicado). Sem isso, `xvfb-run`
roda como PID 1 e trava para sempre — o mecanismo dele de detectar "Xvfb
pronto" depende de receber `SIGUSR1`, entrega que falha para processos PID 1
sem init. Confirmado ao vivo contra a VPS real: sem `init: true`, o container
ficou parado indefinidamente; com ele, funciona em segundos. Se algum dia
`init: true` for removido do serviço `mega` por engano, o sintoma vai ser o
container "up" mas sem nunca logar nada — parece travado, não crashado.

## Variáveis de ambiente

Únicas ao serviço `mega` (documentadas em `.env.example` da raiz, junto com
as demais): `MEGA_USUARIO`, `MEGA_SENHA`, `CRON_SCHEDULE_MEGA` (padrão
`0 2 * * *` — 02:00, fora de qualquer horário de uso do ERP, porque a
execução mantém a sessão do usuário aberta por ~2h30).

Nunca commitar `.env` real. Nunca colocar credencial em código, log, ou
`raw_data`/qualquer coluna do banco.

## Antes do primeiro deploy real (checklist)

Detalhado em `mega/deploy/DEPLOY_VPS.md`. Resumo:

1. Aplicar `mega/sql/schema_mega.sql` manualmente uma vez.
2. Preencher `mega.obra_projeto` (correspondência obra do Mega ↔ projeto da
   Prevision — confirmada como PARCIAL, nem toda obra tem par).
3. Preencher `MEGA_USUARIO`/`MEGA_SENHA`/`CRON_SCHEDULE_MEGA` no `.env` real.
4. `docker compose up -d --build mega`, acompanhar `docker compose logs -f
   mega` na primeira execução manual (`docker compose exec mega python
   src/rodar_noite.py`) antes de confiar no agendamento automático.
5. Primeira semana: acompanhar `mega.carga` manualmente (sem notificação
   ativa — decisão do usuário).

## Cuidados ao trabalhar neste repositório

- **Nunca rode o robô `mega` contra o ERP real sem confirmar com o usuário
  primeiro.** Um login bem-sucedido pode derrubar a sessão do Mega que o
  usuário estiver usando naquele momento (o ERP desloga a sessão mais antiga
  quando o mesmo usuário loga de novo).
- **A porta do Postgres não é publicada** — decisão de segurança deliberada.
  Não abra essa porta para "facilitar" acesso externo sem perguntar.
- **Testes de infraestrutura na VPS** (build de imagem, etc.) devem ser
  feitos em diretório/containers isolados e removidos depois — nunca usando
  os nomes de container/imagem reais (`dadosprevision-*`) antes de um deploy
  de propósito.
- O schema `mega` é dono exclusivo do serviço `mega`; o schema `public` é
  dono exclusivo do serviço `app`. Nenhum dos dois escreve no schema do
  outro.
