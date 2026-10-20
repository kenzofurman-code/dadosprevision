# Painel 9 — Teórico x Físico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Painel 9 in Gestão à Vista. It shows the whole EAP plus a cascaded "maiores variações" view, with the budget adjusted by INCC-DI (synced from Banco Central).

**Architecture:**
- A pure calc module (`server/painel-teorico.js`, tested) covers BCB parsing, INCC factors, line assembly with level aggregation, and ranking.
- `server/incc.js` syncs the index.
- `server/painel-teorico-db.js` gathers Prevision, Mega and custo projetado data.
- A React component renders the panel; `App.tsx` gets only the tab button and the render.

**Tech Stack:** Node/Express ESM, Postgres, `node:test`, React + TS (Vite), `node-cron`.

**Spec:** `docs/superpowers/specs/2026-10-20-painel-9-teorico-fisico-design.md`

## Global Constraints

- **Read-only on Mega:** only read `mega.*`; never write there.
- **INCC-DI only:** BCB SGS series 192.
- **Formulas, exactly as the spec says:**
  - `fatorPosterior(m)` = product of (1 + v/100) over the months strictly after `m`, up to the last published month;
  - OR = base × fatorPosterior(mes_base);
  - AP = Σ apropriado(month) × fatorPosterior(month), with no-date rows using factor 1;
  - comprometido = AP + saldo_contratos + saldo_pedidos;
  - resultado = OR − projetado;
  - EF = AP / OR;
  - RT = OR × MF − AP;
  - A = EF − MF;
  - B = (RT − resultado) / OR.
- **Levels 1–4:** sums of their level-5 children. MF is OR-weighted. Ratios are recomputed from the sums. OR = 0 gives `null` ratios.
- **UI copy in pt-BR.**

## Review Focus

1. **Obra without `mes_base`:** OR-dependent fields are `null`; the UI asks for the base month. Nothing crashes.
2. **No custo projetado import:** projetado, resultado and B are `null`; the rest still works.
3. **Project without a linked Mega obra:** AP and saldos are 0; the response carries `obra: null` and the UI shows a notice.
4. **BCB fetch failure or empty `indices_incc`:** factor 1, `ultimo_mes: null`, plus a warning. The sync failure is logged and does not crash the server.
5. **Duplicate `cff_itens` codes from multiple budgets:** one row per code, the most recently updated.

---

### Task 1: Pure calc module

**Files:** Create `server/painel-teorico.js` and `server/painel-teorico.test.js`.

**Produces:**
- `parseSerieBcb(json)` → `[{ mes: 'YYYY-MM', variacao: number }]`. Skips invalid entries.
- `criarFatorPosterior(indices: [{mes, variacao}])` → `{ fatorPosterior(mes: 'YYYY-MM'|null): number, ultimoMes: string|null }`.
- `montarLinhas({ itens, porEtapa, projetado, fatorBase, paraMega })` → `linhas[]` with the spec fields, sorted by `codigo`.
  - `itens`: `[{ codigo, descricao, nivel, custo_total, peso_realizado }]`, Prevision codes, levels 1–5.
  - `porEtapa`: `Map<codMega, { apropriado_nominal, apropriado_reajustado, saldo_contratos, saldo_pedidos }>`.
  - `projetado`: `Map<codMega, number> | null`.
  - `fatorBase`: `number | null`; `null` means no `mes_base`.
- `rankingNivel5(linhas, 'A'|'B')` → level-5 codes with OR > 0 and a non-null value, sorted by |value| desc.

Steps:
- [ ] **Tests:**
  - BCB parsing: `[{data:'01/07/2026',valor:'0.61'}]` → `[{mes:'2026-07',variacao:0.61}]`.
  - `fatorPosterior('2026-06')` with jul 0.61 and ago 0.66 = 1.0061 × 1.0066; `fatorPosterior('2026-08')` = 1.
  - GERAL numbers from the spec (single level-5 under a level-1): EF ≈ 0.5833, RT ≈ −3,106,330 (±1), B ≈ −0.0500 (±0.0001), comprometido = AP + saldos.
  - Level-1 aggregation of two children: MF is OR-weighted.
  - OR = 0 → `null` ratios, excluded from the ranking.
  - `fatorBase` null → OR null.
  - Ranking by absolute value, both signs.
- [ ] Run `node --test server/painel-teorico.test.js` → FAIL (module missing).
- [ ] Implement.
- [ ] Re-run → PASS.
- [ ] Commit.

### Task 2: INCC sync, schema, DB assembly, API

**Files:** Create `server/incc.js` and `server/painel-teorico-db.js`. Modify:
- `server/schema.sql`;
- `server/contratacoes-db.js` (export `obraDoProjeto`, `ultimaImportacao`, `classificadorDaObra`, `valoresPorEtapa`);
- `server/index.js` (routes and cron);
- `.env.example` (`CRON_SCHEDULE_INCC`).

**Produces:**
- `sincronizarIncc({ fetchImpl = fetch } = {})` → `{ meses_gravados, ultimo_mes }`.
- `obterPainelTeorico(projetoId)`.
- `salvarMesBase(projetoId, 'AAAA-MM')`.
- **Routes:** `GET /api/painel-teorico`, `PUT /api/painel-teorico/mes-base`, `POST /api/incc/sincronizar`, all via `rota`.

Steps:
- [ ] **Schema:** `indices_incc` and `orcamento_reajuste_obra`, as in the spec.
- [ ] **Apropriado by etapa × month:** `SELECT raw_data->>'cod_estruturado', TO_CHAR(data_documento,'YYYY-MM'), SUM(COALESCE(valor_apropriacao,0)) FROM mega.analise_realizado WHERE obra=$1 AND raw_data ? 'cod_estruturado' GROUP BY 1,2`. This is the same filter as `valoresPorEtapa`.
- [ ] **Saldos:** from `valoresPorEtapa` (`em_contrato` / `em_pedido`), summed over tipos.
- [ ] **`cff_itens`:** `DISTINCT ON (codigo) ... ORDER BY codigo, updated_at DESC`, levels 1–5.
- [ ] **Cron:** `CRON_SCHEDULE_INCC` (default `0 7 * * *`). At startup, sync when `indices_incc` is empty. Both are fire-and-forget with a logged error.
- [ ] **Verify:** `node --check` on the touched server files; validate `schema.sql` twice on PGlite in the scratchpad; run `npm run test:server` green.
- [ ] Commit.

### Task 3: UI

**Files:** Create `src/components/painel-teorico/PainelTeorico.tsx` and `.css`. Modify `src/App.tsx`: the `GestaoPanelTab` union gains `'teorico'`, plus the tab button "Painel 9: Teórico x Físico" and the render.

Steps:
- [ ] **Quadrinho INCC-DI:**
  - `type="month"` input with a save button;
  - accumulated factor (`+x,xx%`) and "índices até mm/aaaa";
  - "Atualizar índices" button;
  - `<details>` with month and variation since the base month.
- [ ] **Controls:** "EAP inteira / Maiores variações", N (15/20) and régua (A: "Evolução financeira − Medição física", B: "Teórico x Projeção").
- [ ] **Table:**
  - columns: código, descrição, orç. reajustado, apropriado reaj., saldo contratos, saldo pedidos, comprometido, custo projetado, resultado, evol. financeira, medição física, resultado teórico, A (p.p.), B (%);
  - indent by level;
  - rank badge `#k` on the selected level-5 rows;
  - red per the spec's sign rule.
- [ ] **Cascade:** keep rows where `sel === codigo || sel.startsWith(codigo + '.')` for some selected `sel`.
- [ ] **Notices:** no `mes_base`, no Mega obra, no import, `ultimo_mes` null.
- [ ] Run `npm run build` → OK.
- [ ] Commit.

### Task 4: Verification and PR

- [ ] Run `npm run test:server` and `npm run build`.
- [ ] Self-review the whole branch, then push and open a PR. The PR notes that live validation against the POTY sheet (54,68% and 58,33%) is pending.
