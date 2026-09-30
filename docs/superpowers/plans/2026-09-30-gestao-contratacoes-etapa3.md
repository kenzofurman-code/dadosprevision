# Gestão de Contratações — Etapa 3 (micro + trilha Approvo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao abrir uma linha do painel macro de Contratações, mostrar os itens das solicitações do Mega daquele grupo, com a etapa de orçamento e a trilha de aprovação do Approvo (quantas aprovações cada passo exige × quantas teve, quem aprovou, com quem está parado); e criar a aba Approvo em Dados Mega.

**Architecture:** Regra pura em `server/contratacoes.js` (`calcularTrilha`) testada com `node --test`; consultas em `server/contratacoes-db.js` (`obterMicro`, `obterRegras`, `salvarRegras`) lendo o schema `mega` (somente leitura) e uma tabela nova `contratacao_aprovacao_regras` no schema `public`; UI React expande a linha do macro (`ContratacoesMicro.tsx`) e ganha um bloco "Aprovações" na configuração. A aba Approvo reusa o mecanismo genérico de tabelas do Dados Mega (`server/db.js` + `mega-columns.ts` + `MegaView.tsx`).

**Tech Stack:** Node 20 + Express 5 + pg; React 19 + TS + Vite; `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md` (seções 11 e 12).

## Global Constraints

- Schema `mega` é somente leitura para o `app`; tabela nova vai no `public` via `server/schema.sql` idempotente (`CREATE TABLE IF NOT EXISTS`).
- Regra sem nomes de aprovadores: conta **aprovadores distintos** por passo; nomes só na tela.
- Reprovação zera o passo: contam só aprovações depois da última reprovação.
- Padrões: Solicitação 2; Estouro 1 só se valor do estouro > R$ 100.000; Mapa 1; Pedido/Contrato 1 até R$ 50.000 e 2 acima; Aditivo 2; Medição 3. Ajustáveis por obra.
- Valor da Solicitação no Approvo não é usado (é genérico). Valor do Estouro não é valor do item.
- Vínculos: `visualizacao_itens.solicitacao/cod_cotacao/cod_pedido/cod_contrato`; Estouro usa o nº do mapa; Medição liga via `mega.medicoes_contratos (numero_contrato → numero_medicao)`.
- Textos da UI em português; checkbox/estilo minimalista já global.
- Testes: `npm run test:server`.

## Review Focus

1. Item sem cotação/pedido ainda (só solicitação) → trilha mostra passos seguintes como "Não iniciado", sem erro.
2. Mesmo aprovador aprovando duas vezes (reenvio) → conta 1.
3. Reprovação seguida de reaprovação → só as aprovações depois da reprovação contam; último evento reprovação → "Reprovado".
4. Estouro abaixo de R$ 100 mil → passo "Dispensado" (não bloqueia), mesmo se houver aprovações.
5. Contrato sem documento no Approvo (ex.: POTY 3136) → "Não iniciado" com aviso "sem registro no Approvo", não "Aprovado".

---

### Task 1: Regra pura da trilha

**Files:**
- Modify: `server/contratacoes.js` (adicionar ao fim)
- Test: `server/contratacoes.test.js` (adicionar ao fim)

**Interfaces:**
- Produces:
  - `REGRAS_PADRAO = { solicitacao: 2, estouro: 1, estouro_minimo: 100000, mapa: 1, compra_ate: 1, compra_acima: 2, alcada_valor: 50000, aditivo: 2, medicao: 3 }`
  - `avaliarPasso({ passo, numero, doc, eventos, exigidas })` → `{ passo, numero, status: 'NAO_INICIADO'|'PENDENTE'|'APROVADO'|'REPROVADO'|'DISPENSADO', exigidas, feitas, aprovadores: string[], ultimo: string|null, valor: number|null }`
  - `calcularTrilha({ item, docs, eventos, medicoes, regras })` → `{ passos: Passo[], parado_em: Passo|null }`
    - `item = { solicitacao, cotacao, pedido, contrato }` (números ou null)
    - `docs: Map<'TIPO|numero', { valor, data_envio }>`; `eventos: Map<'TIPO|numero', { acao, aprovador, data_hora }[]>` ordenados por data
    - `medicoes: number[]` (nºs de medição do contrato)
    - TIPO ∈ `SOLICITACAO, ESTOURO, MAPA, PEDIDO, CONTRATO, ADITIVO, MEDICAO`

- [ ] **Step 1: Write the failing tests**

```js
import { avaliarPasso, calcularTrilha, REGRAS_PADRAO } from './contratacoes.js'

const ev = (acao, aprovador, data_hora) => ({ acao, aprovador, data_hora })

test('avaliarPasso conta aprovadores distintos e respeita reprovação', () => {
  const eventos = [
    ev('Aprovação', 'Valerio Kogima', '2026-01-05T10:00'),
    ev('Aprovação', 'valerio kogima ', '2026-01-06T10:00'),
    ev('Reprovação', 'Natalia Barbosa', '2026-01-07T10:00'),
    ev('Aprovação', 'Natalia Barbosa', '2026-01-08T10:00'),
  ]
  const p = avaliarPasso({ passo: 'MAPA', numero: 548, doc: { valor: 1740 }, eventos, exigidas: 2 })
  assert.equal(p.feitas, 1)
  assert.equal(p.status, 'PENDENTE')
  assert.deepEqual(p.aprovadores, ['Natalia Barbosa'])
  assert.equal(p.ultimo, '2026-01-08T10:00')
})

test('avaliarPasso: último evento reprovação vira REPROVADO; sem doc e sem eventos vira NAO_INICIADO', () => {
  const r = avaliarPasso({ passo: 'MAPA', numero: 1, doc: { valor: 1 }, eventos: [ev('Aprovação', 'A', '1'), ev('Reprovação', 'B', '2')], exigidas: 1 })
  assert.equal(r.status, 'REPROVADO')
  const n = avaliarPasso({ passo: 'CONTRATO', numero: 3136, doc: null, eventos: [], exigidas: 1 })
  assert.equal(n.status, 'NAO_INICIADO')
  const d = avaliarPasso({ passo: 'ESTOURO', numero: 9, doc: { valor: 50 }, eventos: [ev('Aprovação', 'A', '1')], exigidas: 0 })
  assert.equal(d.status, 'DISPENSADO')
})

test('calcularTrilha monta a cadeia com estouro, alçada e medições', () => {
  const docs = new Map([
    ['SOLICITACAO|16778', { valor: 180 }],
    ['ESTOURO|582', { valor: 1530262.91 }],
    ['MAPA|582', { valor: 55433.7 }],
    ['CONTRATO|3109', { valor: 55433.7 }],
    ['MEDICAO|23650', { valor: 3250 }],
  ])
  const eventos = new Map([
    ['SOLICITACAO|16778', [ev('Aprovação', 'Eduardo', '1'), ev('Aprovação', 'Emerson', '2')]],
    ['ESTOURO|582', [ev('Aprovação', 'Emerson', '3')]],
    ['MAPA|582', [ev('Aprovação', 'Natalia', '4')]],
    ['CONTRATO|3109', [ev('Aprovação', 'Bronqueti', '5')]],
  ])
  const t = calcularTrilha({ item: { solicitacao: 16778, cotacao: 582, pedido: null, contrato: 3109 }, docs, eventos, medicoes: [23650], regras: REGRAS_PADRAO })
  assert.deepEqual(t.passos.map((p) => [p.passo, p.status, p.exigidas]), [
    ['SOLICITACAO', 'APROVADO', 2],
    ['ESTOURO', 'APROVADO', 1],
    ['MAPA', 'APROVADO', 1],
    ['CONTRATO', 'PENDENTE', 2],
    ['MEDICAO', 'PENDENTE', 3],
  ])
  assert.equal(t.parado_em.passo, 'CONTRATO')
})

test('calcularTrilha: estouro pequeno dispensado, pedido até a alçada, passos futuros não iniciados', () => {
  const docs = new Map([['SOLICITACAO|1', { valor: 1 }], ['ESTOURO|2', { valor: 9542 }], ['MAPA|2', { valor: 196 }]])
  const eventos = new Map([['SOLICITACAO|1', [ev('Aprovação', 'A', '1'), ev('Aprovação', 'B', '2')]], ['MAPA|2', [ev('Aprovação', 'N', '3')]]])
  const t = calcularTrilha({ item: { solicitacao: 1, cotacao: 2, pedido: 3, contrato: null }, docs, eventos, medicoes: [], regras: REGRAS_PADRAO })
  assert.deepEqual(t.passos.map((p) => [p.passo, p.status]), [
    ['SOLICITACAO', 'APROVADO'], ['ESTOURO', 'DISPENSADO'], ['MAPA', 'APROVADO'], ['PEDIDO', 'NAO_INICIADO'],
  ])
  assert.equal(t.passos[3].exigidas, 1)
  assert.equal(t.parado_em.passo, 'PEDIDO')
  const s = calcularTrilha({ item: { solicitacao: 1, cotacao: null, pedido: null, contrato: null }, docs, eventos, medicoes: [], regras: REGRAS_PADRAO })
  assert.deepEqual(s.passos.map((p) => [p.passo, p.status]), [['SOLICITACAO', 'APROVADO'], ['MAPA', 'NAO_INICIADO'], ['COMPRA', 'NAO_INICIADO']])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:server`
Expected: FAIL — `avaliarPasso` não exportado.

- [ ] **Step 3: Implement**

```js
// Trilha de aprovação do Approvo (spec seção 12). A regra guarda só quantas
// aprovações cada passo exige; nomes aparecem só na tela.
export const REGRAS_PADRAO = { solicitacao: 2, estouro: 1, estouro_minimo: 100000, mapa: 1, compra_ate: 1, compra_acima: 2, alcada_valor: 50000, aditivo: 2, medicao: 3 }

export function avaliarPasso({ passo, numero, doc, eventos = [], exigidas }) {
  const iReprov = eventos.map((e) => e.acao).lastIndexOf('Reprovação')
  const validos = eventos.slice(iReprov + 1).filter((e) => e.acao === 'Aprovação')
  const nomes = new Map()
  for (const e of validos) nomes.set(normalizarNome(e.aprovador), e.aprovador.trim())
  const feitas = nomes.size
  const ultimo = eventos.length ? eventos[eventos.length - 1].data_hora : null
  let status
  if (!doc && !eventos.length) status = 'NAO_INICIADO'
  else if (iReprov === eventos.length - 1 && iReprov >= 0) status = 'REPROVADO'
  else if (exigidas === 0) status = 'DISPENSADO'
  else status = feitas >= exigidas ? 'APROVADO' : 'PENDENTE'
  return { passo, numero, status, exigidas, feitas, aprovadores: [...nomes.values()], ultimo, valor: doc?.valor ?? null }
}

export function calcularTrilha({ item, docs, eventos, medicoes, regras }) {
  const passo = (p, numero, exigidas) => avaliarPasso({ passo: p, numero, doc: docs.get(`${p}|${numero}`) || null, eventos: eventos.get(`${p}|${numero}`) || [], exigidas })
  const valorDe = (p, n) => Number(docs.get(`${p}|${n}`)?.valor) || 0
  const passos = [passo('SOLICITACAO', item.solicitacao, regras.solicitacao)]
  const c = item.cotacao
  if (c && (docs.has(`ESTOURO|${c}`) || eventos.has(`ESTOURO|${c}`))) {
    passos.push(passo('ESTOURO', c, valorDe('ESTOURO', c) > regras.estouro_minimo ? regras.estouro : 0))
  }
  passos.push(c ? passo('MAPA', c, regras.mapa) : { ...avaliarPasso({ passo: 'MAPA', numero: null, doc: null, eventos: [], exigidas: regras.mapa }) })
  const alcada = (p, n) => (valorDe(p, n) > regras.alcada_valor ? regras.compra_acima : regras.compra_ate)
  if (item.contrato) {
    passos.push(passo('CONTRATO', item.contrato, alcada('CONTRATO', item.contrato)))
    if (docs.has(`ADITIVO|${item.contrato}`) || eventos.has(`ADITIVO|${item.contrato}`)) passos.push(passo('ADITIVO', item.contrato, regras.aditivo))
    for (const m of medicoes) passos.push(passo('MEDICAO', m, regras.medicao))
  } else if (item.pedido) {
    passos.push(passo('PEDIDO', item.pedido, alcada('PEDIDO', item.pedido)))
  } else {
    passos.push(avaliarPasso({ passo: 'COMPRA', numero: null, doc: null, eventos: [], exigidas: regras.compra_ate }))
  }
  const parado_em = passos.find((p) => p.status === 'PENDENTE' || p.status === 'REPROVADO' || p.status === 'NAO_INICIADO') || null
  return { passos, parado_em }
}
```

Nota: no teste da medição o doc existe sem eventos → `PENDENTE` (0 de 3); o contrato de R$ 55 mil exige 2 (acima da alçada) e teve 1 → `PENDENTE`.

- [ ] **Step 4: Run tests** — `npm run test:server` → PASS (26 testes).
- [ ] **Step 5: Commit** — `git commit -am "feat(contratacoes): regra da trilha de aprovacao"`

---

### Task 2: Regras por obra (tabela, API, bloco na configuração)

**Files:**
- Modify: `server/schema.sql` (fim), `server/contratacoes-db.js`, `server/index.js` (junto das rotas `/api/contratacoes/*`), `src/components/contratacoes/contratacoes-api.ts`, `src/components/contratacoes/ContratacoesConfig.tsx`

**Interfaces:**
- Consumes: `REGRAS_PADRAO`
- Produces: `obterRegras(projetoId) → Regras`, `salvarRegras(projetoId, regras) → Regras`; rotas `GET/PUT /api/contratacoes/regras?projectId=`; TS `interface Regras { solicitacao: number; estouro: number; estouro_minimo: number; mapa: number; compra_ate: number; compra_acima: number; alcada_valor: number; aditivo: number; medicao: number }`, `api.regras(projectId)`, `api.salvarRegras(projectId, regras)`

- [ ] **Step 1: Schema**

```sql
-- Quantas aprovações cada passo do Approvo exige, por obra (spec seção 12).
CREATE TABLE IF NOT EXISTS contratacao_aprovacao_regras (
  projeto_id TEXT PRIMARY KEY,
  regras JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: DB**

```js
const CAMPOS_REGRA = Object.keys(REGRAS_PADRAO)

export async function obterRegras(projetoId) {
  const { rows } = await query('SELECT regras FROM contratacao_aprovacao_regras WHERE projeto_id = $1', [projetoId])
  return { ...REGRAS_PADRAO, ...(rows[0]?.regras || {}) }
}

export async function salvarRegras(projetoId, regras) {
  const limpo = {}
  for (const c of CAMPOS_REGRA) {
    const n = Number(regras?.[c])
    if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`Valor inválido em ${c}`), { status: 400 })
    limpo[c] = n
  }
  await query(
    `INSERT INTO contratacao_aprovacao_regras (projeto_id, regras) VALUES ($1, $2)
     ON CONFLICT (projeto_id) DO UPDATE SET regras = EXCLUDED.regras, atualizado_em = NOW()`, [projetoId, limpo])
  return limpo
}
```

Conferir como `rota()` em `server/index.js` trata `err.status` (usar o mesmo padrão já usado para erros 400 nas rotas de contratações; se usar outro campo, seguir o existente).

- [ ] **Step 3: Rotas**

```js
app.get('/api/contratacoes/regras', rota((req) => obterRegras(exigirProjeto(req.query.projectId))))
app.put('/api/contratacoes/regras', rota((req) => salvarRegras(exigirProjeto(req.body?.projectId), req.body?.regras)))
```

- [ ] **Step 4: UI** — em `contratacoes-api.ts` adicionar `Regras` e:

```ts
regras: (projectId: string) => chamar<Regras>(`/api/contratacoes/regras?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
salvarRegras: (projectId: string, regras: Regras) => chamar<Regras>('/api/contratacoes/regras', { method: 'PUT', body: JSON.stringify({ projectId, regras }) }).then((r) => r.data),
```

Em `ContratacoesConfig.tsx`, um bloco "Aprovações exigidas (Approvo)" acima dos grupos: 9 `<input type="number" min=0>` com rótulos — Solicitação; Estouro (acima de R$ [estouro_minimo]); Mapa de cotação; Pedido/Contrato até R$ [alcada_valor]; Pedido/Contrato acima; Aditivo; Medição — e botão "Salvar aprovações". Carrega com `api.regras` junto do `config`; erro de salvar mostra mensagem sem limpar o formulário.

- [ ] **Step 5: Verificar** — `npm run test:server` PASS; `npx tsc --noEmit -p .` sem erros; `npm run build` OK.
- [ ] **Step 6: Commit** — `feat(contratacoes): quantidade de aprovacoes por obra`

---

### Task 3: Consulta do micro

**Files:**
- Modify: `server/contratacoes-db.js`, `server/index.js`

**Interfaces:**
- Consumes: `calcularTrilha`, `obterRegras`, `obraDoProjeto`, `etapaParaMega`
- Produces: `obterMicro(projetoId, grupoId)` → `{ obra, itens: ItemMicro[] }`, com
  `ItemMicro = { solicitacao, sequencia, descricao, fornecedor, valor, etapas: { codigo, nome }[], cotacao, pedido, contrato, passos: Passo[], parado_em: Passo|null, dias_parado: number|null }`; rota `GET /api/contratacoes/micro?projectId=&grupoId=`

- [ ] **Step 1: Implement**

```js
const TIPO_APPROVO = {
  'Solicitação de Obra': 'SOLICITACAO', 'Estouro de Orçamento': 'ESTOURO', 'Mapa de Cotação': 'MAPA',
  'Pedido de Compra': 'PEDIDO', 'Contrato de Cotação e Materiais': 'CONTRATO', 'Contrato Livre': 'CONTRATO',
  'Aditivo de Contrato de Cotação e Materiais': 'ADITIVO', 'Medição de Contrato': 'MEDICAO',
}

export async function obterMicro(projetoId, grupoId, hoje = hojeNoBrasil()) {
  const obra = await obraDoProjeto(projetoId)
  if (!obra) return { obra: null, itens: [] }
  const etapasRes = await query(
    `SELECT codigo_etapa, COALESCE(nome_obra, nome_padrao) AS nome FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND grupo_id = $2`,
    [projetoId, grupoId])
  const nomeEtapa = new Map(etapasRes.rows.map((e) => [e.codigo_etapa, e.nome]))
  if (!nomeEtapa.size) return { obra, itens: [] }
  const [itensRes, docsRes, evRes, medRes, regras] = await Promise.all([
    query(
      `SELECT v.solicitacao, v.sequencia, MAX(v.descricao) AS descricao, MAX(v.fornecedor) AS fornecedor, MAX(v.valor_total) AS valor,
              MAX(v.cod_cotacao)::bigint AS cotacao, MAX(v.cod_pedido)::bigint AS pedido, MAX(v.cod_contrato)::bigint AS contrato,
              ARRAY_AGG(DISTINCT s.codigo_etapa) AS etapas
       FROM mega.visualizacao_itens v
       JOIN mega.solicitacoes_por_etapa s ON s.obra = v.obra AND s.codigo_solicitacao::text = v.solicitacao::text AND s.sequencial_item::text = v.sequencia::text
       WHERE v.obra = $1 AND s.codigo_etapa IS NOT NULL
       GROUP BY v.solicitacao, v.sequencia`, [obra]),
    query(`SELECT tipo_documento, numero, valor, data_envio_aprovacao FROM mega.approvo_documentos WHERE obra = $1`, [obra]),
    query(
      `SELECT tipo_documento, numero_documento, acao, aprovador, COALESCE(data_hora, data_aprovacao::timestamp) AS data_hora
       FROM mega.approvo_ocorrencias WHERE obra = $1 ORDER BY 5, id`, [obra]),
    query(`SELECT DISTINCT numero_contrato, numero_medicao FROM mega.medicoes_contratos WHERE obra = $1 ORDER BY 2`, [obra]),
    obterRegras(projetoId),
  ])
  const docs = new Map()
  for (const d of docsRes.rows) {
    const t = TIPO_APPROVO[d.tipo_documento]
    if (t) docs.set(`${t}|${d.numero}`, { valor: Number(d.valor), data_envio: d.data_envio_aprovacao })
  }
  const eventos = new Map()
  for (const e of evRes.rows) {
    const t = TIPO_APPROVO[e.tipo_documento]
    if (!t) continue
    const k = `${t}|${e.numero_documento}`
    if (!eventos.has(k)) eventos.set(k, [])
    eventos.get(k).push({ acao: e.acao, aprovador: e.aprovador, data_hora: e.data_hora?.toISOString?.() ?? e.data_hora })
  }
  const medicoesDo = new Map()
  for (const m of medRes.rows) {
    const k = String(m.numero_contrato)
    if (!medicoesDo.has(k)) medicoesDo.set(k, [])
    medicoesDo.get(k).push(Number(m.numero_medicao))
  }
  const itens = []
  for (const r of itensRes.rows) {
    const etapas = [...new Set(r.etapas.map(etapaParaMega))].filter((c) => nomeEtapa.has(c))
    if (!etapas.length) continue
    const item = { solicitacao: Number(r.solicitacao), cotacao: r.cotacao && Number(r.cotacao), pedido: r.pedido && Number(r.pedido), contrato: r.contrato && Number(r.contrato) }
    const { passos, parado_em } = calcularTrilha({ item, docs, eventos, medicoes: medicoesDo.get(String(r.contrato)) || [], regras })
    const desde = parado_em?.ultimo?.slice(0, 10) ?? null
    itens.push({
      ...item, sequencia: r.sequencia, descricao: r.descricao, fornecedor: r.fornecedor, valor: Number(r.valor) || 0,
      etapas: etapas.map((c) => ({ codigo: c, nome: nomeEtapa.get(c) })), passos, parado_em,
      dias_parado: desde ? Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) : null,
    })
  }
  itens.sort((a, b) => (a.parado_em ? 0 : 1) - (b.parado_em ? 0 : 1) || (b.dias_parado ?? -1) - (a.dias_parado ?? -1))
  return { obra, itens }
}
```

Rota: `app.get('/api/contratacoes/micro', rota((req) => obterMicro(exigirProjeto(req.query.projectId), Number(req.query.grupoId))))`.

- [ ] **Step 2: Verificar contra produção (somente leitura)** — após deploy ou via `docker exec` no container `app`: `curl "localhost:PORT/api/contratacoes/micro?projectId=40661&grupoId=<id de um grupo da POTY>"` e conferir que a solicitação 16000 (se estiver no grupo) mostra Solicitação → Estouro 548 → Mapa 548 → Pedido 664 aprovados. Se rodar localmente sem o banco de produção, pular e registrar no ledger.
- [ ] **Step 3: Commit** — `feat(contratacoes): consulta do painel micro com trilha do Approvo`

---

### Task 4: Painel micro na linha do macro

**Files:**
- Create: `src/components/contratacoes/ContratacoesMicro.tsx`
- Modify: `src/components/contratacoes/contratacoes-api.ts`, `ContratacoesMacro.tsx`, `ContratacoesMacro.css`

**Interfaces:**
- Consumes: rota `/api/contratacoes/micro`
- Produces: TS `type StatusPasso = 'NAO_INICIADO'|'PENDENTE'|'APROVADO'|'REPROVADO'|'DISPENSADO'`; `interface Passo { passo: string; numero: number|null; status: StatusPasso; exigidas: number; feitas: number; aprovadores: string[]; ultimo: string|null; valor: number|null }`; `interface ItemMicro {...}` igual à Task 3; `api.micro(projectId, grupoId)`; componente `ContratacoesMicro({ projectId, grupoId })`

- [ ] **Step 1: API + componente**

```tsx
import { useEffect, useState } from 'react'
import { api, type ItemMicro, type StatusPasso } from './contratacoes-api'

const NOMES: Record<string, string> = {
  SOLICITACAO: 'Solicitação', ESTOURO: 'Estouro', MAPA: 'Mapa de cotação', PEDIDO: 'Pedido',
  CONTRATO: 'Contrato', ADITIVO: 'Aditivo', MEDICAO: 'Medição', COMPRA: 'Pedido/Contrato',
}
const STATUS: Record<StatusPasso, string> = { NAO_INICIADO: 'Não iniciado', PENDENTE: 'Pendente', APROVADO: 'Aprovado', REPROVADO: 'Reprovado', DISPENSADO: 'Dispensado' }
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const dataHora = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')

export function ContratacoesMicro({ projectId, grupoId }: { projectId: string; grupoId: number }) {
  const [itens, setItens] = useState<ItemMicro[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    api.micro(projectId, grupoId).then((r) => { if (vivo) setItens(r.itens) }).catch((e) => { if (vivo) setErro((e as Error).message) })
    return () => { vivo = false }
  }, [projectId, grupoId])
  if (erro) return <p className="cm-erro">{erro}</p>
  if (!itens) return <p className="cm-muted">Carregando itens…</p>
  if (!itens.length) return <p className="cm-muted">Nenhuma solicitação do Mega nas etapas deste grupo.</p>
  return (
    <div className="cm-micro">
      {itens.map((it) => (
        <div key={`${it.solicitacao}-${it.sequencia}`} className="cm-item">
          <div className="cm-item-cab">
            <strong>Sol. {it.solicitacao}/{it.sequencia}</strong> {it.descricao}
            <span className="cm-muted">{it.fornecedor ?? ''} · {moeda.format(it.valor)}</span>
            <span className="cm-muted">{it.etapas.map((e) => `${e.codigo} ${e.nome ?? ''}`).join(' · ')}</span>
            {it.parado_em && <span className="cm-parado">Parado em {NOMES[it.parado_em.passo]}{it.dias_parado !== null ? ` há ${it.dias_parado} dias` : ''}</span>}
          </div>
          <ol className="cm-trilha">
            {it.passos.map((p, i) => (
              <li key={i} className={`cm-passo cm-p-${p.status}`} title={p.aprovadores.join(', ')}>
                <span>{NOMES[p.passo]}{p.numero ? ` ${p.numero}` : ''}</span>
                <span>{STATUS[p.status]}{p.exigidas ? ` · ${p.feitas}/${p.exigidas}` : ''}</span>
                {p.aprovadores.length > 0 && <small>{p.aprovadores.join(', ')}</small>}
                {p.ultimo && <small>{dataHora(p.ultimo)}</small>}
                {p.status === 'NAO_INICIADO' && p.numero && <small>sem registro no Approvo</small>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Expandir linha** — em `ContratacoesMacro.tsx`: estado `aberto: number | null`; a `<tr key={g.id}>` ganha `onClick={() => setAberto(aberto === g.id ? null : g.id)}`, `className="cm-linha"` e um indicador ▸/▾ na primeira célula; logo abaixo, quando `aberto === g.id`, `<tr className="cm-sub"><td colSpan={N}><ContratacoesMicro projectId={projectId} grupoId={g.id} /></td></tr>` (N = número de colunas atual). Envolver as duas `<tr>` em `<Fragment key={g.id}>`.

- [ ] **Step 3: CSS** — em `ContratacoesMacro.css`: `.cm-linha{cursor:pointer}`, `.cm-trilha{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0}`, `.cm-passo{display:flex;flex-direction:column;border:1px solid var(--border, #d0d7de);border-radius:6px;padding:4px 8px;font-size:12px;min-width:120px}`, cores por status (APROVADO verde claro, PENDENTE âmbar, REPROVADO vermelho, NAO_INICIADO/DISPENSADO cinza), `.cm-parado{color:#b54708;font-weight:600}`, `.cm-item{padding:8px 0;border-bottom:1px solid #eee}`. Reusar as variáveis de cor já usadas pelos `.cm-sinal` do arquivo.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit -p .`, `npm run build` OK; abrir o painel 6 no dev server com a POTY, expandir um grupo e conferir visualmente (se não houver banco local com dados do Mega, conferir após o deploy).
- [ ] **Step 5: Commit** — `feat(contratacoes): painel micro com trilha de aprovacao`

---

### Task 5: Aba Approvo em Dados Mega

**Files:**
- Modify: `server/db.js` (mapa de tabelas, junto de `pedidos_compra`), `src/components/mega/mega-columns.ts`, `src/MegaView.tsx`

**Interfaces:**
- Produces: chaves de tabela `approvo_documentos` e `approvo_ocorrencias`; `MegaTabKey` com `'approvo'` e subaba `ApprovoSubTab = 'documentos' | 'ocorrencias'` (mesmo padrão de `analise_saldo`/`SaldoSubTab`).

- [ ] **Step 1: Server** — em `server/db.js`:

```js
  approvo_documentos: {
    table: 'mega.approvo_documentos',
    hasObra: true,
    orderBy: 'data_documento DESC NULLS LAST, numero DESC',
    searchColumns: ['CAST(numero AS TEXT)', 'tipo_documento', 'status', 'solicitante', 'regra_aprovacao'],
  },
  approvo_ocorrencias: {
    table: 'mega.approvo_ocorrencias',
    hasObra: true,
    orderBy: 'data_hora DESC NULLS LAST, id DESC',
    searchColumns: ['CAST(numero_documento AS TEXT)', 'tipo_documento', 'aprovador', 'acao'],
  },
```

- [ ] **Step 2: Colunas** — em `mega-columns.ts`, `approvo_documentos`: obra, numero, tipo_documento, data_documento, status, valor (number, right), solicitante, data_envio_aprovacao, regra_aprovacao, agente, projeto (visíveis os 9 primeiros). `approvo_ocorrencias`: obra, tipo_documento, numero_documento, acao, aprovador, data_hora (date), valor, motivo_operacao, solicitante. Mesmo formato das entradas existentes (`id, label, category, type, defaultVisible, priority`).

- [ ] **Step 3: Aba** — em `MegaView.tsx`: adicionar `'approvo'` ao `MegaTabKey`, estado `approvoSubTab`, `currentTableKey` retorna `approvo_${approvoSubTab}` quando `activeTab === 'approvo'`, título "Approvo — Documentos"/"Approvo — Ocorrências", botão de aba (ícone `CheckCircle` do lucide-react) e as duas subabas copiando o markup das subabas de `analise_saldo`.

- [ ] **Step 4: Verificar** — `npm run build` OK; no dev server, aba Approvo filtrando obra 650 lista documentos e ocorrências.
- [ ] **Step 5: Commit** — `feat(mega): aba Approvo em Dados Mega`

---

### Task 6: Fechamento

- [ ] `npm run test:server` (todos passam), `npm run build`.
- [ ] Atualizar spec seção 9 ("Entrega em etapas") marcando etapa 3 com o que entrou.
- [ ] Revisão final (subagente) e `superpowers:finishing-a-development-branch`.
- [ ] Depois do redeploy (fora de 00:00–05:00 e 07:30–09:00): conferir na POTY as trilhas da amostra (sol. 16000 → pedido 664; sol. 16778 → contrato 3109 + aditivo) e o caso sem registro (contrato 3136).
