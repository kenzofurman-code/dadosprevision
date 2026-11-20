# Painel 10 — Restrições dos cards da Prevision

O usuário esclareceu que a fonte desejada são os cards da Prevision. O painel não
deriva restrições de compras do Mega nem tenta vincular automaticamente seus itens
aos cards.

## Decisão visual

Uma matriz de calor cruza projetos com sete faixas de vencimento: atraso acima de
30 dias, de 8 a 30, de 1 a 7, hoje, próximos 7 dias, depois de 7 dias e sem prazo.
Projetos com mais cards atrasados vêm primeiro. Cor identifica a faixa e intensidade
compara quantidade. Cada célula abre os cards correspondentes; o nome do projeto
abre todas as suas restrições abertas. Números, rótulos e foco por teclado complementam
a cor. O painel herda os tokens Piemonte, o tema e a navegação existentes.

A tabela inicial prioriza atrasos e permite ordenar por projeto, título e vencimento.
Alternar para cards preserva o recorte. Os detalhes mostram datas de criação,
vencimento e conclusão, responsáveis, etapa, serviço, pavimento, EAP, descrição,
etiquetas e os itens de checklist com seus próprios responsáveis e prazos.

## Regras dos indicadores

- Uma restrição = um card identificado por projeto + ID Prevision.
- Concluída = `concluido_em` preenchido ou `etapa_fase = done`; não entra em atraso.
- Atrasada = card aberto com prazo próprio vencido ou ao menos um item pendente do
  checklist vencido. Várias etapas vencidas continuam contando como um único card
  atrasado. Os nomes, prazos e dias de atraso das etapas aparecem na tabela e no card.
- O prazo de controle é a menor data entre o vencimento do card e os prazos dos itens
  pendentes do checklist. Define uma única faixa e um único atraso para cada card.
  A diferença usa dias corridos e datas civis; hoje não conta como atraso. Itens
  concluídos do checklist não definem o prazo de controle.
- Referência inicial = hoje em America/Sao_Paulo. Alterá-la recalcula os prazos
  da situação disponível, sem reconstruir estados históricos.
- A data original do card é preservada e exibida separadamente do prazo de controle.
  Sem qualquer prazo válido no card e nos itens pendentes = sem prazo.
- Checklist atrasado = item ainda pendente, em card aberto, com prazo vencido.
  A contagem de itens é separada da contagem de cards.
- Sem responsável considera as pessoas atribuídas ao card. O filtro de pessoa
  também encontra os responsáveis por itens do checklist.
- Indicadores de prazo, falta de responsável e checklist podem se sobrepor.
- O filtro global de projetos ativos e a busca afetam gráfico, contagens e lista.
- Todas as páginas de `/api/data?type=restrictions` são lidas antes de divulgar
  totais. Erro em qualquer página impede contagens parciais.
- A consulta não grava alterações nem dispara sincronização ou acesso ao ERP.
- CSV e impressão exportam todo o recorte, independentemente da paginação da tela,
  com o prazo original do card, o prazo de controle e as etapas atrasadas.

## Referências pesquisadas

Pesquisa bibliográfica e de imagens de controles visuais de restrições realizada
em 05/11/2026. As imagens serviram de referência de organização, sem copiar ativos.

- [Lean Construction Institute — Last Planner System](https://leanconstruction.org/lean-topics/last-planner-system/):
  identificação e remoção antecipada de restrições no processo make-ready.
- [LCI — Glossary](https://leanconstruction.org/glossary/):
  o registro de restrições associa o impedimento, um responsável e a data acordada.
- [O3 — Construction & WorkFace Planning](https://o3.solutions/blog/the-benefits-of-a-purpose-built-solution-that-support-awp-for-construction-and-workface-planning):
  referência visual de painéis que distinguem restrições vencidas e futuras.

A matriz de calor é uma escolha de interface para comparar projetos e permitir
exploração dos cards, não um indicador prescrito pelo Last Planner. Não se calcula
PPC, impacto no caminho crítico ou prioridade sem dados que os sustentem.

## Verificação

`node --test server/restricoes-painel.test.js` verifica datas, limites das faixas,
conclusão, identidade por projeto, checklist e carga paginada. O fluxo visual foi
exercitado em navegador com 225 cards sintéticos em duas páginas da API e três
projetos, incluindo pesquisa, filtros, seleção no mapa, abertura de detalhes,
paginação, exportação, vazio e erro. Não representa uma análise dos dados reais
de produção: o PostgreSQL local não estava disponível durante a implementação.

Na correção da contagem por card, a validação em navegador usou a API real de
produção, com referência em 19/11/2026: o QOYA passou de 18 para 20 cards com atraso;
um card com seis etapas vencidas conta uma vez e exibe as seis etapas com suas
datas. Os projetos ativos somaram 115 cards com algum prazo vencido, mantendo os
mesmos 458 cards abertos. Os oito testes cobrem também os novos critérios.
