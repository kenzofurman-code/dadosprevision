# Gestão de Contratações — Etapa 2 (painel macro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Painel 6 "Contratações" passa a mostrar, por grupo, o custo projetado e o % já solicitado, pedido, contratado e realizado, com data-limite de solicitação (início − lead time) e sinalizador; a configuração vai para as Configurações da Gestão à Vista; prazos viram lead time; checkbox minimalista no site.

**Architecture:** Mesmo padrão da etapa 1: regra pura `calcularMacro` em `server/contratacoes.js` (testada com `node --test`), consultas em `server/contratacoes-db.js`, rota `GET /api/contratacoes/macro`, componente `ContratacoesMacro.tsx`. Colunas novas via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` no `schema.sql` idempotente.

**Tech Stack:** Node 24 ESM, Express 5, pg, React 19 + TS + Vite.

**Spec:** `docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md` (seção 11 substitui trechos anteriores)

## Global Constraints

- Lead time = dias corridos da solicitação até a entrega em obra. Padrão: material = solicitação + negociação + emissão + entrega; mão de obra = entrega do QC (`prazo_entrega`) + negociação + emissão. Levantamento é informativo.
- Data-limite de solicitação = menor início das etapas do grupo no cronograma − lead time.
- Sinalizador (ordem de avaliação): SEM_PROJECAO (projetado ≤ 0) → PENDENCIA (lançado > projetado) → CONCLUIDO (realizado ≥ projetado) → PENDENCIA (lançado ≥ 95% e < 100%) → SEM_DATA (sem início) → se solicitado < projetado: ATRASADO (hoje > limite) / ATENCAO (limite − hoje ≤ 7) → NO_PRAZO.
- Valores por etapa: solicitado = Σ valor do item da solicitação (Visualização de Itens, 1 por solicitação+sequência); pedido/contratado = o mesmo valor, só dos itens com `cod_pedido`/`cod_contrato`; realizado = Σ `valor_apropriacao` da Análise Realizado por `raw_data.cod_estruturado`. Lançado da etapa = maior entre os quatro (fase mais avançada sem contar duas vezes).
- Schema `mega` só leitura. Nenhuma dependência nova. Textos em pt-BR. Sem `alert/confirm`.

## Review Focus

1. Grupo sem etapas ou com etapas sem nenhum valor: não pode dividir por zero; mostra "sem projeção".
2. Etapa com realizado maior que o solicitado (compra sem solicitação): lançado usa o maior, % realizado pode passar de 100% — mostrar o número, não esconder.
3. Obra sem par em `mega.obra_projeto`: a rota responde com mensagem clara, não 500.
4. Data de início como `Date` do pg (fuso): comparar só a parte de data (AAAA-MM-DD), sem deslocar um dia.
5. Grupo com lead time 0 ou vazio: limite = início.

---

## File Structure

| Arquivo | Mudança |
|---|---|
| `server/schema.sql` | colunas `lead_time`, `levantamento` + preenchimento inicial |
| `server/contratacoes.js` | `calcularMacro`, `subtrairDias` |
| `server/contratacoes.test.js` | testes do macro |
| `server/contratacoes-db.js` | `lead_time`/`levantamento` em `salvarGrupo`; `obterMacro` |
| `server/index.js` | rota `GET /api/contratacoes/macro` |
| `src/components/contratacoes/contratacoes-api.ts` | tipos e chamada do macro; campos novos do grupo |
| `src/components/contratacoes/ContratacoesMacro.tsx` + `.css` | painel |
| `src/components/contratacoes/ContratacoesConfig.tsx` | lead time/levantamento no lugar dos 5 prazos |
| `src/App.tsx` | Painel 6 → macro; aba "Contratações" no modal de Configurações |
| `src/index.css` (+ regras antigas de checkbox) | checkbox minimalista global |

---

### Task 1: Lead time no lugar dos prazos

**Files:** `server/schema.sql`, `server/contratacoes-db.js` (`CAMPOS_GRUPO`), `src/components/contratacoes/contratacoes-api.ts`, `src/components/contratacoes/ContratacoesConfig.tsx`

- [ ] **Step 1: Schema** — acrescentar ao fim de `server/schema.sql`:

```sql
-- Revisão 2026-09-29: lead time (solicitação → entrega em obra) e levantamento.
ALTER TABLE contratacao_grupos ADD COLUMN IF NOT EXISTS lead_time INTEGER;
ALTER TABLE contratacao_grupos ADD COLUMN IF NOT EXISTS levantamento INTEGER;
UPDATE contratacao_grupos
   SET lead_time = CASE WHEN tipo = 'MATERIAL'
                        THEN prazo_solicitacao + prazo_negociacao + prazo_emissao + prazo_entrega
                        ELSE prazo_entrega + prazo_negociacao + prazo_emissao END,
       levantamento = prazo_levantamento
 WHERE lead_time IS NULL;
```

- [ ] **Step 2: `salvarGrupo`** — em `server/contratacoes-db.js`, trocar `CAMPOS_GRUPO` por:

```js
const CAMPOS_GRUPO = ['tipo', 'item', 'insumos', 'pacote_servicos', 'ordem', 'lead_time', 'levantamento']
```

e a normalização numérica por `(c === 'ordem' || c === 'lead_time' || c === 'levantamento')`. Em `aplicarPadrao`, incluir `lead_time, levantamento` no INSERT da cópia (valores `g.lead_time`, `g.levantamento`).

- [ ] **Step 3: Front** — em `contratacoes-api.ts`, `Grupo` ganha `lead_time: number; levantamento: number` e os `prazo_*` viram opcionais. Em `ContratacoesConfig.tsx`: `PRAZOS` passa a `[{campo:'lead_time',label:'Lead time'},{campo:'levantamento',label:'Levantamento'}]`; `novoGrupo` usa `lead_time: 45, levantamento: 15`; cabeçalho "Prazos (dias)" → "Lead time (dias)" mostrando só `g.lead_time`.

- [ ] **Step 4: Verificar** — `node --check server/contratacoes-db.js && npx tsc --noEmit -p . && npm run test:server` → sem erros, 12 PASS.

- [ ] **Step 5: Commit** `feat(contratacoes): lead time e levantamento no lugar dos prazos por fase`

---

### Task 2: Regra pura do macro

**Files:** `server/contratacoes.js`, `server/contratacoes.test.js`

**Interfaces — Produces:**
- `subtrairDias(dataISO: string, dias: number): string` (AAAA-MM-DD, UTC)
- `calcularMacro({ grupos, projetado, valores, inicio, hoje })` →
  `{ grupos: LinhaMacro[], resumo }` onde
  `grupos = [{id, tipo, item, insumos, lead_time, etapas: string[]}]`,
  `projetado: Map<etapa, number>`, `valores: Map<etapa, {solicitado, pedido, contratado, realizado}>`,
  `inicio: Map<etapa, 'AAAA-MM-DD'>`, `hoje: 'AAAA-MM-DD'`;
  `LinhaMacro = {id, tipo, item, insumos, lead_time, etapas: number, projetado, solicitado, pedido, contratado, realizado, lancado, falta, pct: {solicitado, pedido, contratado, realizado, lancado} (null sem projeção), inicio, limite, dias_ate_limite, sinal}`;
  `resumo = {projetado, lancado, falta, porSinal: Record<sinal, number>}`. Linhas ordenadas por prioridade do sinal (ATRASADO, ATENCAO, PENDENCIA, NO_PRAZO, SEM_DATA, SEM_PROJECAO, CONCLUIDO) e depois limite.

- [ ] **Step 1: Testes (falhando)** — acrescentar a `server/contratacoes.test.js`:

```js
import { calcularMacro, subtrairDias } from './contratacoes.js'

test('subtrairDias trabalha só com a data', () => {
  assert.equal(subtrairDias('2026-10-10', 45), '2026-08-26')
  assert.equal(subtrairDias('2026-10-10', 0), '2026-10-10')
})

const base = (etapas, lead = 30) => ({ id: 1, tipo: 'MATERIAL', item: 'G', insumos: null, lead_time: lead, etapas })
const macro = (grupo, { proj = {}, val = {}, ini = {}, hoje = '2026-09-29' } = {}) =>
  calcularMacro({ grupos: [grupo], projetado: new Map(Object.entries(proj)),
    valores: new Map(Object.entries(val)), inicio: new Map(Object.entries(ini)), hoje }).grupos[0]
const v = (solicitado, pedido = 0, contratado = 0, realizado = 0) => ({ solicitado, pedido, contratado, realizado })

test('macro: sem projeção não divide por zero', () => {
  const g = macro(base([]))
  assert.equal(g.sinal, 'SEM_PROJECAO')
  assert.equal(g.pct.solicitado, null)
})

test('macro: percentuais e lançado pela fase mais avançada', () => {
  const g = macro(base(['a', 'b']), { proj: { a: 600, b: 400 }, val: { a: v(300, 300, 0, 100), b: v(0, 0, 0, 200) }, ini: { a: '2027-01-10' } })
  assert.deepEqual([g.projetado, g.solicitado, g.pedido, g.realizado, g.lancado, g.falta], [1000, 300, 300, 300, 500, 500])
  assert.equal(g.pct.lancado, 0.5)
  assert.equal(g.sinal, 'NO_PRAZO')
})

test('macro: atrasado quando passou do limite sem 100% solicitado', () => {
  const g = macro(base(['a'], 30), { proj: { a: 100 }, val: { a: v(50) }, ini: { a: '2026-10-20' } })
  assert.equal(g.limite, '2026-09-20')
  assert.equal(g.sinal, 'ATRASADO')
})

test('macro: atenção a 7 dias ou menos do limite', () => {
  const g = macro(base(['a'], 30), { proj: { a: 100 }, val: { a: v(50) }, ini: { a: '2026-11-04' } })
  assert.equal(g.limite, '2026-10-05')
  assert.equal(g.dias_ate_limite, 6)
  assert.equal(g.sinal, 'ATENCAO')
})

test('macro: tudo solicitado não fica atrasado mesmo após o limite', () => {
  const g = macro(base(['a'], 30), { proj: { a: 100 }, val: { a: v(100, 100) }, ini: { a: '2026-10-01' } })
  assert.equal(g.sinal, 'NO_PRAZO')
})

test('macro: pendência entre 95% e 100% e acima de 100%', () => {
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(96) }, ini: { a: '2027-01-01' } }).sinal, 'PENDENCIA')
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(130) }, ini: { a: '2027-01-01' } }).sinal, 'PENDENCIA')
})

test('macro: concluído com 100% realizado; sem data sem cronograma', () => {
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(100, 100, 0, 100) } }).sinal, 'CONCLUIDO')
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(10) } }).sinal, 'SEM_DATA')
})

test('macro: resumo soma a obra e conta sinais', () => {
  const r = calcularMacro({
    grupos: [base(['a']), { ...base(['b']), id: 2 }],
    projetado: new Map([['a', 100], ['b', 50]]), valores: new Map([['a', v(20)]]),
    inicio: new Map(), hoje: '2026-09-29',
  })
  assert.deepEqual([r.resumo.projetado, r.resumo.lancado, r.resumo.falta], [150, 20, 130])
  assert.equal(r.resumo.porSinal.SEM_DATA, 2)
})
```

- [ ] **Step 2: Rodar** `npm run test:server` → FAIL (`calcularMacro` não exportado).

- [ ] **Step 3: Implementar** — acrescentar a `server/contratacoes.js`:

```js
export function subtrairDias(dataISO, dias) {
  const d = new Date(`${String(dataISO).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (Number(dias) || 0))
  return d.toISOString().slice(0, 10)
}

const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000)
const PRIORIDADE = ['ATRASADO', 'ATENCAO', 'PENDENCIA', 'NO_PRAZO', 'SEM_DATA', 'SEM_PROJECAO', 'CONCLUIDO']

export function calcularMacro({ grupos, projetado, valores, inicio, hoje }) {
  const linhas = grupos.map((g) => {
    const soma = { projetado: 0, solicitado: 0, pedido: 0, contratado: 0, realizado: 0, lancado: 0 }
    let menorInicio = null
    for (const e of g.etapas) {
      const val = valores.get(e) || { solicitado: 0, pedido: 0, contratado: 0, realizado: 0 }
      soma.projetado += projetado.get(e) || 0
      for (const f of ['solicitado', 'pedido', 'contratado', 'realizado']) soma[f] += Number(val[f]) || 0
      soma.lancado += Math.max(Number(val.solicitado) || 0, Number(val.pedido) || 0, Number(val.contratado) || 0, Number(val.realizado) || 0)
      const ini = inicio.get(e)
      if (ini && (!menorInicio || ini < menorInicio)) menorInicio = ini
    }
    const P = soma.projetado
    const pct = P > 0
      ? Object.fromEntries(['solicitado', 'pedido', 'contratado', 'realizado', 'lancado'].map((f) => [f, soma[f] / P]))
      : { solicitado: null, pedido: null, contratado: null, realizado: null, lancado: null }
    const limite = menorInicio ? subtrairDias(menorInicio, g.lead_time) : null
    const diasAteLimite = limite ? diasEntre(hoje, limite) : null
    let sinal
    if (P <= 0) sinal = 'SEM_PROJECAO'
    else if (soma.lancado > P) sinal = 'PENDENCIA'
    else if (soma.realizado >= P) sinal = 'CONCLUIDO'
    else if (soma.lancado >= 0.95 * P && soma.lancado < P) sinal = 'PENDENCIA'
    else if (!limite) sinal = 'SEM_DATA'
    else if (soma.solicitado < P && diasAteLimite < 0) sinal = 'ATRASADO'
    else if (soma.solicitado < P && diasAteLimite <= 7) sinal = 'ATENCAO'
    else sinal = 'NO_PRAZO'
    return {
      id: g.id, tipo: g.tipo, item: g.item, insumos: g.insumos, lead_time: g.lead_time, etapas: g.etapas.length,
      ...soma, falta: Math.max(0, P - soma.lancado), pct, inicio: menorInicio, limite, dias_ate_limite: diasAteLimite, sinal,
    }
  })
  linhas.sort((a, b) => PRIORIDADE.indexOf(a.sinal) - PRIORIDADE.indexOf(b.sinal) || String(a.limite ?? '9').localeCompare(String(b.limite ?? '9')))
  const porSinal = Object.fromEntries(PRIORIDADE.map((s) => [s, 0]))
  for (const l of linhas) porSinal[l.sinal]++
  const resumo = {
    projetado: linhas.reduce((s, l) => s + l.projetado, 0),
    lancado: linhas.reduce((s, l) => s + l.lancado, 0),
    falta: linhas.reduce((s, l) => s + l.falta, 0),
    porSinal,
  }
  return { grupos: linhas, resumo }
}
```

- [ ] **Step 4: Rodar** `npm run test:server` → PASS (20 testes).

- [ ] **Step 5: Commit** `feat(contratacoes): regra do painel macro com sinalizador e testes`

---

### Task 3: Consultas e rota do macro

**Files:** `server/contratacoes-db.js`, `server/index.js`

**Interfaces — Produces:** `obterMacro(projetoId, hoje?): Promise<{ obra: string|null, importacao, grupos: LinhaMacro[], resumo } | { obra: null, motivo: string }>`; rota `GET /api/contratacoes/macro?projectId=`.

- [ ] **Step 1: Implementar em `server/contratacoes-db.js`** (import `calcularMacro` junto dos outros):

```js
async function obraDoProjeto(projetoId) {
  const { rows } = await query('SELECT obra FROM mega.obra_projeto WHERE id_prevision = $1 LIMIT 1', [projetoId])
  return rows[0]?.obra || null
}

// Valores por etapa (formato Mega) a partir do Mega. Ver regra em Global Constraints do plano.
async function valoresPorEtapa(obra) {
  const [itens, realizado] = await Promise.all([
    query(
      `WITH etapa_item AS (
         SELECT DISTINCT codigo_solicitacao, sequencial_item, codigo_etapa
         FROM mega.solicitacoes_por_etapa WHERE obra = $1 AND codigo_etapa IS NOT NULL
       ), item AS (
         SELECT solicitacao, sequencia, MAX(valor_total) AS valor,
                BOOL_OR(cod_pedido IS NOT NULL) AS tem_pedido, BOOL_OR(cod_contrato IS NOT NULL) AS tem_contrato
         FROM mega.visualizacao_itens WHERE obra = $1 GROUP BY solicitacao, sequencia
       )
       SELECT e.codigo_etapa,
              SUM(COALESCE(i.valor, 0)) AS solicitado,
              SUM(COALESCE(i.valor, 0)) FILTER (WHERE i.tem_pedido) AS pedido,
              SUM(COALESCE(i.valor, 0)) FILTER (WHERE i.tem_contrato) AS contratado
       FROM etapa_item e
       JOIN item i ON i.solicitacao::text = e.codigo_solicitacao::text AND i.sequencia::text = e.sequencial_item::text
       GROUP BY e.codigo_etapa`, [obra]),
    query(
      `SELECT raw_data->>'cod_estruturado' AS codigo_etapa, SUM(COALESCE(valor_apropriacao, 0)) AS realizado
       FROM mega.analise_realizado WHERE obra = $1 AND raw_data ? 'cod_estruturado' GROUP BY 1`, [obra]),
  ])
  const mapa = new Map()
  const pega = (c) => mapa.get(c) || mapa.set(c, { solicitado: 0, pedido: 0, contratado: 0, realizado: 0 }).get(c)
  for (const r of itens.rows) {
    const c = etapaParaMega(r.codigo_etapa); if (!c) continue
    const v = pega(c)
    v.solicitado += Number(r.solicitado) || 0; v.pedido += Number(r.pedido) || 0; v.contratado += Number(r.contratado) || 0
  }
  for (const r of realizado.rows) {
    const c = etapaParaMega(r.codigo_etapa); if (!c) continue
    pega(c).realizado += Number(r.realizado) || 0
  }
  return mapa
}

// Menor início no cronograma por etapa, via orçamento (pesos_orcamento.id_atividade).
async function inicioPorEtapa(projetoId) {
  const { rows } = await query(
    `SELECT p.codigo, TO_CHAR(MIN(a.data_inicio), 'YYYY-MM-DD') AS inicio
     FROM pesos_orcamento p JOIN atividades a ON a.projeto_id = p.projeto_id AND a.id_prevision = p.id_atividade
     WHERE p.projeto_id = $1 AND a.data_inicio IS NOT NULL GROUP BY p.codigo`, [projetoId])
  const mapa = new Map()
  for (const r of rows) {
    const c = etapaParaMega(r.codigo)
    if (c && (!mapa.has(c) || r.inicio < mapa.get(c))) mapa.set(c, r.inicio)
  }
  return mapa
}

export async function obterMacro(projetoId, hoje = new Date().toISOString().slice(0, 10)) {
  const obra = await obraDoProjeto(projetoId)
  if (!obra) return { obra: null, motivo: 'Este projeto não tem obra do Mega vinculada.' }
  const importacao = await ultimaImportacao(projetoId)
  const [projetado, valores, inicio, gruposRes, etapasRes] = await Promise.all([
    custosDaImportacao(importacao?.id),
    valoresPorEtapa(obra),
    inicioPorEtapa(projetoId),
    query('SELECT id, tipo, item, insumos, lead_time FROM contratacao_grupos WHERE projeto_id = $1 ORDER BY ordem, id', [projetoId]),
    query('SELECT grupo_id, codigo_etapa FROM contratacao_grupo_etapas WHERE projeto_id = $1', [projetoId]),
  ])
  const etapasDo = new Map()
  for (const e of etapasRes.rows) (etapasDo.get(e.grupo_id) || etapasDo.set(e.grupo_id, []).get(e.grupo_id)).push(e.codigo_etapa)
  const grupos = gruposRes.rows.map((g) => ({ ...g, lead_time: Number(g.lead_time) || 0, etapas: etapasDo.get(g.id) || [] }))
  return { obra, importacao, ...calcularMacro({ grupos, projetado, valores, inicio, hoje }) }
}
```

- [ ] **Step 2: Rota** em `server/index.js` (junto das outras de contratações; importar `obterMacro`):

```js
app.get('/api/contratacoes/macro', rota((req) => obterMacro(exigirProjeto(req.query.projectId))))
```

- [ ] **Step 3: Verificar** `node --check server/contratacoes-db.js && node --check server/index.js && npm run test:server` → ok.

- [ ] **Step 4: Validar com dados reais (somente leitura)** — no container do `app` na VPS, com cópia temporária de `server/` num diretório à parte, chamar `obterMacro('40661')` e conferir: responde sem erro, grupos = os aplicados no POTY, `valores` com etapas preenchidas (solicitado > 0 em várias), início preenchido em parte, sinais SEM_PROJECAO (custo ainda não importado). Remover os arquivos temporários.

- [ ] **Step 5: Commit** `feat(contratacoes): consultas e rota do painel macro`

---

### Task 4: Painel macro e configuração nas Configurações

**Files:** `contratacoes-api.ts`, `ContratacoesMacro.tsx` (novo), `ContratacoesMacro.css` (novo), `src/App.tsx`

- [ ] **Step 1: Cliente** — em `contratacoes-api.ts`:

```ts
export type Sinal = 'ATRASADO' | 'ATENCAO' | 'PENDENCIA' | 'NO_PRAZO' | 'SEM_DATA' | 'SEM_PROJECAO' | 'CONCLUIDO'
type Pct = { solicitado: number | null; pedido: number | null; contratado: number | null; realizado: number | null; lancado: number | null }
export interface LinhaMacro { id: number; tipo: Tipo; item: string; insumos: string | null; lead_time: number; etapas: number; projetado: number; solicitado: number; pedido: number; contratado: number; realizado: number; lancado: number; falta: number; pct: Pct; inicio: string | null; limite: string | null; dias_ate_limite: number | null; sinal: Sinal }
export interface Macro { obra: string | null; motivo?: string; importacao: Config['importacao']; grupos: LinhaMacro[]; resumo: { projetado: number; lancado: number; falta: number; porSinal: Record<Sinal, number> } }
// em api:
macro: (projectId: string) => chamar<Macro>(`/api/contratacoes/macro?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
```

- [ ] **Step 2: Componente `ContratacoesMacro.tsx`** — props `{ projectId, onConfigurar }`. Estados: carregando / erro / `macro.obra === null` (mostra `motivo`) / sem grupos ("Configure os grupos em Configurações → Contratações" + botão `onConfigurar`) / sem importação (aviso "Importe o custo projetado em Configurações → Contratações para ver os percentuais", mas ainda lista os grupos com lançado). Topo: projetado, lançado, falta e uma ficha por sinal (clicável para filtrar). Duas tabelas (Material, Mão de obra) com colunas: Grupo (item · insumos), Projetado, Solicitado %, Pedido %, Contratado %, Realizado %, Falta lançar, Início, Limite solicitação (com "em N dias"/"há N dias"), Situação (etiqueta do sinal). Percentual `null` → "—"; mostra valores > 100% como estão. Rótulos dos sinais: ATRASADO "Atrasado", ATENCAO "Atenção", PENDENCIA "Rever projeção/dados", NO_PRAZO "No prazo", SEM_DATA "Sem data no cronograma", SEM_PROJECAO "Sem custo projetado", CONCLUIDO "Concluído". Cores semânticas discretas (vermelho, âmbar, laranja, verde, cinza) só na etiqueta.

```tsx
import { useEffect, useMemo, useState } from 'react'
import { api, type Macro, type Sinal, type Tipo } from './contratacoes-api'
import './ContratacoesMacro.css'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const pctFmt = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const dataFmt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')
const SINAIS: Record<Sinal, string> = { ATRASADO: 'Atrasado', ATENCAO: 'Atenção', PENDENCIA: 'Rever projeção/dados', NO_PRAZO: 'No prazo', SEM_DATA: 'Sem data no cronograma', SEM_PROJECAO: 'Sem custo projetado', CONCLUIDO: 'Concluído' }
const TIPOS: Record<Tipo, string> = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de obra' }

export function ContratacoesMacro({ projectId, onConfigurar }: { projectId: string; onConfigurar: () => void }) {
  const [macro, setMacro] = useState<Macro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Sinal | null>(null)
  useEffect(() => {
    let vivo = true
    setMacro(null); setErro(null)
    api.macro(projectId).then((m) => vivo && setMacro(m)).catch((e) => vivo && setErro((e as Error).message))
    return () => { vivo = false }
  }, [projectId])
  const linhas = useMemo(() => (macro?.grupos || []).filter((g) => !filtro || g.sinal === filtro), [macro, filtro])

  if (erro) return <div className="cm-card"><p className="cm-erro">{erro}</p></div>
  if (!macro) return <div className="cm-card"><p className="cm-muted">Carregando contratações…</p></div>
  if (!macro.obra) return <div className="cm-card"><p>{macro.motivo}</p></div>
  if (!macro.grupos.length) return (
    <div className="cm-card"><p>Nenhum grupo de contratação configurado para esta obra.</p>
      <button type="button" className="cm-btn" onClick={onConfigurar}>Abrir configuração</button></div>
  )
  const limiteTexto = (d: number | null) => (d === null ? '' : d < 0 ? `há ${-d} dias` : d === 0 ? 'hoje' : `em ${d} dias`)
  return (
    <div className="cm-card">
      {!macro.importacao && (
        <p className="cm-aviso">Importe o custo projetado em Configurações → Contratações para ver os percentuais.
          <button type="button" className="cm-btn cm-link" onClick={onConfigurar}>Abrir configuração</button></p>
      )}
      <div className="cm-resumo">
        <div><span>Projetado</span><strong>{moeda.format(macro.resumo.projetado)}</strong></div>
        <div><span>Lançado</span><strong>{moeda.format(macro.resumo.lancado)}</strong></div>
        <div><span>Falta lançar</span><strong>{moeda.format(macro.resumo.falta)}</strong></div>
        <div className="cm-fichas">
          {(Object.keys(SINAIS) as Sinal[]).filter((s) => macro.resumo.porSinal[s]).map((s) => (
            <button type="button" key={s} className={`cm-sinal cm-${s} ${filtro === s ? 'ativo' : ''}`} aria-pressed={filtro === s}
              onClick={() => setFiltro(filtro === s ? null : s)}>{SINAIS[s]} · {macro.resumo.porSinal[s]}</button>
          ))}
        </div>
      </div>
      {(['MATERIAL', 'MAO_DE_OBRA'] as Tipo[]).map((tipo) => {
        const doTipo = linhas.filter((g) => g.tipo === tipo)
        if (!doTipo.length) return null
        return (
          <div key={tipo} className="cm-bloco">
            <h4>{TIPOS[tipo]}</h4>
            <div className="cm-rolagem">
              <table className="cm-tabela">
                <thead><tr><th>Grupo</th><th className="cm-num">Projetado</th><th className="cm-num">Solicitado</th><th className="cm-num">Pedido</th><th className="cm-num">Contratado</th><th className="cm-num">Realizado</th><th className="cm-num">Falta lançar</th><th>Início</th><th>Limite solicitação</th><th>Situação</th></tr></thead>
                <tbody>
                  {doTipo.map((g) => (
                    <tr key={g.id}>
                      <td>{g.item}{g.insumos ? <span className="cm-muted"> · {g.insumos}</span> : null}</td>
                      <td className="cm-num">{g.projetado ? moeda.format(g.projetado) : '—'}</td>
                      <td className="cm-num">{pctFmt(g.pct.solicitado)}</td>
                      <td className="cm-num">{pctFmt(g.pct.pedido)}</td>
                      <td className="cm-num">{pctFmt(g.pct.contratado)}</td>
                      <td className="cm-num">{pctFmt(g.pct.realizado)}</td>
                      <td className="cm-num">{g.projetado ? moeda.format(g.falta) : '—'}</td>
                      <td>{dataFmt(g.inicio)}</td>
                      <td>{dataFmt(g.limite)} <span className="cm-muted">{limiteTexto(g.dias_ate_limite)}</span></td>
                      <td><span className={`cm-sinal cm-${g.sinal}`}>{SINAIS[g.sinal]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

`ContratacoesMacro.css`:

```css
.cm-card { background: var(--surface, #fff); border: 1px solid var(--border, #dde3e6); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.cm-resumo { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-end; }
.cm-resumo > div:not(.cm-fichas) { display: flex; flex-direction: column; }
.cm-resumo span { font-size: 12px; opacity: .65; }
.cm-resumo strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.cm-fichas { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.cm-bloco h4 { margin: 4px 0 6px; }
.cm-rolagem { overflow-x: auto; }
.cm-tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
.cm-tabela th, .cm-tabela td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border, #dde3e6); white-space: nowrap; }
.cm-tabela td:first-child { white-space: normal; min-width: 220px; }
.cm-tabela th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
.cm-num { text-align: right !important; font-variant-numeric: tabular-nums; }
.cm-muted { opacity: .6; }
.cm-erro { color: #b3261e; }
.cm-aviso { margin: 0; padding: 8px 12px; border-radius: 6px; background: rgba(160, 98, 10, .08); }
.cm-btn { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border, #dde3e6); background: transparent; color: inherit; cursor: pointer; }
.cm-link { border: none; text-decoration: underline; }
.cm-sinal { display: inline-block; font: inherit; font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid transparent; background: rgba(0,0,0,.05); color: inherit; }
button.cm-sinal { cursor: pointer; }
.cm-sinal.ativo { border-color: currentColor; }
.cm-ATRASADO { background: rgba(179, 38, 30, .1); color: #b3261e; }
.cm-ATENCAO { background: rgba(160, 98, 10, .12); color: #8a5300; }
.cm-PENDENCIA { background: rgba(196, 90, 20, .1); color: #b3561a; }
.cm-NO_PRAZO { background: rgba(47, 122, 74, .1); color: #2f7a4a; }
.cm-CONCLUIDO { background: rgba(47, 122, 74, .18); color: #245f3a; }
```

- [ ] **Step 3: `App.tsx`**
  1. Import `ContratacoesMacro`.
  2. Painel 6: trocar `<ContratacoesConfig projectId={selectedProject} />` por `<ContratacoesMacro projectId={selectedProject} onConfigurar={() => { setSettingsClassificationTab('contratacoes'); handleOpenGroupOrderModal() }} />`.
  3. Modal "Configurações da Gestão à Vista": acrescentar aba `contratacoes` ("Contratações") ao lado das abas de classificação (mesmo padrão de botão com `settingsClassificationTab`), ampliar o tipo do estado para aceitar `'contratacoes'`, e renderizar `selectedProject ? <ContratacoesConfig projectId={selectedProject} /> : <p>Selecione um projeto.</p>` quando ativa. Verificar se `handleOpenGroupOrderModal` redefine a aba; se redefinir, chamar `setSettingsClassificationTab('contratacoes')` depois dele.
  4. Ajustar o subtítulo do modal quando a aba for contratações: "Grupos de contratação e custo projetado".

- [ ] **Step 4: Verificar** `npx tsc --noEmit -p . && npm run build && npm run test:server` → ok.

- [ ] **Step 5: Commit** `feat(contratacoes): painel macro no Painel 6 e configuracao nas Configuracoes da Gestao a Vista`

---

### Task 5: Checkbox minimalista no site

**Files:** `src/index.css`, `src/App.css`, `src/MegaView.css`, `src/CurvasView.css`

- [ ] **Step 1:** Acrescentar ao fim de `src/index.css`:

```css
/* Checkbox padrão do site: pequeno, neutro, sem cor forte. */
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  margin: 0;
  flex: none;
  border: 1px solid rgba(100, 116, 139, .55);
  border-radius: 3px;
  background: transparent;
  display: inline-grid;
  place-content: center;
  cursor: pointer;
  vertical-align: middle;
  transition: border-color .12s, background-color .12s;
}
input[type='checkbox']::after {
  content: '';
  width: 8px;
  height: 8px;
  clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
  background: currentColor;
  transform: scale(0);
  transition: transform .12s;
}
input[type='checkbox']:checked { border-color: #334155; background: #334155; color: #fff; }
input[type='checkbox']:checked::after { transform: scale(1); }
input[type='checkbox']:focus-visible { outline: 2px solid #64748b; outline-offset: 1px; }
input[type='checkbox']:disabled { opacity: .45; cursor: default; }
```

- [ ] **Step 2:** Remover das regras existentes de checkbox as propriedades que brigam com o padrão (`accent-color`, `width`, `height`, `transform: scale`) em `src/App.css:175, 1550-1555, 2013-2019, 2643`, `src/MegaView.css:841-843, 1049`, `src/CurvasView.css:809`. Conferir com `grep -n "accent-color\|type='checkbox'\|type=\"checkbox\"" src/*.css` que não sobrou regra de tamanho/cor. Manter margens de layout.

- [ ] **Step 3: Verificar** `npm run build` → ok. Checagem visual fica para a conferência no site com o usuário.

- [ ] **Step 4: Commit** `style: checkbox minimalista padrao no site`

---

### Task 6: Publicação

- [ ] `npm run test:server && npx tsc --noEmit -p . && npm run build` → ok.
- [ ] Revisão final do branch; juntar ao `main` e push **somente com confirmação do usuário**; pedir Redeploy do `app`.
- [ ] Conferência com o usuário no POTY: Painel 6 mostra grupos com "Sem custo projetado" até a importação; após importar a planilha, percentuais e sinais; configuração acessível em Configurações → Contratações; checkbox novo em telas antigas (filtros do Painel, Mega colunas, Curvas).
