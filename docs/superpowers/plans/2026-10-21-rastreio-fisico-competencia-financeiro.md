# Rastreio físico → competência → financeiro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All three curves come from the same daily physical progress, with the new lot rule. Each etapa returns `fluxos` (fis → comp → fin, with value and reason). The Analytic Sheet gets a compact "Rastreio" mode with arrows and a panel, plus a filter that hides etapas with no value.

**Architecture:**
- Engine (`server/curvas-financeiras-engine.js`):
  - `fisicoDiario` is the single source of distribution;
  - the material and MO functions produce `{ eventos, fluxos }`, while the public functions still return `eventos` for compatibility;
  - `calcularCurvasFinanceiras` attaches `fluxos` per etapa.
- Front:
  - a pure module `rastreio.ts` turns fluxos into links and panel rows;
  - `RastreioPlanilha.tsx` draws the compact table with an SVG overlay and the panel.

**Spec:** `docs/superpowers/specs/2026-10-21-rastreio-fisico-competencia-financeiro-design.md`

## Global Constraints

- **Flow shape:** `{ tipo: 'MATERIAL'|'MAO_DE_OBRA', fis, comp, fin: 'YYYY-MM', valor, mComp, mFin }`. Flows are aggregated by every field except `valor`, which is rounded to cents.
- **Invariants:** Σ by (tipo, comp) and Σ by (tipo, fin) equal the etapa's events (±R$ 0,05). Σ by fis equals the material and MO parts of the monthly physical.
- **Material in proportional mode:** delivery dates and amounts unchanged; only the flows are added.
- **Lots:**
  - the period from start to end is split into N continuous periods, and each day's weight is split by overlap;
  - lot k arrives at `inicio + floor(k·T/N) − antecedência`;
  - lot value = material × weight of its period;
  - a lot with zero value is skipped.
- **MO:** follows `fisicoDiario`, with the day-20 cutoff on each day.
- **Economic curve:** comes from `fisicoDiario`. Without monthly points, it is uniform between start and end.
- **Saved versions:** strip `fluxos`.

## Review Focus

1. **Etapa with only `data_inicio`:** a single day; flows still close.
2. **Monthly point outside the etapa interval:** the whole month is used, as today.
3. **Lots where N exceeds the number of days:** periods with fractional weight; nothing is lost.
4. **Retention on:** the retained flow points to the release date; the competência sum is unchanged.
5. **Etapa with `custo_total` but no material/MO split:** there is a physical row with no flows; the panel shows "sem divisão material/MO".

---

### Task 1: Engine — daily physical, lots, MO and flows

**Files:** `server/curvas-financeiras-engine.js`, `server/curvas-financeiras-engine.test.js`

- [ ] **Tests:**
  - **Lots, 6 equal months, 2 lots, 10 days of lead time:** lot 2 arrives 10 days before the start of month 4; values are 50/50.
  - **Lots with the first 3 months at 70% of the physical:** the first lot carries 70%.
  - **MO with monthly points [0.7, 0.3]:** MO follows them, with the day-20 cutoff.
  - **Economic curve without points:** uniform between start and end.
  - **Flow invariants (comp, fin, fis)** for etapas that are proportional, in lots, installment-paid, and with retention.
  - **Old lot test:** updated to the new rule (Ruling).
- [ ] Run `node --test server/curvas-financeiras-engine.test.js` → FAIL.
- [ ] Implement.
- [ ] Run → PASS.
- [ ] Commit.

### Task 2: API/versions

**Files:** `server/curvas-financeiras-db.js`

- [ ] `salvarVersaoCurvas` strips `fluxos`.
- [ ] Run `npm run test:server`.
- [ ] Commit.

### Task 3: Front — Rastreio + filter for etapas with value

**Files:**
- create `src/components/curvas-financeiras/rastreio.ts`, `RastreioPlanilha.tsx` and `.css`;
- modify `PlanilhaAnalitica.tsx` and `.css`.

- [ ] **`rastreio.ts`:** `linhasDaEtapa(etapa)` gives the 5 rows per month; `tracar(etapa, linha, mes)` gives `{ links, secoes }`.
- [ ] **`RastreioPlanilha`:**
  - compact table (11px font, 16px rows, merged etapa label);
  - hover = arrow preview, click = arrows plus the panel;
  - clicking a panel row moves the trace;
  - `Esc` clears;
  - text search;
  - hides etapas with no value;
  - parent-etapa headers can be collapsed.
- [ ] **`PlanilhaAnalitica`:**
  - "Medida / Rastreio" toggle;
  - hides rows with no value, with a "mostrar etapas sem valor" button;
  - version without fluxos → notice.
- [ ] Run `npm run build`.
- [ ] Commit.

### Task 4: Verification and PR

- [ ] Run `npm run test:server` and `npm run build`.
- [ ] Quick visual check with mocked data in the Browser pane.
- [ ] Self-review.
- [ ] Push and open a PR. The PR body states that it depends on #11.
