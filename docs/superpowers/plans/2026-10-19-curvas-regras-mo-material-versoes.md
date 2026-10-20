# Curvas — Regras MO/Material, Níveis e Versões — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the rules of the spec: MO with payment day and technical retention; material that follows execution with a lead time in days; a parcel generator; rules at levels 3, 4 and 5; saved versions.

**Architecture:**
- The pure engine (`curvas-financeiras-engine.js`) gains a rule resolver and the new distributions, tested with `node --test`.
- The DB layer feeds the engine, lists etapas at levels 3 and 4, and persists versions.
- The React view gains the forms, the version selector and labels.

**Tech Stack:** Node/Express (ESM), Postgres (`pg`), React + TS (Vite), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-19-curvas-regras-mo-material-versoes-design.md`

## Global Constraints

- Competência totals and financeiro totals per etapa/tipo equal the cost: rounding to cents only.
- Retention never reduces competência; all retention is released on `data_fim_obra + 1 year`. Fallback: the max `data_fim` among the level-5 etapas.
- Rule resolution: N5 (Mega code) > N4 (first 4 segments of the Prevision code) > N3 (first 3 segments) > obra default. The most specific rule wins whole; its `null` fields inherit from the obra.
- Schema changes are idempotent `ALTER ... IF NOT EXISTS` in `server/schema.sql`.
- UI copy in pt-BR.

## Review Focus

1. **Etapa with `data_fim < data_inicio` or a null `data_fim`.** It is treated as a single day; no NaN and no lost value.
2. **`pontos_mensais` months outside the etapa date range.** That month's weight is spread over the whole month; value is never dropped.
3. **`dia_pagamento_mo` = 31 in February.** Clamped to the last day of the month.
4. **Retention 0% or inactive.** No zero-value retention events.
5. **An N3 rule whose code matches no etapa.** Ignored silently; the rule list shows "0 etapas".

---

### Task 1: Engine — MO payment day and retention

**Files:** Modify `server/curvas-financeiras-engine.js`, `server/curvas-financeiras-engine.test.js`

**Interfaces:**
- `distribuirMaoDeObraEtapa({ custo, dataInicio, dataFim, diaCorteMo=20, diaPagamentoMo=5, retencaoPercentual=0, dataLiberacaoRetencao=null })` → events `{ tipo:'MAO_DE_OBRA', mesCompetencia, mesFinanceiro, dataPagamento, valor, retencao?:true }`.
- `dataPagamentoMo(mesCompetencia, dia)` → `'YYYY-MM-DD'` in M+1, clamped to the month's last day.

Steps:
- [ ] **Tests:**
  - `diaPagamentoMo: 10` → `dataPagamento` is `'2026-04-10'` for competência `2026-03`.
  - `dataPagamentoMo('2026-01', 31)` → `'2026-02-28'`.
  - Retention 5% with `dataLiberacaoRetencao '2028-06-30'`:
    - competência sum = 10000;
    - financeiro in M+1 = 95%;
    - events with `retencao: true` sum 500, with `mesFinanceiro '2028-06'`.
  - Retention 0 → no `retencao` events.
- [ ] Run `node --test server/curvas-financeiras-engine.test.js` → FAIL.
- [ ] Implement.
- [ ] Re-run → PASS.

### Task 2: Engine — material following execution

**Files:** same as Task 1

**Interfaces:**
- `distribuirMaterialEtapa(...)` keeps its signature.
- The proportional mode spreads each month's weight over the days of that month ∩ [inicio, fim]. If the intersection is empty, it uses the whole month.
- Each day is shifted by `−diasAntecedencia` and bucketed by month.
- `dataEntrega` = the weighted mean day inside the bucket.
- Without `pontosMensais`: uniform over [inicio, fim] with the same shift.
- Lots mode is unchanged.

Steps:
- [ ] **Tests:**
  - Etapa 2026-04-01..2026-04-30, one point for April, 10 days of lead time: competência March ≈ 10/30 of the value and April ≈ 20/30 (±1 cent); the total is exact.
  - Without points, etapa 2026-04-01..2026-05-31, 0 days of lead time: competência April ≈ 30/61 and May ≈ 31/61.
  - Parcelled with 12 parcels of 28 days: 12 events, each 1/12.
- [ ] Update existing tests whose expectations encoded the old "1st of the month − lead" behaviour, with a comment.
- [ ] Implement.
- [ ] Run → PASS.

### Task 3: Engine — rule resolution by level

**Files:** same as Task 1

**Interfaces:**
- `resolverRegra(mapa: Map<string,param>, { codigoMega, codigoPrevision }, tipo)` → `param | null`, with `param.codigo_etapa` as the origin.
  - Keys are `${codigo}|${tipo}`. Lookup order: codigoMega, then the first 4 Prevision segments, then the first 3.
- `calcularCurvasFinanceiras({ etapas, parametrosObra, parametrosEtapas /* Map keyed codigo|tipo */, realizadoHistorico })`:
  - uses `resolverRegra` for MATERIAL and MAO_DE_OBRA;
  - reads `parametrosObra.dia_pagamento_mo`, `retencao_mo_ativa`, `retencao_mo_percentual` and `data_fim_obra` (fallback: max `data_fim`);
  - each `etapasCalculadas[i]` gains `regraMaterial` and `regraMo`: `{ codigo_origem, nivel } | null`;
  - `kpis` gains `dataLiberacaoRetencao`.
- MO retention for an etapa:
  - `retencao_ativa ?? obra.retencao_mo_ativa` gives active or not;
  - `retencao_percentual ?? obra.retencao_mo_percentual` gives the percentage.

Steps:
- [ ] **Tests:**
  - An N3 rule `01.02.03|MATERIAL` applies to etapa `01.02.03.04.005` (Prevision `01.02.03.04.05`).
  - N4 overrides N3; N5 overrides N4.
  - A `MAO_DE_OBRA` rule does not change the MATERIAL params of the same etapa.
  - `regraMaterial.nivel === 3`.
- [ ] Implement.
- [ ] Run → PASS.
- [ ] Commit tasks 1–3.

### Task 4: Schema, DB layer, versions API

**Files:** `server/schema.sql`, `server/curvas-financeiras-db.js`, `server/index.js`

- [ ] **Schema:**
  - add the columns from the spec;
  - add `curva_versoes(id SERIAL PK, projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE, nome TEXT NOT NULL, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL)` and an index on `(projeto_id, criado_em DESC)`.
- [ ] **`obterParametrosObra`:** returns the new fields with defaults (`false`, `5`, `null`).
- [ ] **`salvarParametrosCurvas`:** persists the new obra and etapa fields.
- [ ] **`obterParametrosEtapas`:** the map is keyed `codigo|tipo`.
- [ ] **`obterDadosCurvasFinanceiras`:** adds `etapasHierarquia` (`cff_itens` nivel 3 and 4: `{codigo, nome, nivel}`) and passes `codigo_prevision` through to the engine.
- [ ] **Version functions:**
  - `salvarVersaoCurvas(projetoId, nome)` recomputes, strips `etapas[].eventos` and `eventosEconomico`, then inserts;
  - `listarVersoesCurvas(projetoId)`;
  - `obterVersaoCurvas(id)`;
  - `excluirVersaoCurvas(id)`.
- [ ] **Routes:** `GET/POST /api/curvas-financeiras/versoes`, `GET/DELETE /api/curvas-financeiras/versoes/:id`, all through `rota(...)`.
- [ ] Verify with `node --check` on the modified files, then run the engine tests.
- [ ] Commit.

### Task 5: UI

**Files:** `src/CurvasFinanceirasView.tsx` (+ `.css` only if needed)

- [ ] **Types:** add the new fields (`etapasHierarquia`, `regraMaterial`/`regraMo`, obra and etapa params).
- [ ] **Obra tab:**
  - fields "Data de fim da obra" (placeholder: the computed fallback), "Retenção técnica MO" (checkbox) and "% retenção";
  - the info card mentions the retention rule.
- [ ] **Etapa tab:**
  - selectors Tipo (Material / Mão de obra), Nível (3/4/5) and an etapa select filtered by level;
  - Material fields as today, plus the parcel generator (nº parcelas, 1º vencimento, intervalo) that fills `parcelas_str`, with a preview;
  - MO fields: retenção (Herdar da obra / Sim / Não) and %;
  - rule list: shows level, tipo and the count of etapas reached.
- [ ] **Etapas table:** the badge shows the effective rule origin ("Herdado de X (N3)").
- [ ] **Header:**
  - "Recarregar" → "Recalcular";
  - "Salvar versão" button (prompt for the name);
  - "Visualizando" select (Atual + versions) with a delete action;
  - a read-only banner while a version is open; Parâmetros is disabled.
- [ ] **KPI:** "Realizado Histórico" → "Avanço Físico Valorizado", with a tooltip.
- [ ] Run `npm run build` → no TS errors.
- [ ] Commit.

### Task 6: Verification

- [ ] Run `node --test server/curvas-financeiras-engine.test.js` and `npm run build`.
- [ ] If a local DB is available, run the app and exercise the flow; otherwise report it as not verified live.
