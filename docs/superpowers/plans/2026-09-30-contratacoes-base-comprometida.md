# Contratações — Base comprometida no macro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O painel macro de Contratações passa a medir pedido/contrato pelo **saldo aberto** do Mega (Análise de Saldo) e o comprometido como apropriado + saldo de contrato + saldo de pedido, com "falta solicitar" e "falta fechar".

**Architecture:** Regra pura em `server/contratacoes.js` (`calcularMacro`) recebe, por etapa, `{ solicitado, em_pedido, em_contrato, realizado }`. A camada de banco `server/contratacoes-db.js` (`valoresPorEtapa`) troca a origem de pedido/contrato: deixa de usar o valor do item da solicitação e passa a ler `mega.analise_pedidos_hist.valor_apropriacao` e `mega.analise_contratos_hist.total` da última extração da obra. A tela `ContratacoesMacro.tsx` mostra as novas colunas.

**Tech Stack:** Node (ESM) + `node:test`, Postgres (`pg`), React/TypeScript (Vite).

**Spec:** `docs/superpowers/specs/2026-09-30-contratacoes-material-mao-de-obra-design.md` — este plano cobre só o item 1 da "Ordem de entrega" (seção 9) e a seção 4 sem a quebra por tipo. Classificação de insumos, aba Mão de obra, flags por fase e micro em tabela ficam para planos seguintes.

## Global Constraints

- Schema `public` é do `app`; schema `mega` é só leitura para o `app` (AGENTS.md).
- Fases cumulativas até 100%: realizado ≤ comprometido ≤ solicitado efetivo. > 100% = "Rever projeção/dados" (sinal `PENDENCIA`).
- Comprometido = realizado + em contrato + em pedido.
- Solicitado efetivo por etapa = max(solicitado, comprometido).
- Falta solicitar = P − solicitado efetivo; falta fechar = P − comprometido (nunca negativo).
- Saldo de pedido = `valor_apropriacao` de `mega.analise_pedidos_hist`; saldo de contrato = `total` de `mega.analise_contratos_hist` (conferido em 2026-09-30 contra a projeção do POTY: massa 01.05.01.03.004 = 55.666,50; contrato RU 01.05.01.03.005 = 1.922,80). Etapa em `raw_data->>'cod_estruturado'`.
- Saldos: só a **última `data_extracao` da obra** em cada tabela (são históricas, empilhadas por dia).
- Textos da tela em pt-BR.

## Review Focus

1. Obra sem nenhuma linha nas tabelas de saldo (extração ainda não rodou) → pedido/contrato 0, painel não quebra. Teste em Task 1 ("sem saldos").
2. Etapa com saldo/apropriado mas sem solicitação (contrato livre de MO) → conta no comprometido e não aparece como "falta solicitar". Teste em Task 1 ("contrato sem solicitação").
3. Comprometido acima do projetado (estouro) → `PENDENCIA`, falta fechar 0, não negativo. Teste em Task 1.
4. Grupo 97% comprometido e no prazo não pode virar "Rever projeção" (regra antiga dos 95–100% sai). Teste em Task 1.
5. Duas extrações no mesmo histórico → não somar dias diferentes. Coberto pela query com `MAX(data_extracao)` (Task 2) e verificado na Step de conferência na VPS.

---

### Task 1: Regra do macro com base comprometida

**Files:**
- Modify: `server/contratacoes.js` (constante `FASES` e `calcularMacro`, ~linhas 166-206)
- Test: `server/contratacoes.test.js` (bloco dos testes `macro:`, ~linhas 150-201)

**Interfaces:**
- Consumes: `valores: Map<codigo_etapa, { solicitado, em_pedido, em_contrato, realizado }>` (números; campo ausente = 0).
- Produces: cada linha de `calcularMacro(...).grupos` tem
  `projetado, solicitado, solicitado_efetivo, em_pedido, em_contrato, realizado, comprometido, falta_solicitar, falta_fechar, pct: { solicitado, em_pedido, em_contrato, realizado, comprometido }` (pct.solicitado = solicitado_efetivo / P; null quando P ≤ 0), além de `id, tipo, item, insumos, lead_time, etapas, inicio, limite, dias_ate_limite, sinal` como hoje.
  `resumo: { projetado, comprometido, falta_solicitar, falta_fechar, porSinal }`.

- [ ] **Step 1: Reescrever os testes do macro**

Em `server/contratacoes.test.js`, substituir o helper `v` e todos os testes de `test('macro: sem projeção…` até `test('macro: resumo soma a obra e conta sinais'…` (inclusive) por:

```js
const v = (solicitado, em_pedido = 0, em_contrato = 0, realizado = 0) => ({ solicitado, em_pedido, em_contrato, realizado })

test('macro: sem projeção não divide por zero', () => {
  const g = macro(base([]))
  assert.equal(g.sinal, 'SEM_PROJECAO')
  assert.equal(g.pct.solicitado, null)
  assert.equal(g.pct.comprometido, null)
})

test('macro: comprometido = realizado + saldo de pedido + saldo de contrato', () => {
  const g = macro(base(['a', 'b']), { proj: { a: 600, b: 400 }, val: { a: v(300, 100, 50, 100), b: v(0, 0, 0, 200) }, ini: { a: '2027-01-10' } })
  assert.deepEqual(
    [g.projetado, g.solicitado, g.solicitado_efetivo, g.em_pedido, g.em_contrato, g.realizado, g.comprometido, g.falta_solicitar, g.falta_fechar],
    [1000, 300, 500, 100, 50, 300, 450, 500, 550])
  assert.equal(g.pct.comprometido, 0.45)
  assert.equal(g.pct.solicitado, 0.5)
  assert.equal(g.sinal, 'NO_PRAZO')
})

test('macro: contrato sem solicitação conta como solicitado e não fica atrasado', () => {
  const g = macro(base(['a'], 30), { proj: { a: 100 }, val: { a: v(0, 0, 100, 0) }, ini: { a: '2026-10-01' } })
  assert.equal(g.falta_solicitar, 0)
  assert.equal(g.falta_fechar, 0)
  assert.equal(g.sinal, 'NO_PRAZO')
})

test('macro: sem saldos (campos ausentes) vale zero', () => {
  const g = macro(base(['a']), { proj: { a: 100 }, val: { a: { solicitado: 40 } }, ini: { a: '2027-01-01' } })
  assert.deepEqual([g.em_pedido, g.em_contrato, g.realizado, g.comprometido, g.falta_fechar], [0, 0, 0, 0, 100])
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

test('macro: 97% comprometido no prazo continua no prazo (sem regra dos 95%)', () => {
  const g = macro(base(['a']), { proj: { a: 100 }, val: { a: v(100, 10, 12, 75) }, ini: { a: '2027-01-01' } })
  assert.equal(g.comprometido, 97)
  assert.equal(g.sinal, 'NO_PRAZO')
})

test('macro: acima de 100% (solicitado ou comprometido) pede rever projeção', () => {
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(130) }, ini: { a: '2027-01-01' } }).sinal, 'PENDENCIA')
  const g = macro(base(['a']), { proj: { a: 100 }, val: { a: v(0, 20, 0, 90) }, ini: { a: '2027-01-01' } })
  assert.equal(g.sinal, 'PENDENCIA')
  assert.equal(g.falta_fechar, 0)
})

test('macro: concluído com 100% realizado; sem data sem cronograma', () => {
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(100, 0, 0, 100) } }).sinal, 'CONCLUIDO')
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(10) } }).sinal, 'SEM_DATA')
})

test('macro: resumo soma a obra e conta sinais', () => {
  const r = calcularMacro({
    grupos: [base(['a']), { ...base(['b']), id: 2 }],
    projetado: new Map([['a', 100], ['b', 50]]), valores: new Map([['a', v(20, 10)]]),
    inicio: new Map(), hoje: '2026-09-29',
  })
  assert.deepEqual([r.resumo.projetado, r.resumo.comprometido, r.resumo.falta_fechar, r.resumo.falta_solicitar], [150, 10, 140, 130])
  assert.equal(r.resumo.porSinal.SEM_DATA, 2)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test server/contratacoes.test.js`
Expected: FAIL nos testes `macro:` (campos `comprometido`, `falta_fechar` etc. `undefined`).

- [ ] **Step 3: Implementar em `server/contratacoes.js`**

Trocar a linha `const FASES = ['solicitado', 'pedido', 'contratado', 'realizado']` e a função `calcularMacro` inteira por:

```js
const FASES = ['solicitado', 'em_pedido', 'em_contrato', 'realizado']

// Painel macro: por grupo, quanto do custo projetado já está comprometido
// (apropriado + saldo aberto de pedido + saldo aberto de contrato, como na
// projeção de custo) e quanto ainda falta solicitar/fechar.
// Data-limite de solicitação = menor início das etapas no cronograma - lead time.
export function calcularMacro({ grupos, projetado, valores, inicio, hoje }) {
  const linhas = grupos.map((g) => {
    const soma = { projetado: 0, solicitado: 0, em_pedido: 0, em_contrato: 0, realizado: 0, comprometido: 0, solicitado_efetivo: 0 }
    let menorInicio = null
    for (const e of g.etapas) {
      const val = valores.get(e) || {}
      const n = (f) => Number(val[f]) || 0
      soma.projetado += projetado.get(e) || 0
      for (const f of FASES) soma[f] += n(f)
      const comprometido = n('realizado') + n('em_pedido') + n('em_contrato')
      soma.comprometido += comprometido
      // Contrato fechado sem passar pela solicitação também conta como solicitado.
      soma.solicitado_efetivo += Math.max(n('solicitado'), comprometido)
      const ini = inicio.get(e)
      if (ini && (!menorInicio || ini < menorInicio)) menorInicio = ini
    }
    const P = soma.projetado
    const razao = (x) => (P > 0 ? x / P : null)
    const pct = { solicitado: razao(soma.solicitado_efetivo), em_pedido: razao(soma.em_pedido),
      em_contrato: razao(soma.em_contrato), realizado: razao(soma.realizado), comprometido: razao(soma.comprometido) }
    const limite = menorInicio ? subtrairDias(menorInicio, g.lead_time) : null
    const diasAteLimite = limite ? diasEntre(hoje, limite) : null
    let sinal
    if (P <= 0) sinal = 'SEM_PROJECAO'
    else if (soma.solicitado_efetivo > P) sinal = 'PENDENCIA'
    else if (soma.realizado >= P) sinal = 'CONCLUIDO'
    else if (!limite) sinal = 'SEM_DATA'
    else if (soma.solicitado_efetivo < P && diasAteLimite < 0) sinal = 'ATRASADO'
    else if (soma.solicitado_efetivo < P && diasAteLimite <= 7) sinal = 'ATENCAO'
    else sinal = 'NO_PRAZO'
    return {
      id: g.id, tipo: g.tipo, item: g.item, insumos: g.insumos, lead_time: g.lead_time, etapas: g.etapas.length,
      ...soma, falta_solicitar: Math.max(0, P - soma.solicitado_efetivo), falta_fechar: Math.max(0, P - soma.comprometido),
      pct, inicio: menorInicio, limite, dias_ate_limite: diasAteLimite, sinal,
    }
  })
  linhas.sort((a, b) => PRIORIDADE.indexOf(a.sinal) - PRIORIDADE.indexOf(b.sinal)
    || String(a.limite ?? '9').localeCompare(String(b.limite ?? '9')))
  const porSinal = Object.fromEntries(PRIORIDADE.map((s) => [s, 0]))
  for (const l of linhas) porSinal[l.sinal]++
  const total = (f) => linhas.reduce((s, l) => s + l[f], 0)
  return { grupos: linhas, resumo: { projetado: total('projetado'), comprometido: total('comprometido'),
    falta_solicitar: total('falta_solicitar'), falta_fechar: total('falta_fechar'), porSinal } }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:server`
Expected: PASS em todos (inclusive os testes de trilha/aprovação, que não mudam).

- [ ] **Step 5: Commit**

```bash
git add server/contratacoes.js server/contratacoes.test.js
git commit -m "feat(contratacoes): macro mede comprometido (apropriado + saldos) e falta solicitar/fechar"
```

---

### Task 2: Saldos da Análise de Saldo no banco

**Files:**
- Modify: `server/contratacoes-db.js` (`valoresPorEtapa`, ~linhas 247-294)

**Interfaces:**
- Consumes: nada novo.
- Produces: `valoresPorEtapa(obra): Promise<Map<codigo_etapa_mega, { solicitado, em_pedido, em_contrato, realizado }>>` — formato esperado por `calcularMacro` (Task 1).

- [ ] **Step 1: Substituir `valoresPorEtapa`**

Trocar o comentário acima da função e a função inteira por:

```js
// Valores por etapa (formato Mega). Solicitado = valor do item da solicitação;
// em_pedido / em_contrato = saldo aberto da Análise de Saldo (abas Pedidos e
// Contratos, última extração da obra); realizado = apropriação por cod_estruturado.
// Comprometido = realizado + saldos, como na planilha de projeção de custo.
async function valoresPorEtapa(obra) {
  const [itens, pedidos, contratos, realizado] = await Promise.all([
    query(
      `WITH etapa_distinta AS (
         SELECT DISTINCT codigo_solicitacao, sequencial_item, codigo_etapa
         FROM mega.solicitacoes_por_etapa WHERE obra = $1 AND codigo_etapa IS NOT NULL
       ), etapa_item AS (
         -- Item ligado a várias etapas: o Mega não diz quanto vai para cada uma,
         -- então o valor é dividido igualmente (senão conta mais de uma vez).
         SELECT *, COUNT(*) OVER (PARTITION BY codigo_solicitacao, sequencial_item) AS n_etapas FROM etapa_distinta
       ), item AS (
         SELECT solicitacao, sequencia, MAX(valor_total) AS valor
         FROM mega.visualizacao_itens WHERE obra = $1 GROUP BY solicitacao, sequencia
       )
       SELECT e.codigo_etapa, SUM(COALESCE(i.valor, 0) / e.n_etapas) AS solicitado
       FROM etapa_item e
       JOIN item i ON i.solicitacao::text = e.codigo_solicitacao::text AND i.sequencia::text = e.sequencial_item::text
       GROUP BY e.codigo_etapa`, [obra]),
    query(
      `SELECT raw_data->>'cod_estruturado' AS codigo_etapa, SUM(COALESCE(valor_apropriacao, 0)) AS valor
       FROM mega.analise_pedidos_hist
       WHERE obra = $1 AND data_extracao = (SELECT MAX(data_extracao) FROM mega.analise_pedidos_hist WHERE obra = $1)
       GROUP BY 1`, [obra]),
    query(
      `SELECT raw_data->>'cod_estruturado' AS codigo_etapa, SUM(COALESCE(total, 0)) AS valor
       FROM mega.analise_contratos_hist
       WHERE obra = $1 AND data_extracao = (SELECT MAX(data_extracao) FROM mega.analise_contratos_hist WHERE obra = $1)
       GROUP BY 1`, [obra]),
    query(
      `SELECT raw_data->>'cod_estruturado' AS codigo_etapa, SUM(COALESCE(valor_apropriacao, 0)) AS valor
       FROM mega.analise_realizado WHERE obra = $1 AND raw_data ? 'cod_estruturado' GROUP BY 1`, [obra]),
  ])
  const mapa = new Map()
  const somar = (rows, campo) => {
    for (const r of rows) {
      const c = etapaParaMega(r.codigo_etapa)
      if (!c) continue
      if (!mapa.has(c)) mapa.set(c, { solicitado: 0, em_pedido: 0, em_contrato: 0, realizado: 0 })
      mapa.get(c)[campo] += Number(r[campo === 'solicitado' ? 'solicitado' : 'valor']) || 0
    }
  }
  somar(itens.rows, 'solicitado')
  somar(pedidos.rows, 'em_pedido')
  somar(contratos.rows, 'em_contrato')
  somar(realizado.rows, 'realizado')
  return mapa
}
```

- [ ] **Step 2: Rodar os testes do servidor**

Run: `npm run test:server`
Expected: PASS (a função de banco não tem teste unitário; os de regra continuam verdes).

- [ ] **Step 3: Conferir a soma na VPS (somente leitura)**

Rodar a mesma agregação para o drywall do POTY (obra 650, etapas do grupo 328) e anotar o resultado:

```bash
ssh rag-vps "docker exec -i postgres-7tgqx7ubh3q9wglstoqlcmms-164615749202 sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -P pager=off'" <<'EOF'
BEGIN READ ONLY;
WITH et AS (SELECT codigo_etapa FROM contratacao_grupo_etapas WHERE grupo_id = 328)
SELECT
 (SELECT round(sum(valor_apropriacao)) FROM mega.analise_realizado WHERE obra='650' AND raw_data->>'cod_estruturado' IN (SELECT codigo_etapa FROM et)) realizado,
 (SELECT round(sum(valor_apropriacao)) FROM mega.analise_pedidos_hist WHERE obra='650' AND data_extracao=(SELECT max(data_extracao) FROM mega.analise_pedidos_hist WHERE obra='650') AND raw_data->>'cod_estruturado' IN (SELECT codigo_etapa FROM et)) em_pedido,
 (SELECT round(sum(total)) FROM mega.analise_contratos_hist WHERE obra='650' AND data_extracao=(SELECT max(data_extracao) FROM mega.analise_contratos_hist WHERE obra='650') AND raw_data->>'cod_estruturado' IN (SELECT codigo_etapa FROM et)) em_contrato;
ROLLBACK;
EOF
```

Expected (2026-09-30): realizado + em_pedido + em_contrato ≈ R$ 1,40 mi (~97% de R$ 1.445.565).

- [ ] **Step 4: Commit**

```bash
git add server/contratacoes-db.js
git commit -m "feat(contratacoes): pedido e contrato pelo saldo aberto da Analise de Saldo"
```

---

### Task 3: Tela do macro com as novas colunas

**Files:**
- Modify: `src/components/contratacoes/contratacoes-api.ts` (tipos `Pct`, `LinhaMacro`, `Macro`)
- Modify: `src/components/contratacoes/ContratacoesMacro.tsx` (resumo e tabela)

**Interfaces:**
- Consumes: resposta de `/api/contratacoes/macro` no formato produzido pela Task 1.
- Produces: nada para outras tasks.

- [ ] **Step 1: Atualizar os tipos em `contratacoes-api.ts`**

Substituir as linhas de `type Pct`, `LinhaMacro` e `Macro` por:

```ts
type Pct = { solicitado: number | null; em_pedido: number | null; em_contrato: number | null; realizado: number | null; comprometido: number | null }
export interface LinhaMacro { id: number; tipo: Tipo; item: string; insumos: string | null; lead_time: number; etapas: number; projetado: number; solicitado: number; solicitado_efetivo: number; em_pedido: number; em_contrato: number; realizado: number; comprometido: number; falta_solicitar: number; falta_fechar: number; pct: Pct; inicio: string | null; limite: string | null; dias_ate_limite: number | null; sinal: Sinal }
export interface Macro { obra: string | null; motivo?: string; importacao: Config['importacao']; grupos: LinhaMacro[]; resumo: { projetado: number; comprometido: number; falta_solicitar: number; falta_fechar: number; porSinal: Record<Sinal, number> } }
```

- [ ] **Step 2: Resumo do topo em `ContratacoesMacro.tsx`**

Trocar as duas linhas `Lançado` / `Falta lançar` por:

```tsx
        <div><span>Comprometido</span><strong>{moeda.format(macro.resumo.comprometido)}</strong></div>
        <div><span>Falta fechar</span><strong>{moeda.format(macro.resumo.falta_fechar)}</strong></div>
        <div><span>Falta solicitar</span><strong>{moeda.format(macro.resumo.falta_solicitar)}</strong></div>
```

- [ ] **Step 3: Cabeçalho e linhas da tabela**

Trocar o `<tr>` do `<thead>` por:

```tsx
                  <tr>
                    <th>Grupo</th><th className="cm-num">Projetado</th><th className="cm-num">Solicitado</th>
                    <th className="cm-num">Em pedido</th><th className="cm-num">Em contrato</th><th className="cm-num">Realizado</th>
                    <th className="cm-num">Comprometido</th><th className="cm-num">Falta solicitar</th><th className="cm-num">Falta fechar</th>
                    <th>Início</th><th>Limite solicitação</th><th>Situação</th>
                  </tr>
```

Trocar as células de percentual e falta (de `pct.solicitado` até `g.falta`) por:

```tsx
                      <td className="cm-num">{pctFmt(g.pct.solicitado)}</td>
                      <td className="cm-num">{pctFmt(g.pct.em_pedido)}</td>
                      <td className="cm-num">{pctFmt(g.pct.em_contrato)}</td>
                      <td className="cm-num">{pctFmt(g.pct.realizado)}</td>
                      <td className="cm-num"><strong>{pctFmt(g.pct.comprometido)}</strong></td>
                      <td className="cm-num">{g.projetado ? moeda.format(g.falta_solicitar) : '—'}</td>
                      <td className="cm-num">{g.projetado ? moeda.format(g.falta_fechar) : '—'}</td>
```

E no `<tr className="cm-sub">` trocar `colSpan={10}` por `colSpan={12}`.

- [ ] **Step 4: Checar tipos e build**

Run: `npx tsc --noEmit -p .` e depois `npm run build`
Expected: sem erros (nenhuma outra tela usa `lancado`/`falta` do macro — conferido com grep).

- [ ] **Step 5: Ver na tela**

Run: `npm run dev` (com o backend apontando para um banco com dados) ou, sem banco local, validar após o Redeploy: abrir Contratações do POTY e conferir DRYWALL ≈ 97% comprometido, falta fechar ≈ R$ 40 mil, alinhado com a Step 3 da Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/components/contratacoes/contratacoes-api.ts src/components/contratacoes/ContratacoesMacro.tsx
git commit -m "feat(contratacoes): macro mostra comprometido, em pedido/contrato e falta solicitar/fechar"
```

---

### Task 4: Atualizar a spec original e entregar

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md` (linha da tabela de decisões "Lançado" e o bloco "Macro (substitui …)")

- [ ] **Step 1: Registrar a mudança**

Na tabela da seção 2, trocar a linha `| Lançado | …` por:

```markdown
| Comprometido | **Substituído em 2026-09-30** (spec `2026-09-30-contratacoes-material-mao-de-obra-design.md`): apropriado + saldo aberto de pedido + saldo aberto de contrato (Análise de Saldo); fases cumulativas até 100% |
```

- [ ] **Step 2: Commit e pedir Redeploy**

```bash
git add docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md
git commit -m "docs(contratacoes): macro passa a usar base comprometida"
```

Pedir ao usuário `git push` (se autorizado) e o Redeploy do `app` no Coolify — não perto da meia-noite (rotina do Mega).
