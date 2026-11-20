# Dados Prevision

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Painel de controle de obras e gestão à vista. Consolida cronogramas e cards da
Prevision, suprimentos do Mega e indicadores do Diário de Obra.

## Operating Context

Aplicação existente em React/Vite e Node/Express, com PostgreSQL e Docker Compose.
Os painéis da Gestão à Vista compartilham a seleção de projetos ativos e recursos
de impressão. Há temas claro e escuro.

## Capabilities and Constraints

- O painel 10 acompanha as restrições dos **cards da Prevision**, conforme
  esclarecimento do usuário. Mostra atrasos por projeto, datas, tabela, gráfico
  interativo e detalhes dos cards.
- A situação do card e a situação de cada item de checklist são informações
  distintas; checklist não multiplica a contagem de restrições.
- A consulta usa os dados sincronizados no banco. A atualidade depende da
  sincronização disponível; a hora da consulta não comprova atualização na origem.
- Preservar a identidade e os demais painéis existentes. Regras de infraestrutura,
  credenciais e acesso ao ERP estão em AGENTS.md.
