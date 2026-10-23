# Curvas — Realizado + projeção: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nova aba "Realizado + projeção" nas Curvas: apropriado do Mega até o mês de corte, saldo projetado pelo físico
restante, financeiro do realizado pelas APs (planilha Conciliação Financeira), comparado com a teórica na mesma tela.

**Architecture:** função pura `projetarRealizado` no motor (reaproveita `calcularCurvasFinanceiras` para a teórica e
para a projeção do saldo); leitor puro do xlsx em `server/pagamentos-ap.js`; `server/curvas-financeiras-db.js` monta a
entrada (refatorada para ser compartilhada) e busca realizado e pagamentos; componente React próprio com SVG à mão,
como o gráfico atual.

**Tech Stack:** Node/Express, Postgres, `node --test`, React + TypeScript (Vite), `xlsx` no front.

**Spec:** `docs/superpowers/specs/2026-10-22-curvas-realizado-projecao-design.md`

## Global Constraints

- Textos da tela em pt-BR.
- Nada é salvo em `curva_versoes`; o cálculo é sob demanda.
- O schema `mega` só é lido. A tabela nova fica no `public`.
- Base do %: o custo projetado (`kpis.totalOrcado` da teórica).
- Corte padrão: último mês fechado (`hojeNoBrasil()` → mês anterior).
- Classificação material/MO: `classificadorDaObra(pId).tipoDe(descricao, cod)`.
- Códigos do realizado: `etapaParaMega(cod_estruturado) || cod_estruturado`.

## Review Focus

1. Corte antes do início → idêntico à teórica (teste da Task 1).
2. Excel entrega datas como número serial (`raw: true`) → o leitor converte (teste da Task 2).
3. AP com várias parcelas e várias etapas → rateio proporcional, sem perder valor (teste da Task 1).
4. Etapa com custo projetado zero num tipo e realizado nesse tipo → todo o realizado é excedente (teste da Task 1).
5. Etapa com pontos mensais só até o corte, mas `data_fim` depois → pendente (há pontos, nenhum peso futuro) (teste
   da Task 1).

---

### Task 1: `projetarRealizado` no motor

**Files:** Modify `server/curvas-financeiras-engine.js`; Test `server/curvas-financeiras-engine.test.js`

**Interfaces:**
- Produces:
  `projetarRealizado({ etapas, parametrosObra, parametrosEtapas, corte, realizado, pagamentos })`
  - `etapas`, `parametrosObra`, `parametrosEtapas`: os mesmos de `calcularCurvasFinanceiras`.
  - `corte: 'YYYY-MM'`.
  - `realizado: [{ codigo_etapa: string, tipo: 'MATERIAL'|'MAO_DE_OBRA', data: 'YYYY-MM-DD'|null, valor: number, ap: number|null }]`.
  - `pagamentos: Map<number, [{ vencimento: 'YYYY-MM-DD', valor: number, saldo: number }]>` (por AP).
  - Retorna `{ corte, seriesMensal, etapas, kpis }`:
    - `seriesMensal[]`: `{ mes, realizado: boolean, competenciaMaterial, competenciaMaoDeObra, competenciaForaCronograma,
      competenciaMensal, financeiroMaterial, financeiroMaoDeObra, financeiroForaCronograma, financeiroMensal,
      teoricoCompetenciaMaterial, teoricoCompetenciaMaoDeObra, teoricoFinanceiroMaterial, teoricoFinanceiroMaoDeObra,
      teoricoEconomicoMensal }` (material/MO incluem o fora do cronograma do tipo).
    - `etapas[]`: `{ codigo_etapa, nome, projetado, realizado, saldoProjetado, excedente, pendente, alerta }`
      com `alerta: 'excedente'|'pendente'|null` (excedente vence); só etapas com projetado ou realizado.
    - `kpis`: `{ base, realizadoAteCorte, teoricoAteCorte, desvio, desvioPct, saldoProjetado, excedente, pendente,
      foraDoCronograma, custoFinalEstimado, realizadoSemPagamento, inicioTeorico }`.

Regras (do spec): realizado com `data` > fim do corte é ignorado; `data` nula → mês de corte. Código fora de `etapas` =
fora do cronograma. Por etapa e tipo: saldo = custo − realizado. Excedente se < 0. Saldo > 0 tem físico futuro se
(havendo pontos com peso > 0) algum ponto tem mês > corte; senão, `data_fim` > último dia do corte. Com físico futuro:
etapa clonada com custo = saldo, pontos ≤ corte zerados e `data_inicio = max(data_inicio, 1º dia após o corte)`,
rodada em `calcularCurvasFinanceiras`; eventos com mês de competência ou financeiro ≤ corte vão para
`proximoMesIso(corte)`. Financeiro do realizado: AP presente em `pagamentos` → parte de cada parcela =
`valor × parcela.valor / Σ valores`, e a fração em aberto (`saldo/valor`) de parcela com vencimento ≤ corte vai para o
mês seguinte ao corte; AP ausente → estimado (material: `data` + prazo/parcelas da regra; MO: `dataPagamentoMo` do mês
com a retenção da regra, liberada em `kpis.dataLiberacaoRetencao` da teórica), e soma em `realizadoSemPagamento`.

- [ ] **Step 1: testes que falham** (`describe('projetarRealizado')`), com uma etapa base `E1` de 01/2026 a 06/2026,
  material 600 e MO 600, pontos 1/6 por mês, regra padrão (antecedência 0, prazo 0):
  - `corte antes do início e sem realizado → séries iguais às da teórica` (corte `2025-10`: para cada mês,
    `competenciaMensal === teoricoCompetenciaMaterial + teoricoCompetenciaMaoDeObra` e o mesmo no financeiro).
  - `realizado parcial: saldo só depois do corte` (corte `2026-03`, realizado material 200 em `2026-02-10`: competência
    material de 2026-04..06 soma 400 e nada de projeção ≤ 2026-03).
  - `excedente não distribui e marca a etapa` (realizado MO 900 → `excedente` 300, `alerta 'excedente'`, nenhuma MO
    depois do corte).
  - `projetado zero no tipo: todo o realizado é excedente` (etapa só material, realizado MO 50 → excedente 50).
  - `sem físico futuro → pendente` (corte `2026-06`, realizado material 100 → `pendente` 500, `alerta 'pendente'`,
    soma das séries sem os 500).
  - `pontos só até o corte com data_fim depois → pendente`.
  - `antecedência antes do corte vai para o mês seguinte` (antecedência 40, corte `2026-02`: competência material de
    `2026-03` inclui a chegada que cairia em 02).
  - `fora do cronograma entra no total e no %` (realizado `99.99.99` 70 → `competenciaForaCronograma` 70 e
    `kpis.foraDoCronograma` 70; `custoFinalEstimado = base + excedente + 70`).
  - `financeiro pela AP: parcelas, rateio e aberto vencido` (AP 7 com parcelas 2026-03-15 valor 60 saldo 0 e
    2026-02-15 valor 40 saldo 40; realizado 50 da AP 7 em 2026-02 com corte 2026-03 → financeiro 30 em 2026-03 e 20 em
    2026-04).
  - `sem AP: financeiro estimado e realizadoSemPagamento` (MO 100 em 2026-02-10 → financeiro em 2026-03, dia 5).
  - Invariante: para cada etapa, `realizado + saldoProjetado + pendente = max(custo, realizado)` e
    Σ competência das séries = `base + excedente + foraDoCronograma − pendente` (±0,05).
- [ ] **Step 2:** `node --test server/curvas-financeiras-engine.test.js` → falham (`projetarRealizado` não existe).
- [ ] **Step 3:** implementar `projetarRealizado` (exportada) no motor, sem mudar `calcularCurvasFinanceiras`.
- [ ] **Step 4:** `npm run test:server` → tudo passa.
- [ ] **Step 5:** commit `feat(curvas): projetarRealizado (realizado do Mega + saldo pelo físico restante)`.

### Task 2: planilha de pagamentos (leitor, tabela, importação)

**Files:** Create `server/pagamentos-ap.js`, `server/pagamentos-ap.test.js`; Modify `server/schema.sql`,
`server/curvas-financeiras-db.js`, `server/index.js`

**Interfaces:**
- Produces:
  - `lerConciliacaoFinanceira(matriz: unknown[][]) → { linhas: [{ ap, parcela, tipo_documento, vencimento, valor_rateado, pago, saldo, cod_estruturado }], erros: string[] }`
  - `importarPagamentos(projetoId, { arquivo, matriz }) → { linhas, total, importado_em }`
  - `pagamentosDoProjeto(projetoId) → { mapa: Map<number, [{vencimento, valor, saldo}]>, importado_em, arquivo }`
  - `POST /api/curvas-financeiras/pagamentos` `{ projectId, arquivo, matriz }`
- Tabela `pagamentos_ap (id serial, projeto_id text, ap int, parcela text, tipo_documento text, vencimento date,
  valor_rateado numeric, pago numeric, saldo numeric, cod_estruturado text, arquivo text, importado_em timestamptz
  default now())` + índice `(projeto_id, ap)`.

Leitor: acha a linha de cabeçalho pela célula cujo texto normalizado (sem acento, minúsculo) é `numero ap`; colunas
pelo início do nome normalizado: `numero ap`, `parcela`, `tipo documento`, `data vencimento`, `valor rateado`,
`pagamentos`, `saldo a pagar`, `codigo estruturado`. Linha de dado = `Número AP` numérico. Data: número serial do
Excel (dias desde 1899-12-30), `Date` ou texto ISO/`dd/mm/aaaa`. Código: o que vem antes de ` - `. Sem cabeçalho →
erro `Cabeçalho "Número AP" não encontrado.`. A importação apaga e regrava as linhas do projeto numa transação.

- [ ] **Step 1: testes que falham:** `lê o cabeçalho do Mega e ignora linhas de nível`; `data serial do Excel vira
  ISO` (45672 → `2025-01-15`); `código estruturado sem a descrição`; `sem cabeçalho → erro`.
- [ ] **Step 2:** `node --test server/pagamentos-ap.test.js` → falham.
- [ ] **Step 3:** implementar o leitor, a tabela no `schema.sql`, `importarPagamentos`/`pagamentosDoProjeto` no
  db e a rota.
- [ ] **Step 4:** `npm run test:server` → passa.
- [ ] **Step 5:** commit `feat(curvas): importação da Conciliação Financeira (pagamentos por AP)`.

### Task 3: endpoint `realizado`

**Files:** Modify `server/curvas-financeiras-db.js`, `server/index.js`

**Interfaces:**
- Consumes: `projetarRealizado` (Task 1), `pagamentosDoProjeto` (Task 2).
- Produces: `obterRealizadoProjecao(projetoId, corte?) → { obra, corte, cortePadrao, ...projetarRealizado, avisos,
  pagamentos: { importado_em, arquivo } | null, ultimaCargaMega }`; sem obra → `{ obra: null, motivo }`.
  `GET /api/curvas-financeiras/realizado?projectId=&corte=YYYY-MM`.

- [ ] **Step 1:** extrair de `obterDadosCurvasFinanceiras` a função interna `montarEntradaCurvas(pId)` (parâmetros,
  importação, etapas para o cálculo, conciliação), sem mudar o retorno de `obterDadosCurvasFinanceiras`.
- [ ] **Step 2:** `obterRealizadoProjecao`: realizado agrupado por `cod_estruturado, cod_item, descricao_1,
  data_documento, ap` de `mega.analise_realizado` (com `raw_data ? 'cod_estruturado'`), tipo pelo classificador;
  `ultimaCargaMega = max(data_extracao)`. Avisos: carga anterior ao fim do mês de corte; planilha ausente; planilha
  importada antes do fim do corte; `realizadoSemPagamento > 0`. Corte inválido → 400.
- [ ] **Step 3:** `npm run test:server` e `node -e "import('./server/curvas-financeiras-db.js')"` → sem erro.
- [ ] **Step 4:** commit `feat(curvas): endpoint do Realizado + projeção`.

### Task 4: aba "Realizado + projeção"

**Files:** Create `src/components/curvas-financeiras/RealizadoProjecao.tsx`, `.css`; Modify `src/CurvasFinanceirasView.tsx`

**Interfaces:**
- Consumes: `GET /api/curvas-financeiras/realizado`, `POST /api/curvas-financeiras/pagamentos`.
- Produces: `<RealizadoProjecao projectId={string} scopeFilter={'todos'|'material'|'mao_de_obra'} />`.

Tela (spec, seção Tela): topo com `<input type="month">` do corte (mín. mês anterior a `kpis.inicioTeorico`, máx.
`cortePadrao`), Recalcular e upload do xlsx (`XLSX.read` + `sheet_to_json({header:1, raw:true, defval:null})`, como em
`ContratacoesConfig.tsx`) com a data da última carga; cartões; gráfico SVG com seletor competência/financeiro e modos
acumulado/mensal R$/% (acumulado calculado no front pelo filtro), realizado cheio até o corte e tracejado depois, teórica
em cinza com botão mostrar/esconder, linha vertical no corte; tabela mensal (teórico, realizado/projetado, diferença R$
e %, mês de corte destacado); lista de etapas em alerta em vermelho; avisos.

- [ ] **Step 1:** componente e CSS (tokens de cor existentes do `.curvas-fin-*`, vermelho `#dc2626`).
- [ ] **Step 2:** nova aba `'realizado'` em `TabMode`, botão "Realizado + projeção" e render do componente.
- [ ] **Step 3:** `npm run build` → sem erros de tipo.
- [ ] **Step 4:** commit `feat(curvas): aba Realizado + projeção`.

### Task 5: conferência e PR

- [ ] **Step 1:** script só de leitura no container de produção (motor da branch copiado para `/tmp`) para QOYA e POTY
  com corte 2026-09: competência realizada até 09/2026 = soma SQL do apropriado com etapa; corte antes do início =
  teórica; mostrar KPIs. Remover o script depois.
- [ ] **Step 2:** `npm run test:server` e `npm run build`.
- [ ] **Step 3:** push e PR contra `main`.
