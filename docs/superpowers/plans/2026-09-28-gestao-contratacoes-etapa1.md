# Gestão de Contratações — Etapa 1 (configuração e importação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a equipe, no site, aplique o padrão de grupos de contratação (planilha do Nizza) a uma obra, ajuste grupos e prazos, atrele etapas de orçamento (nível 4 ou 5) a partir da lista de pendências, confirme vínculos sugeridos, e importe o custo projetado mensal — base para os painéis macro/micro das etapas 2 e 3.

**Architecture:** Tabelas novas no schema `public` (criadas pelo `schema.sql` idempotente que o `app` aplica ao subir). Regras puras (conversão de código, expansão de nível 4, comparação de nomes, leitura da planilha de custo) em `server/contratacoes.js`, testadas com `node --test`. Acesso a banco em `server/contratacoes-db.js`, rotas em `server/index.js`. Front em `src/components/contratacoes/`, ligado como novo painel da Gestão à Vista.

**Tech Stack:** Node 20+ (ESM), Express 5, `pg`, React 19 + TypeScript + Vite, `xlsx` (já dependência do projeto).

**Spec:** `docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md`

## Global Constraints

- Schema `public` é do `app`; schema `mega` é só leitura para o `app`.
- Nenhuma dependência nova: `xlsx` já está em `package.json`.
- Etapa no formato Mega: `XX.XX.XX.XX.XXX`; Prevision: `XX.XX.XX.XX.XX` → soma um zero à esquerda do último nível.
- Nível 4 é agrupador: atrelar um nível 4 = atrelar **todos os níveis 5** abaixo dele.
- Uma etapa nível 5 pertence a **no máximo um grupo por obra**.
- Padrão = grupos com `projeto_id IS NULL`; obra recebe **cópia** na primeira configuração.
- Vínculo do padrão: código e nome batem → `CONFIRMADO`; código bate e nome difere → `SUGERIDO`; nome bate e código difere → sugestão na pendência.
- Importação do custo projetado: colunas localizadas pelo nome; aceita código Mega ou Prevision; ignora níveis 1–4; soma linhas repetidas do mesmo código; prévia antes de gravar.
- Nada de `alert/confirm/prompt`: confirmações na própria tela.
- Textos da interface em português do Brasil.
- Mudanças no banco de produção só chegam pelo deploy do `app` feito pelo usuário (Redeploy no Coolify).

**Ajustes em relação à spec (decididos no plano):**
- A obra guarda as etapas **já expandidas para nível 5** (`origem_nivel4` registra o nível 4 que as trouxe); o padrão guarda o código como na planilha. Assim a regra "uma etapa em um só grupo" vira um índice único no banco. Etapas novas que surgirem depois sob um nível 4 aparecem nas pendências.
- A coluna **"lançado"** nas pendências fica para a etapa 2, junto do cálculo da fase mais avançada; na etapa 1 as pendências mostram o custo projetado.
- A biblioteca `xlsx` **já é dependência** do projeto — nenhuma dependência nova.

## Review Focus

1. **Etapa em dois grupos do padrão** (a planilha do Nizza repete `01.03.05.02.002` nos itens 1 e 3): aplicar o padrão não pode falhar nem duplicar; o primeiro grupo (por ordem) fica com a etapa e o conflito é contado no retorno. → teste em Task 2.
2. **Nível 4 e nível 5 do mesmo ramo em grupos diferentes**: o nível 5 explícito vence a expansão do nível 4. → teste em Task 2.
3. **Aba CUSTOS com duas colunas "CÓDIGO"** e a mesma etapa na linha N4 (total) e nas N5 (insumos): usar a coluna "CÓDIGO" mais próxima à esquerda de "CUSTO PROJETADO" e, por etapa, só as linhas de menor NÍVEL — senão o valor dobra. Sem coluna NÍVEL, somar repetidos. → testes em Task 2.
4. **Valores em texto brasileiro** (`"1.234,56"`) e células vazias na planilha: converter corretamente; vazio conta como ignorada, texto inválido vira erro com o número da linha. → teste em Task 2.
5. **Atrelar etapa que já está em outro grupo** sem pedir para mover: a API responde 409 com o grupo atual, e nada muda. → teste manual em Task 6, passo de verificação.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `scripts/extrair-padrao-contratacoes.mjs` (novo) | Lê a planilha do Nizza uma vez e gera o JSON do padrão |
| `server/contratacoes-padrao.json` (novo, gerado) | Padrão versionado: grupos, prazos e etapas com nome |
| `server/contratacoes.js` (novo) | Regras puras, sem banco |
| `server/contratacoes.test.js` (novo) | Testes `node --test` das regras |
| `server/schema.sql` (modificar) | Tabelas novas + alçadas iniciais |
| `server/contratacoes-db.js` (novo) | Consultas e gravações; carga do padrão |
| `server/db.js` (modificar) | `initDb` chama a carga do padrão |
| `server/index.js` (modificar) | Rotas `/api/contratacoes/*` |
| `src/components/contratacoes/contratacoes-api.ts` (novo) | Cliente HTTP tipado |
| `src/components/contratacoes/ContratacoesConfig.tsx` (novo) | Tela: grupos, pendências, importação |
| `src/components/contratacoes/ContratacoesConfig.css` (novo) | Estilos da tela |
| `src/App.tsx` (modificar) | Botão "Painel 6: Contratações" e render do componente |
| `package.json` (modificar) | Script `test:server` |

---

### Task 1: Extrair o padrão da planilha do Nizza

**Files:**
- Create: `scripts/extrair-padrao-contratacoes.mjs`
- Create (gerado): `server/contratacoes-padrao.json`

**Interfaces:**
- Produces: `server/contratacoes-padrao.json` com o formato:
  ```json
  { "origem": "NIZZA - GESTÃO DAS CONTRATAÇÕES.rv02.xlsx",
    "grupos": [
      { "ordem": 1, "tipo": "MATERIAL", "item": "INFRAESTRUTURA", "insumos": "AÇO RETO, CORTE E DOBRA, ARAME",
        "pacote_servicos": "CONTENÇÃO",
        "prazos": { "levantamento": 15, "solicitacao": 15, "negociacao": 15, "emissao": 10, "entrega": 5 },
        "etapas": [ { "codigo": "01.03.02.02.006", "nivel": 5, "nome": "AÇO CA50" } ] } ] }
  ```
  Material: prazos das colunas F–J; etapas das colunas S–W. Mão de obra: `insumos` = null, `pacote_servicos` = coluna D, prazos E (levantamento), F (entrega do QC → `entrega`), G (negociação), H (emissão do contrato → `emissao`), `solicitacao` = 0; etapas = `[]`.

- [ ] **Step 1: Escrever o script**

```js
// scripts/extrair-padrao-contratacoes.mjs
// Uso: node scripts/extrair-padrao-contratacoes.mjs "<caminho da planilha do Nizza>"
// Gera server/contratacoes-padrao.json (padrão de grupos de contratação).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'

const arquivo = process.argv[2]
if (!arquivo) {
  console.error('Informe o caminho da planilha do Nizza.')
  process.exit(1)
}
const wb = XLSX.readFile(arquivo)
const linhas = (aba) => XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null })
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim())
const numero = (v) => (typeof v === 'number' ? Math.round(v) : Number(String(v ?? '').replace(',', '.')) || 0)
const nivel = (c) => c.split('.').length
const ehCodigo = (c) => /^\d{2}(\.\d{2,3}){1,4}$/.test(c)

// Nomes das etapas pela aba CUSTOS: coluna F (código) e G (descrição).
const nomes = new Map()
for (const r of linhas('CUSTOS').slice(1)) {
  const codigo = texto(r[5])
  if (ehCodigo(codigo) && !nomes.has(codigo)) nomes.set(codigo, texto(r[6]))
}

const grupos = []
let ordem = 0
for (const r of linhas('MATERIAIS').slice(5)) {
  if (!texto(r[2])) continue
  const etapas = []
  for (const v of r.slice(18, 23)) {
    const codigo = texto(v)
    if (!ehCodigo(codigo) || ![4, 5].includes(nivel(codigo))) continue
    if (etapas.some((e) => e.codigo === codigo)) continue
    etapas.push({ codigo, nivel: nivel(codigo), nome: nomes.get(codigo) || '' })
  }
  grupos.push({
    ordem: ++ordem, tipo: 'MATERIAL', item: texto(r[2]), insumos: texto(r[3]) || null,
    pacote_servicos: texto(r[4]) || null,
    prazos: { levantamento: numero(r[5]), solicitacao: numero(r[6]), negociacao: numero(r[7]), emissao: numero(r[8]), entrega: numero(r[9]) },
    etapas,
  })
}
for (const r of linhas('MÃO DE OBRA').slice(5)) {
  if (!texto(r[2])) continue
  grupos.push({
    ordem: ++ordem, tipo: 'MAO_DE_OBRA', item: texto(r[2]), insumos: null,
    pacote_servicos: texto(r[3]) || null,
    prazos: { levantamento: numero(r[4]), solicitacao: 0, negociacao: numero(r[6]), emissao: numero(r[7]), entrega: numero(r[5]) },
    etapas: [],
  })
}

const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'contratacoes-padrao.json')
fs.writeFileSync(destino, JSON.stringify({ origem: path.basename(arquivo), grupos }, null, 2) + '\n', 'utf8')
const mat = grupos.filter((g) => g.tipo === 'MATERIAL')
console.log(`grupos: ${grupos.length} (material ${mat.length}, mão de obra ${grupos.length - mat.length}); etapas: ${mat.reduce((s, g) => s + g.etapas.length, 0)}`)
```

- [ ] **Step 2: Rodar e conferir as contagens**

Run: `node scripts/extrair-padrao-contratacoes.mjs "C:/Users/HomePC/Downloads/NIZZA - GESTÃO DAS CONTRATAÇÕES.rv02.xlsx"`
Expected: `grupos: 143 (material 103, mão de obra 40); etapas: 110` (111 códigos únicos na planilha, menos o de nível 2 ignorado; a contagem por grupo pode repetir códigos entre grupos — aceitar qualquer total entre 100 e 130 e registrar o número real no commit).

- [ ] **Step 3: Conferir uma amostra no JSON**

Run: `node -e "const p=JSON.parse(require('fs').readFileSync('server/contratacoes-padrao.json','utf8'));console.log(JSON.stringify(p.grupos[0],null,1));console.log(JSON.stringify(p.grupos.find(g=>g.tipo==='MAO_DE_OBRA')))"`
Expected: primeiro grupo = INFRAESTRUTURA / AÇO RETO... com prazos 15/15/15/10/5 e etapas incluindo `01.03.02.02.006`; primeiro de mão de obra = TOPOGRAFIA, etapas `[]`, prazos 15/0/10/20/15.

- [ ] **Step 4: Commit**

```bash
git add scripts/extrair-padrao-contratacoes.mjs server/contratacoes-padrao.json
git commit -m "feat(contratacoes): padrao de grupos extraido da planilha do Nizza"
```

---

### Task 2: Regras puras + testes

**Files:**
- Create: `server/contratacoes.js`
- Create: `server/contratacoes.test.js`
- Modify: `package.json` (script `test:server`)

**Interfaces:**
- Produces (todas exportadas de `server/contratacoes.js`):
  - `normalizarNome(nome: string): string`
  - `nivelDoCodigo(codigo: string): number`
  - `etapaParaMega(codigo: string): string | null` — 5 níveis → último nível com 3 dígitos; 4 níveis → igual; outro → `null`
  - `resolverEtapasPadrao(gruposPadrao, orcamento: Map<string,string>): { vinculos: Vinculo[], conflitos: {codigo_etapa, ordem}[] }` onde `gruposPadrao = [{ordem, etapas:[{codigo, nivel, nome}]}]` e `Vinculo = {ordem, codigo_etapa, situacao: 'CONFIRMADO'|'SUGERIDO', nome_padrao, nome_obra, origem_nivel4: string|null}`
  - `expandirParaNivel5(codigos: string[], orcamento: Map<string,string>): {codigo_etapa, origem_nivel4}[]`
  - `sugestoesPorNome(pendencias: {codigo, nome}[], etapasPadrao: {codigo, nome, ordem}[]): Map<string, {ordem, codigo_padrao}>`
  - `lerCustoProjetado(matriz: any[][]): { itens: {codigo_etapa, custo_projetado}[], total: number, ignoradas: number, erros: {linha, motivo}[] }`

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// server/contratacoes.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarNome, nivelDoCodigo, etapaParaMega, resolverEtapasPadrao,
  expandirParaNivel5, sugestoesPorNome, lerCustoProjetado,
} from './contratacoes.js'

test('normalizarNome ignora acento, caixa e espaços extras', () => {
  assert.equal(normalizarNome('  Aço  CA50 '), 'ACO CA50')
})

test('etapaParaMega converte Prevision e mantém Mega e nível 4', () => {
  assert.equal(etapaParaMega('01.01.01.01.43'), '01.01.01.01.043')
  assert.equal(etapaParaMega('01.01.01.01.043'), '01.01.01.01.043')
  assert.equal(etapaParaMega('01.04.01.05'), '01.04.01.05')
  assert.equal(etapaParaMega('01.04'), null)
  assert.equal(nivelDoCodigo('01.04.01.05'), 4)
})

const orcamento = new Map([
  ['01.03.02.02', 'ARMAÇÃO'],
  ['01.03.02.02.006', 'AÇO CA50'],
  ['01.03.02.02.009', 'CONCRETO BOMBEADO'],
  ['01.03.05.02.002', 'FORMA PARA FUNDAÇÃO'],
  ['01.08.01.02.001', 'DRENAGEM DIFERENTE'],
])

test('resolverEtapasPadrao: código+nome confirma, nome diferente sugere, inexistente ignora', () => {
  const { vinculos } = resolverEtapasPadrao([
    { ordem: 1, etapas: [
      { codigo: '01.03.02.02.006', nivel: 5, nome: 'Aço CA50' },
      { codigo: '01.08.01.02.001', nivel: 5, nome: 'EXECUCAO DE DRENAGEM' },
      { codigo: '09.09.09.09.009', nivel: 5, nome: 'NAO EXISTE' },
    ] },
  ], orcamento)
  assert.deepEqual(vinculos.map((v) => [v.codigo_etapa, v.situacao]), [
    ['01.03.02.02.006', 'CONFIRMADO'],
    ['01.08.01.02.001', 'SUGERIDO'],
  ])
})

test('resolverEtapasPadrao: etapa repetida fica com o primeiro grupo e gera conflito', () => {
  const { vinculos, conflitos } = resolverEtapasPadrao([
    { ordem: 1, etapas: [{ codigo: '01.03.05.02.002', nivel: 5, nome: 'FORMA PARA FUNDAÇÃO' }] },
    { ordem: 3, etapas: [{ codigo: '01.03.05.02.002', nivel: 5, nome: 'FORMA PARA FUNDAÇÃO' }] },
  ], orcamento)
  assert.equal(vinculos.length, 1)
  assert.equal(vinculos[0].ordem, 1)
  assert.deepEqual(conflitos, [{ codigo_etapa: '01.03.05.02.002', ordem: 3 }])
})

test('resolverEtapasPadrao: nível 5 explícito vence a expansão do nível 4', () => {
  const { vinculos } = resolverEtapasPadrao([
    { ordem: 1, etapas: [{ codigo: '01.03.02.02', nivel: 4, nome: 'ARMAÇÃO' }] },
    { ordem: 2, etapas: [{ codigo: '01.03.02.02.009', nivel: 5, nome: 'CONCRETO BOMBEADO' }] },
  ], orcamento)
  const porCodigo = Object.fromEntries(vinculos.map((v) => [v.codigo_etapa, v]))
  assert.equal(porCodigo['01.03.02.02.006'].ordem, 1)
  assert.equal(porCodigo['01.03.02.02.006'].origem_nivel4, '01.03.02.02')
  assert.equal(porCodigo['01.03.02.02.009'].ordem, 2)
})

test('expandirParaNivel5 abre nível 4 e mantém nível 5 existente', () => {
  assert.deepEqual(expandirParaNivel5(['01.03.02.02', '01.03.05.02.002', '09.09.09.09.009'], orcamento), [
    { codigo_etapa: '01.03.02.02.006', origem_nivel4: '01.03.02.02' },
    { codigo_etapa: '01.03.02.02.009', origem_nivel4: '01.03.02.02' },
    { codigo_etapa: '01.03.05.02.002', origem_nivel4: null },
  ])
})

test('sugestoesPorNome aponta etapa do padrão com mesmo nome e código diferente', () => {
  const s = sugestoesPorNome(
    [{ codigo: '01.05.01.01.001', nome: 'Aço CA50' }, { codigo: '01.05.01.01.002', nome: 'OUTRA' }],
    [{ codigo: '01.03.02.02.006', nome: 'AÇO CA50', ordem: 1 }],
  )
  assert.deepEqual(s.get('01.05.01.01.001'), { ordem: 1, codigo_padrao: '01.03.02.02.006' })
  assert.equal(s.has('01.05.01.01.002'), false)
})

// Na aba CUSTOS a mesma etapa (5 segmentos) aparece na linha N4 (composição,
// com o total) e nas linhas N5 (insumos que somam esse total). Só a linha de
// menor N conta, senão o valor dobra.
test('lerCustoProjetado: CÓDIGO mais perto de CUSTO PROJETADO, só a linha de menor NÍVEL por etapa', () => {
  const matriz = [
    ['NÍVEL', 'CÓDIGO', 'DESCRIÇÃO', 'NÍVEL', 'CÓDIGO', 'DESCRIÇÃO', 'CUSTO PROJETADO\n(l) = (i) + (k)'],
    ['01', 'x', 'N1', 'N1', '01.01', 'SERVIÇOS', 1000],
    ['01.01.01.01', 'VB', 'N4', 'N4', '01.01.01.01.001', 'CIP', 1335],
    ['01.01.01.01.001', 389, 'M2', 'N5', '01.01.01.01.001', 'LEVANTAMENTO', 100.5],
    ['01.01.01.01.001 A', 470, 'VB', 'N5', '01.01.01.01.001', 'ITENS FORA DE ORÇAMENTO', '1.234,50'],
    ['', '', '', 'N4', '01.01.01.01.02', 'FORMATO PREVISION', '10'],
    ['', '', '', 'N4', '01.01.01.01.003', 'VAZIO', null],
    ['', '', '', 'N4', '01.01.01.01.004', 'TEXTO', 'abc'],
  ]
  const r = lerCustoProjetado(matriz)
  assert.deepEqual(r.itens, [
    { codigo_etapa: '01.01.01.01.001', custo_projetado: 1335 },
    { codigo_etapa: '01.01.01.01.002', custo_projetado: 10 },
  ])
  assert.equal(r.total, 1345)
  assert.equal(r.ignoradas, 1)
  assert.deepEqual(r.erros, [{ linha: 8, motivo: 'custo projetado inválido: "abc"' }])
})

test('lerCustoProjetado: planilha simples sem NÍVEL soma códigos repetidos e aceita "1.234,56"', () => {
  const r = lerCustoProjetado([
    ['ETAPA', 'CUSTO PROJETADO'],
    ['01.01.01.01.001', 10],
    ['01.01.01.01.001', '1.234,56'],
  ])
  assert.deepEqual(r.itens, [{ codigo_etapa: '01.01.01.01.001', custo_projetado: 1244.56 }])
  assert.deepEqual(r.erros, [])
})

test('lerCustoProjetado: sem as colunas necessárias devolve erro claro', () => {
  const r = lerCustoProjetado([['A', 'B'], [1, 2]])
  assert.deepEqual(r.erros, [{ linha: 0, motivo: 'colunas "CÓDIGO" (ou "ETAPA") e "CUSTO PROJETADO" não encontradas' }])
  assert.deepEqual(r.itens, [])
})
```

Add to `package.json` scripts: `"test:server": "node --test server/"`

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:server`
Expected: FAIL — `Cannot find module ... contratacoes.js`

- [ ] **Step 3: Implementar**

```js
// server/contratacoes.js
// Regras puras da Gestão de Contratações (sem banco). Ver
// docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md

export function normalizarNome(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim()
}

export function nivelDoCodigo(codigo) {
  return String(codigo).split('.').length
}

// Mega: XX.XX.XX.XX.XXX. Prevision: XX.XX.XX.XX.XX (soma um zero à esquerda do último nível).
export function etapaParaMega(codigo) {
  const c = String(codigo ?? '').trim()
  if (/^\d{2}(\.\d{2}){3}\.\d{2,3}$/.test(c)) {
    const partes = c.split('.')
    partes[4] = partes[4].padStart(3, '0')
    return partes.join('.')
  }
  if (/^\d{2}(\.\d{2}){3}$/.test(c)) return c
  return null
}

function filhosNivel5(prefixo, orcamento) {
  return [...orcamento.keys()]
    .filter((c) => nivelDoCodigo(c) === 5 && c.startsWith(prefixo + '.'))
    .sort()
}

export function expandirParaNivel5(codigos, orcamento) {
  const saida = []
  const vistos = new Set()
  for (const bruto of codigos) {
    const codigo = etapaParaMega(bruto)
    if (!codigo) continue
    const itens = nivelDoCodigo(codigo) === 4
      ? filhosNivel5(codigo, orcamento).map((c) => ({ codigo_etapa: c, origem_nivel4: codigo }))
      : orcamento.has(codigo) ? [{ codigo_etapa: codigo, origem_nivel4: null }] : []
    for (const i of itens) {
      if (vistos.has(i.codigo_etapa)) continue
      vistos.add(i.codigo_etapa)
      saida.push(i)
    }
  }
  return saida
}

// Nível 5 explícito vence expansão de nível 4; entre iguais, vence o grupo de menor ordem.
export function resolverEtapasPadrao(gruposPadrao, orcamento) {
  const candidatos = []
  for (const g of [...gruposPadrao].sort((a, b) => a.ordem - b.ordem)) {
    for (const e of g.etapas) {
      const codigo = etapaParaMega(e.codigo)
      if (!codigo || !orcamento.has(codigo)) continue
      const bate = normalizarNome(e.nome) === normalizarNome(orcamento.get(codigo))
      const situacao = bate ? 'CONFIRMADO' : 'SUGERIDO'
      if (nivelDoCodigo(codigo) === 4) {
        for (const filho of filhosNivel5(codigo, orcamento)) {
          candidatos.push({ ordem: g.ordem, codigo_etapa: filho, situacao, nome_padrao: e.nome,
            nome_obra: orcamento.get(filho), origem_nivel4: codigo, prioridade: 1 })
        }
      } else {
        candidatos.push({ ordem: g.ordem, codigo_etapa: codigo, situacao, nome_padrao: e.nome,
          nome_obra: orcamento.get(codigo), origem_nivel4: null, prioridade: 0 })
      }
    }
  }
  candidatos.sort((a, b) => a.prioridade - b.prioridade || a.ordem - b.ordem)
  const escolhidos = new Map()
  const conflitos = []
  for (const c of candidatos) {
    if (escolhidos.has(c.codigo_etapa)) {
      if (escolhidos.get(c.codigo_etapa).ordem !== c.ordem) conflitos.push({ codigo_etapa: c.codigo_etapa, ordem: c.ordem })
      continue
    }
    escolhidos.set(c.codigo_etapa, c)
  }
  const vinculos = [...escolhidos.values()]
    .sort((a, b) => a.ordem - b.ordem || a.codigo_etapa.localeCompare(b.codigo_etapa))
    .map(({ prioridade, ...v }) => v)
  return { vinculos, conflitos }
}

export function sugestoesPorNome(pendencias, etapasPadrao) {
  const porNome = new Map()
  for (const e of etapasPadrao) {
    const n = normalizarNome(e.nome)
    if (n && !porNome.has(n)) porNome.set(n, e)
  }
  const saida = new Map()
  for (const p of pendencias) {
    const e = porNome.get(normalizarNome(p.nome))
    if (e && e.codigo !== p.codigo) saida.set(p.codigo, { ordem: e.ordem, codigo_padrao: e.codigo })
  }
  return saida
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return { vazio: true }
  if (typeof valor === 'number') return { numero: valor }
  const t = String(valor).trim().replace(/\s/g, '')
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normal)
  return Number.isFinite(n) ? { numero: n } : { invalido: true }
}

export function lerCustoProjetado(matriz) {
  const primeiraLinha = (v) => normalizarNome(String(v ?? '').split('\n')[0])
  let cab = -1, colCusto = -1, colCodigo = -1, colNivel = -1
  for (let i = 0; i < Math.min(matriz.length, 20) && cab < 0; i++) {
    const linha = matriz[i] || []
    const custo = linha.findIndex((v) => primeiraLinha(v).startsWith('CUSTO PROJETADO'))
    if (custo < 0) continue
    for (let j = custo - 1; j >= 0; j--) {
      const n = primeiraLinha(linha[j])
      if (n === 'CODIGO' || n === 'ETAPA' || n === 'ETAPA DE ORCAMENTO') { colCodigo = j; break }
    }
    if (colCodigo < 0) continue
    for (let j = colCodigo - 1; j >= 0; j--) {
      if (primeiraLinha(linha[j]) === 'NIVEL') { colNivel = j; break }
    }
    cab = i; colCusto = custo
  }
  if (cab < 0) {
    return { itens: [], total: 0, ignoradas: 0,
      erros: [{ linha: 0, motivo: 'colunas "CÓDIGO" (ou "ETAPA") e "CUSTO PROJETADO" não encontradas' }] }
  }
  // Por etapa: {menorNivel, soma}. Com coluna NÍVEL, só as linhas de menor N
  // contam (a linha N4 já é o total das N5 do mesmo código). Sem ela, soma tudo.
  const porEtapa = new Map()
  const erros = []
  let ignoradas = 0
  for (let i = cab + 1; i < matriz.length; i++) {
    const linha = matriz[i] || []
    const codigo = etapaParaMega(linha[colCodigo])
    if (!codigo || nivelDoCodigo(codigo) !== 5) continue
    const v = paraNumero(linha[colCusto])
    if (v.vazio) { ignoradas++; continue }
    if (v.invalido) { erros.push({ linha: i + 1, motivo: `custo projetado inválido: "${linha[colCusto]}"` }); continue }
    const nivel = colNivel >= 0 ? Number(String(linha[colNivel] ?? '').replace(/\D/g, '')) || 99 : 0
    const atual = porEtapa.get(codigo)
    if (!atual || nivel < atual.nivel) porEtapa.set(codigo, { nivel, soma: v.numero })
    else if (nivel === atual.nivel) atual.soma += v.numero
  }
  const itens = [...porEtapa.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo_etapa, { soma }]) => ({ codigo_etapa, custo_projetado: Math.round(soma * 100) / 100 }))
  const total = Math.round(itens.reduce((s, i) => s + i.custo_projetado, 0) * 100) / 100
  return { itens, total, ignoradas, erros }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm run test:server`
Expected: PASS (10 testes)

- [ ] **Step 5: Commit**

```bash
git add server/contratacoes.js server/contratacoes.test.js package.json
git commit -m "feat(contratacoes): regras puras de etapas, padrao e custo projetado com testes"
```

---

### Task 3: Tabelas e carga do padrão

**Files:**
- Modify: `server/schema.sql` (final do arquivo)
- Create: `server/contratacoes-db.js` (função `carregarPadraoSeVazio`)
- Modify: `server/db.js` (`initDb`)

**Interfaces:**
- Consumes: `server/contratacoes-padrao.json` (Task 1)
- Produces: tabelas `contratacao_grupos`, `contratacao_grupo_etapas`, `custo_projetado_importacoes`, `custo_projetado_itens`, `aprovacao_alcadas`; `carregarPadraoSeVazio(): Promise<number>` (grupos inseridos, 0 se já existia)

- [ ] **Step 1: Acrescentar ao `server/schema.sql`**

```sql
-- ---------------------------------------------------------------------------
-- Gestão de Contratações (ver docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md)
-- projeto_id NULL = padrão; obra recebe cópia do padrão.
CREATE TABLE IF NOT EXISTS contratacao_grupos (
  id SERIAL PRIMARY KEY,
  projeto_id TEXT,
  padrao_grupo_id INTEGER,
  tipo TEXT NOT NULL CHECK (tipo IN ('MATERIAL', 'MAO_DE_OBRA')),
  item TEXT NOT NULL,
  insumos TEXT,
  pacote_servicos TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  prazo_levantamento INTEGER NOT NULL DEFAULT 0,
  prazo_solicitacao INTEGER NOT NULL DEFAULT 0,
  prazo_negociacao INTEGER NOT NULL DEFAULT 0,
  prazo_emissao INTEGER NOT NULL DEFAULT 0,
  prazo_entrega INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contratacao_grupos_projeto ON contratacao_grupos (projeto_id);

-- Padrão guarda o código como na planilha (nível 4 ou 5); obra guarda nível 5 expandido.
CREATE TABLE IF NOT EXISTS contratacao_grupo_etapas (
  id SERIAL PRIMARY KEY,
  grupo_id INTEGER NOT NULL REFERENCES contratacao_grupos (id) ON DELETE CASCADE,
  projeto_id TEXT,
  codigo_etapa TEXT NOT NULL,
  nivel INTEGER NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'CONFIRMADO' CHECK (situacao IN ('CONFIRMADO', 'SUGERIDO')),
  nome_padrao TEXT,
  nome_obra TEXT,
  origem_nivel4 TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contratacao_etapa_obra
  ON contratacao_grupo_etapas (projeto_id, codigo_etapa) WHERE projeto_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS custo_projetado_importacoes (
  id SERIAL PRIMARY KEY,
  projeto_id TEXT NOT NULL,
  referencia DATE NOT NULL,
  arquivo TEXT,
  total NUMERIC NOT NULL DEFAULT 0,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custo_projetado_imp_projeto ON custo_projetado_importacoes (projeto_id, importado_em DESC);

CREATE TABLE IF NOT EXISTS custo_projetado_itens (
  importacao_id INTEGER NOT NULL REFERENCES custo_projetado_importacoes (id) ON DELETE CASCADE,
  codigo_etapa TEXT NOT NULL,
  custo_projetado NUMERIC NOT NULL,
  PRIMARY KEY (importacao_id, codigo_etapa)
);

CREATE TABLE IF NOT EXISTS aprovacao_alcadas (
  id SERIAL PRIMARY KEY,
  tipo_documento TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  valor_minimo NUMERIC NOT NULL DEFAULT 0,
  aprovador TEXT NOT NULL,
  substituto TEXT,
  UNIQUE (tipo_documento, ordem)
);
INSERT INTO aprovacao_alcadas (tipo_documento, ordem, valor_minimo, aprovador, substituto) VALUES
  ('Pedido de Compra', 1, 0, 'Luis Bronqueti', NULL),
  ('Pedido de Compra', 2, 50000, 'Rafael Medeiros', 'Ricardo Kitamura'),
  ('Pedido de Compra', 3, 100000, 'Filipe Biscaia Demeterco', NULL),
  ('Contrato de Cotação e Materiais', 1, 0, 'Luis Bronqueti', 'Natalia Barbosa A'),
  ('Contrato de Cotação e Materiais', 2, 50000, 'Rafael Medeiros', 'Ricardo Kitamura'),
  ('Contrato de Cotação e Materiais', 3, 100000, 'Filipe Biscaia Demeterco', NULL)
ON CONFLICT (tipo_documento, ordem) DO NOTHING;
```

- [ ] **Step 2: Criar `server/contratacoes-db.js` com a carga do padrão**

```js
// server/contratacoes-db.js
// Acesso a banco da Gestão de Contratações. Regras puras em ./contratacoes.js.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { query, withTransaction } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PADRAO = JSON.parse(fs.readFileSync(path.join(__dirname, 'contratacoes-padrao.json'), 'utf8'))

export async function carregarPadraoSeVazio() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM contratacao_grupos WHERE projeto_id IS NULL')
  if (rows[0].n > 0) return 0
  await withTransaction(async (q) => {
    for (const g of PADRAO.grupos) {
      const { rows: [novo] } = await q(
        `INSERT INTO contratacao_grupos (projeto_id, tipo, item, insumos, pacote_servicos, ordem,
           prazo_levantamento, prazo_solicitacao, prazo_negociacao, prazo_emissao, prazo_entrega)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [g.tipo, g.item, g.insumos, g.pacote_servicos, g.ordem, g.prazos.levantamento,
          g.prazos.solicitacao, g.prazos.negociacao, g.prazos.emissao, g.prazos.entrega],
      )
      for (const e of g.etapas) {
        await q(
          `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, nome_padrao)
           VALUES ($1, NULL, $2, $3, $4)`,
          [novo.id, e.codigo, e.nivel, e.nome],
        )
      }
    }
  })
  return PADRAO.grupos.length
}
```

- [ ] **Step 3: Chamar no `initDb` de `server/db.js`**

Em `server/db.js`, ao final de `initDb()` (depois de `await query(schemaSql)`), usar import dinâmico para evitar ciclo de import:

```js
  const { carregarPadraoSeVazio } = await import('./contratacoes-db.js')
  const grupos = await carregarPadraoSeVazio()
  if (grupos) console.log(`Padrão de grupos de contratação carregado: ${grupos} grupos.`)
```

- [ ] **Step 4: Verificar sintaxe e testes**

Run: `node --check server/contratacoes-db.js && node --check server/db.js && npm run test:server`
Expected: sem erros; testes PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schema.sql server/contratacoes-db.js server/db.js
git commit -m "feat(contratacoes): tabelas, alcadas iniciais e carga do padrao no initDb"
```

---

### Task 4: Consultas e gravações da configuração

**Files:**
- Modify: `server/contratacoes-db.js`

**Interfaces:**
- Consumes: regras da Task 2; tabelas da Task 3; `pesos_orcamento` (`projeto_id`, `codigo`, `descricao`), `cff_itens` (`projeto_id`, `codigo`, `descricao`).
- Produces (exportadas):
  - `obterConfig(projetoId): Promise<{ aplicado: boolean, grupos: Grupo[], pendencias: Pendencia[], importacao: {id, referencia, total, importado_em, arquivo} | null, orcamentoTotal: number }>`
    - `Grupo = {id, tipo, item, insumos, pacote_servicos, ordem, prazo_levantamento, prazo_solicitacao, prazo_negociacao, prazo_emissao, prazo_entrega, etapas: {codigo_etapa, situacao, nome_padrao, nome_obra, origem_nivel4, custo_projetado}[]}`
    - `Pendencia = {codigo_etapa, nome, custo_projetado, sugestao: {grupo_id, item, codigo_padrao} | null}`
  - `aplicarPadrao(projetoId, { restaurar }): Promise<{ grupos: number, vinculos: number, sugeridos: number, conflitos: number }>`
  - `salvarGrupo(projetoId, grupo): Promise<{id}>` (cria se `grupo.id` ausente; senão atualiza)
  - `excluirGrupo(projetoId, grupoId): Promise<void>`
  - `atrelarEtapas(projetoId, grupoId, codigos, { mover }): Promise<{ inseridas: number, conflitos: {codigo_etapa, grupo_id, item}[] }>` — se houver conflitos e `mover` falso, não grava nada
  - `soltarEtapa(projetoId, codigo): Promise<void>`
  - `confirmarEtapa(projetoId, codigo): Promise<void>`
  - `previaCusto(projetoId, matriz): Promise<{ itens, total, ignoradas, erros, foraDoOrcamento: string[], totalAnterior: number | null }>`
  - `importarCusto(projetoId, { referencia, arquivo, matriz }): Promise<{ id, total, itens: number }>` — recusa se `erros.length > 0`

- [ ] **Step 1: Implementar**

Acrescentar a `server/contratacoes-db.js`:

```js
import {
  etapaParaMega, nivelDoCodigo, resolverEtapasPadrao, expandirParaNivel5,
  sugestoesPorNome, lerCustoProjetado,
} from './contratacoes.js'

const COD_ORCAMENTO = String.raw`^\d{2}(\.\d{2}){3}(\.\d{2,3})?$`

// Orçamento da obra (níveis 4 e 5) no formato Mega: Map<codigo, nome>.
export async function orcamentoDaObra(projetoId) {
  const { rows } = await query(
    `SELECT codigo, MAX(descricao) AS descricao FROM (
       SELECT codigo, descricao FROM pesos_orcamento WHERE projeto_id = $1 AND codigo ~ '${COD_ORCAMENTO}'
       UNION ALL
       SELECT codigo, descricao FROM cff_itens WHERE projeto_id = $1 AND codigo ~ '${COD_ORCAMENTO}'
     ) o GROUP BY codigo`,
    [projetoId],
  )
  const mapa = new Map()
  for (const r of rows) {
    const c = etapaParaMega(r.codigo)
    if (c && !mapa.has(c)) mapa.set(c, r.descricao || '')
  }
  return mapa
}

async function ultimaImportacao(projetoId) {
  const { rows } = await query(
    `SELECT id, referencia, total, importado_em, arquivo FROM custo_projetado_importacoes
     WHERE projeto_id = $1 ORDER BY importado_em DESC LIMIT 1`, [projetoId])
  return rows[0] || null
}

async function custosDaImportacao(importacaoId) {
  if (!importacaoId) return new Map()
  const { rows } = await query('SELECT codigo_etapa, custo_projetado FROM custo_projetado_itens WHERE importacao_id = $1', [importacaoId])
  return new Map(rows.map((r) => [r.codigo_etapa, Number(r.custo_projetado)]))
}

export async function obterConfig(projetoId) {
  const [orcamento, importacao, gruposRes, etapasRes, padraoRes] = await Promise.all([
    orcamentoDaObra(projetoId),
    ultimaImportacao(projetoId),
    query('SELECT * FROM contratacao_grupos WHERE projeto_id = $1 ORDER BY ordem, id', [projetoId]),
    query('SELECT * FROM contratacao_grupo_etapas WHERE projeto_id = $1 ORDER BY codigo_etapa', [projetoId]),
    query(`SELECT e.codigo_etapa, e.nome_padrao, g.ordem, g.id AS padrao_id FROM contratacao_grupo_etapas e
           JOIN contratacao_grupos g ON g.id = e.grupo_id WHERE e.projeto_id IS NULL`),
  ])
  const custos = await custosDaImportacao(importacao?.id)
  const porGrupo = new Map()
  const usadas = new Set()
  for (const e of etapasRes.rows) {
    usadas.add(e.codigo_etapa)
    if (!porGrupo.has(e.grupo_id)) porGrupo.set(e.grupo_id, [])
    porGrupo.get(e.grupo_id).push({ ...e, custo_projetado: custos.get(e.codigo_etapa) ?? null })
  }
  const grupos = gruposRes.rows.map((g) => ({ ...g, etapas: porGrupo.get(g.id) || [] }))
  const pendBase = [...orcamento.entries()]
    .filter(([c]) => nivelDoCodigo(c) === 5 && !usadas.has(c))
    .map(([codigo, nome]) => ({ codigo, nome }))
  const sugestoes = sugestoesPorNome(pendBase,
    padraoRes.rows.map((r) => ({ codigo: r.codigo_etapa, nome: r.nome_padrao, ordem: r.ordem })))
  const grupoPorPadraoOrdem = new Map()
  const ordemPorPadraoId = new Map(padraoRes.rows.map((r) => [r.padrao_id, r.ordem]))
  for (const g of grupos) {
    const ordemPadrao = ordemPorPadraoId.get(g.padrao_grupo_id)
    if (ordemPadrao !== undefined) grupoPorPadraoOrdem.set(ordemPadrao, g)
  }
  const pendencias = pendBase.map((p) => {
    const s = sugestoes.get(p.codigo)
    const g = s ? grupoPorPadraoOrdem.get(s.ordem) : null
    return {
      codigo_etapa: p.codigo, nome: p.nome, custo_projetado: custos.get(p.codigo) ?? null,
      sugestao: g ? { grupo_id: g.id, item: g.item, codigo_padrao: s.codigo_padrao } : null,
    }
  }).sort((a, b) => (b.custo_projetado ?? -1) - (a.custo_projetado ?? -1) || a.codigo_etapa.localeCompare(b.codigo_etapa))
  const orcamentoTotal = [...custos.values()].reduce((s, v) => s + v, 0)
  return { aplicado: grupos.length > 0, grupos, pendencias, importacao, orcamentoTotal }
}

export async function aplicarPadrao(projetoId, { restaurar = false } = {}) {
  const orcamento = await orcamentoDaObra(projetoId)
  const { rows: padrao } = await query('SELECT * FROM contratacao_grupos WHERE projeto_id IS NULL ORDER BY ordem')
  const { rows: etapasPadrao } = await query('SELECT * FROM contratacao_grupo_etapas WHERE projeto_id IS NULL')
  const gruposPadrao = padrao.map((g) => ({
    ordem: g.ordem,
    etapas: etapasPadrao.filter((e) => e.grupo_id === g.id)
      .map((e) => ({ codigo: e.codigo_etapa, nivel: e.nivel, nome: e.nome_padrao })),
  }))
  const { vinculos, conflitos } = resolverEtapasPadrao(gruposPadrao, orcamento)
  return withTransaction(async (q) => {
    const { rows: [{ n }] } = await q('SELECT COUNT(*)::int AS n FROM contratacao_grupos WHERE projeto_id = $1', [projetoId])
    if (n > 0 && !restaurar) throw Object.assign(new Error('A obra já tem grupos. Use "Restaurar padrão" para substituir.'), { status: 409 })
    await q('DELETE FROM contratacao_grupos WHERE projeto_id = $1', [projetoId])
    const idPorOrdem = new Map()
    for (const g of padrao) {
      const { rows: [novo] } = await q(
        `INSERT INTO contratacao_grupos (projeto_id, padrao_grupo_id, tipo, item, insumos, pacote_servicos, ordem,
           prazo_levantamento, prazo_solicitacao, prazo_negociacao, prazo_emissao, prazo_entrega)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [projetoId, g.id, g.tipo, g.item, g.insumos, g.pacote_servicos, g.ordem, g.prazo_levantamento,
          g.prazo_solicitacao, g.prazo_negociacao, g.prazo_emissao, g.prazo_entrega],
      )
      idPorOrdem.set(g.ordem, novo.id)
    }
    for (const v of vinculos) {
      await q(
        `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, situacao, nome_padrao, nome_obra, origem_nivel4)
         VALUES ($1,$2,$3,5,$4,$5,$6,$7)`,
        [idPorOrdem.get(v.ordem), projetoId, v.codigo_etapa, v.situacao, v.nome_padrao, v.nome_obra, v.origem_nivel4],
      )
    }
    return { grupos: padrao.length, vinculos: vinculos.length,
      sugeridos: vinculos.filter((v) => v.situacao === 'SUGERIDO').length, conflitos: conflitos.length }
  })
}

const CAMPOS_GRUPO = ['tipo', 'item', 'insumos', 'pacote_servicos', 'ordem', 'prazo_levantamento',
  'prazo_solicitacao', 'prazo_negociacao', 'prazo_emissao', 'prazo_entrega']

export async function salvarGrupo(projetoId, grupo) {
  if (!grupo.item || !String(grupo.item).trim()) throw Object.assign(new Error('Informe o nome do grupo.'), { status: 400 })
  if (!['MATERIAL', 'MAO_DE_OBRA'].includes(grupo.tipo)) throw Object.assign(new Error('Tipo deve ser MATERIAL ou MAO_DE_OBRA.'), { status: 400 })
  const valores = CAMPOS_GRUPO.map((c) => (c.startsWith('prazo_') || c === 'ordem' ? Math.max(0, Number(grupo[c]) || 0) : grupo[c] ?? null))
  if (grupo.id) {
    const sets = CAMPOS_GRUPO.map((c, i) => `${c} = $${i + 3}`).join(', ')
    const { rowCount } = await query(
      `UPDATE contratacao_grupos SET ${sets}, atualizado_em = NOW() WHERE id = $1 AND projeto_id = $2`,
      [grupo.id, projetoId, ...valores])
    if (!rowCount) throw Object.assign(new Error('Grupo não encontrado nesta obra.'), { status: 404 })
    return { id: grupo.id }
  }
  const { rows: [novo] } = await query(
    `INSERT INTO contratacao_grupos (projeto_id, ${CAMPOS_GRUPO.join(', ')})
     VALUES ($1, ${CAMPOS_GRUPO.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
    [projetoId, ...valores])
  return { id: novo.id }
}

export async function excluirGrupo(projetoId, grupoId) {
  await query('DELETE FROM contratacao_grupos WHERE id = $1 AND projeto_id = $2', [grupoId, projetoId])
}

export async function atrelarEtapas(projetoId, grupoId, codigos, { mover = false } = {}) {
  const orcamento = await orcamentoDaObra(projetoId)
  const alvo = expandirParaNivel5(codigos, orcamento)
  if (!alvo.length) return { inseridas: 0, conflitos: [] }
  return withTransaction(async (q) => {
    const { rows: [grupo] } = await q('SELECT id FROM contratacao_grupos WHERE id = $1 AND projeto_id = $2', [grupoId, projetoId])
    if (!grupo) throw Object.assign(new Error('Grupo não encontrado nesta obra.'), { status: 404 })
    const { rows: existentes } = await q(
      `SELECT e.codigo_etapa, e.grupo_id, g.item FROM contratacao_grupo_etapas e JOIN contratacao_grupos g ON g.id = e.grupo_id
       WHERE e.projeto_id = $1 AND e.codigo_etapa = ANY($2) AND e.grupo_id <> $3`,
      [projetoId, alvo.map((a) => a.codigo_etapa), grupoId])
    if (existentes.length && !mover) return { inseridas: 0, conflitos: existentes }
    await q('DELETE FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND codigo_etapa = ANY($2)',
      [projetoId, alvo.map((a) => a.codigo_etapa)])
    for (const a of alvo) {
      await q(
        `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, situacao, nome_obra, origem_nivel4)
         VALUES ($1,$2,$3,5,'CONFIRMADO',$4,$5)`,
        [grupoId, projetoId, a.codigo_etapa, orcamento.get(a.codigo_etapa) || '', a.origem_nivel4])
    }
    return { inseridas: alvo.length, conflitos: [] }
  })
}

export async function soltarEtapa(projetoId, codigo) {
  await query('DELETE FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND codigo_etapa = $2', [projetoId, codigo])
}

export async function confirmarEtapa(projetoId, codigo) {
  await query(`UPDATE contratacao_grupo_etapas SET situacao = 'CONFIRMADO' WHERE projeto_id = $1 AND codigo_etapa = $2`, [projetoId, codigo])
}

export async function previaCusto(projetoId, matriz) {
  const lido = lerCustoProjetado(matriz)
  const orcamento = await orcamentoDaObra(projetoId)
  const anterior = await ultimaImportacao(projetoId)
  return {
    ...lido,
    foraDoOrcamento: lido.itens.map((i) => i.codigo_etapa).filter((c) => !orcamento.has(c)),
    totalAnterior: anterior ? Number(anterior.total) : null,
  }
}

export async function importarCusto(projetoId, { referencia, arquivo, matriz }) {
  if (!/^\d{4}-\d{2}$/.test(String(referencia || ''))) throw Object.assign(new Error('Informe o mês de referência (AAAA-MM).'), { status: 400 })
  const lido = lerCustoProjetado(matriz)
  if (lido.erros.length) throw Object.assign(new Error(`A planilha tem ${lido.erros.length} erro(s); corrija e envie de novo.`), { status: 400 })
  if (!lido.itens.length) throw Object.assign(new Error('Nenhuma etapa de nível 5 com custo projetado encontrada.'), { status: 400 })
  return withTransaction(async (q) => {
    const { rows: [imp] } = await q(
      `INSERT INTO custo_projetado_importacoes (projeto_id, referencia, arquivo, total) VALUES ($1, $2, $3, $4) RETURNING id`,
      [projetoId, `${referencia}-01`, arquivo || null, lido.total])
    for (const i of lido.itens) {
      await q('INSERT INTO custo_projetado_itens (importacao_id, codigo_etapa, custo_projetado) VALUES ($1,$2,$3)',
        [imp.id, i.codigo_etapa, i.custo_projetado])
    }
    return { id: imp.id, total: lido.total, itens: lido.itens.length }
  })
}
```

Mover o `import { etapaParaMega, ... } from './contratacoes.js'` para o topo do arquivo, junto dos outros imports.

- [ ] **Step 2: Verificar sintaxe e testes**

Run: `node --check server/contratacoes-db.js && npm run test:server`
Expected: sem erros; PASS.

- [ ] **Step 3: Commit**

```bash
git add server/contratacoes-db.js
git commit -m "feat(contratacoes): consultas e gravacoes da configuracao e importacao"
```

---

### Task 5: Rotas da API

**Files:**
- Modify: `server/index.js` (imports e rotas, perto das rotas `/api/mega/*`)

**Interfaces:**
- Consumes: exportações da Task 4.
- Produces:
  - `GET  /api/contratacoes/config?projectId=` → `obterConfig`
  - `POST /api/contratacoes/aplicar-padrao` body `{projectId, restaurar}`
  - `POST /api/contratacoes/grupos` body `{projectId, grupo}` (cria ou atualiza)
  - `DELETE /api/contratacoes/grupos/:id?projectId=`
  - `POST /api/contratacoes/grupos/:id/etapas` body `{projectId, codigos, mover}` → 409 `{conflitos}` quando houver conflito sem mover
  - `DELETE /api/contratacoes/etapas/:codigo?projectId=`
  - `POST /api/contratacoes/etapas/:codigo/confirmar` body `{projectId}`
  - `POST /api/contratacoes/custo/previa` body `{projectId, matriz}`
  - `POST /api/contratacoes/custo/importar` body `{projectId, referencia, arquivo, matriz}`

- [ ] **Step 1: Implementar**

Acrescentar os imports no topo de `server/index.js`:

```js
import {
  obterConfig, aplicarPadrao, salvarGrupo, excluirGrupo, atrelarEtapas,
  soltarEtapa, confirmarEtapa, previaCusto, importarCusto,
} from './contratacoes-db.js'
```

E as rotas, depois de `/api/mega/data`:

```js
// ---- Gestão de Contratações --------------------------------------------
const exigirProjeto = (valor) => {
  const id = String(valor || '').trim()
  if (!id) throw Object.assign(new Error('projectId é obrigatório.'), { status: 400 })
  return id
}
const rota = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req, res)) })
  } catch (err) {
    if (!err.status) console.error(`Erro em ${req.method} ${req.path}:`, err)
    res.status(err.status || 500).json({ error: err.message || 'Erro na Gestão de Contratações' })
  }
}

app.get('/api/contratacoes/config', rota((req) => obterConfig(exigirProjeto(req.query.projectId))))
app.post('/api/contratacoes/aplicar-padrao', rota((req) =>
  aplicarPadrao(exigirProjeto(req.body?.projectId), { restaurar: Boolean(req.body?.restaurar) })))
app.post('/api/contratacoes/grupos', rota((req) =>
  salvarGrupo(exigirProjeto(req.body?.projectId), req.body?.grupo || {})))
app.delete('/api/contratacoes/grupos/:id', rota(async (req) => {
  await excluirGrupo(exigirProjeto(req.query.projectId), Number(req.params.id))
  return {}
}))
app.post('/api/contratacoes/grupos/:id/etapas', rota(async (req, res) => {
  const r = await atrelarEtapas(exigirProjeto(req.body?.projectId), Number(req.params.id),
    Array.isArray(req.body?.codigos) ? req.body.codigos : [], { mover: Boolean(req.body?.mover) })
  if (r.conflitos.length) res.status(409)
  return r
}))
app.delete('/api/contratacoes/etapas/:codigo', rota(async (req) => {
  await soltarEtapa(exigirProjeto(req.query.projectId), req.params.codigo)
  return {}
}))
app.post('/api/contratacoes/etapas/:codigo/confirmar', rota(async (req) => {
  await confirmarEtapa(exigirProjeto(req.body?.projectId), req.params.codigo)
  return {}
}))
app.post('/api/contratacoes/custo/previa', rota((req) =>
  previaCusto(exigirProjeto(req.body?.projectId), Array.isArray(req.body?.matriz) ? req.body.matriz : [])))
app.post('/api/contratacoes/custo/importar', rota((req) =>
  importarCusto(exigirProjeto(req.body?.projectId), {
    referencia: req.body?.referencia, arquivo: req.body?.arquivo,
    matriz: Array.isArray(req.body?.matriz) ? req.body.matriz : [],
  })))
```

Note: a 409 de conflito responde `{ ok: true, inseridas: 0, conflitos: [...] }` com status 409 — o front trata pelo status.

- [ ] **Step 2: Verificar**

Run: `node --check server/index.js && npm run test:server`
Expected: sem erros; PASS.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(contratacoes): rotas da API de configuracao e custo projetado"
```

---

### Task 6: Tela de configuração e ligação na Gestão à Vista

**Files:**
- Create: `src/components/contratacoes/contratacoes-api.ts`
- Create: `src/components/contratacoes/ContratacoesConfig.tsx`
- Create: `src/components/contratacoes/ContratacoesConfig.css`
- Modify: `src/App.tsx` (tipo `GestaoPanelTab` na linha 59; botões por volta da linha 3923; render perto de `gestaoPanelTab === 'panel5'` na linha 4649)

**Interfaces:**
- Consumes: rotas da Task 5.
- Produces: `<ContratacoesConfig projectId={string} />`.

- [ ] **Step 1: Cliente da API**

```ts
// src/components/contratacoes/contratacoes-api.ts
export type Tipo = 'MATERIAL' | 'MAO_DE_OBRA'
export interface EtapaGrupo { codigo_etapa: string; situacao: 'CONFIRMADO' | 'SUGERIDO'; nome_padrao: string | null; nome_obra: string | null; origem_nivel4: string | null; custo_projetado: number | null }
export interface Grupo { id?: number; tipo: Tipo; item: string; insumos: string | null; pacote_servicos: string | null; ordem: number; prazo_levantamento: number; prazo_solicitacao: number; prazo_negociacao: number; prazo_emissao: number; prazo_entrega: number; etapas?: EtapaGrupo[] }
export interface Pendencia { codigo_etapa: string; nome: string; custo_projetado: number | null; sugestao: { grupo_id: number; item: string; codigo_padrao: string } | null }
export interface Config { aplicado: boolean; grupos: Grupo[]; pendencias: Pendencia[]; importacao: { referencia: string; total: string; importado_em: string; arquivo: string | null } | null; orcamentoTotal: number }
export interface Previa { itens: { codigo_etapa: string; custo_projetado: number }[]; total: number; ignoradas: number; erros: { linha: number; motivo: string }[]; foraDoOrcamento: string[]; totalAnterior: number | null }
export interface Conflito { codigo_etapa: string; grupo_id: number; item: string }

async function chamar<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 409) throw new Error(data.error || `Erro ${res.status}`)
  return { status: res.status, data }
}
const post = <T>(url: string, body: unknown) => chamar<T>(url, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  config: (projectId: string) => chamar<Config>(`/api/contratacoes/config?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
  aplicarPadrao: (projectId: string, restaurar = false) => post<{ grupos: number; vinculos: number; sugeridos: number; conflitos: number }>('/api/contratacoes/aplicar-padrao', { projectId, restaurar }).then((r) => r.data),
  salvarGrupo: (projectId: string, grupo: Grupo) => post<{ id: number }>('/api/contratacoes/grupos', { projectId, grupo }).then((r) => r.data),
  excluirGrupo: (projectId: string, id: number) => chamar(`/api/contratacoes/grupos/${id}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  atrelar: (projectId: string, grupoId: number, codigos: string[], mover = false) => post<{ inseridas: number; conflitos: Conflito[] }>(`/api/contratacoes/grupos/${grupoId}/etapas`, { projectId, codigos, mover }).then((r) => r.data),
  soltar: (projectId: string, codigo: string) => chamar(`/api/contratacoes/etapas/${encodeURIComponent(codigo)}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  confirmar: (projectId: string, codigo: string) => post(`/api/contratacoes/etapas/${encodeURIComponent(codigo)}/confirmar`, { projectId }),
  previa: (projectId: string, matriz: unknown[][]) => post<Previa>('/api/contratacoes/custo/previa', { projectId, matriz }).then((r) => r.data),
  importar: (projectId: string, referencia: string, arquivo: string, matriz: unknown[][]) => post<{ id: number; total: number; itens: number }>('/api/contratacoes/custo/importar', { projectId, referencia, arquivo, matriz }).then((r) => r.data),
}
```

- [ ] **Step 2: Componente**

```tsx
// src/components/contratacoes/ContratacoesConfig.tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { api, type Config, type Conflito, type Grupo, type Previa, type Tipo } from './contratacoes-api'
import './ContratacoesConfig.css'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : moeda.format(v))
const TIPO_LABEL: Record<Tipo, string> = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de obra' }
const PRAZOS: { campo: keyof Grupo; label: string }[] = [
  { campo: 'prazo_levantamento', label: 'Levant.' }, { campo: 'prazo_solicitacao', label: 'Solicit.' },
  { campo: 'prazo_negociacao', label: 'Negoc.' }, { campo: 'prazo_emissao', label: 'Emissão' },
  { campo: 'prazo_entrega', label: 'Entrega' },
]
const novoGrupo = (tipo: Tipo, ordem: number): Grupo => ({ tipo, item: '', insumos: null, pacote_servicos: null, ordem,
  prazo_levantamento: 15, prazo_solicitacao: 15, prazo_negociacao: 15, prazo_emissao: 10, prazo_entrega: 5 })

type Aba = 'grupos' | 'pendencias' | 'custo'

export function ContratacoesConfig({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('grupos')
  const [aberto, setAberto] = useState<number | null>(null)
  const [editando, setEditando] = useState<Grupo | null>(null)
  const [confirmarRestaurar, setConfirmarRestaurar] = useState(false)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [grupoDestino, setGrupoDestino] = useState<string>('')
  const [conflitos, setConflitos] = useState<{ grupoId: number; codigos: string[]; lista: Conflito[] } | null>(null)
  const [arquivo, setArquivo] = useState<{ nome: string; matriz: unknown[][] } | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [referencia, setReferencia] = useState(() => new Date().toISOString().slice(0, 7))
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    try { setErro(null); setConfig(await api.config(projectId)) } catch (e) { setErro((e as Error).message) }
  }, [projectId])
  useEffect(() => { setConfig(null); setSelecionadas(new Set()); setPrevia(null); setArquivo(null); carregar() }, [carregar])

  const executar = async (fn: () => Promise<unknown>, sucesso?: string) => {
    setOcupado(true); setErro(null)
    try { await fn(); if (sucesso) setAviso(sucesso); await carregar() } catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  const pendenciasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (config?.pendencias || []).filter((p) => !q || `${p.codigo_etapa} ${p.nome}`.toLowerCase().includes(q))
  }, [config, busca])

  const atrelar = async (grupoId: number, codigos: string[], mover = false) => {
    setOcupado(true); setErro(null)
    try {
      const r = await api.atrelar(projectId, grupoId, codigos, mover)
      if (r.conflitos.length) { setConflitos({ grupoId, codigos, lista: r.conflitos }); return }
      setConflitos(null); setSelecionadas(new Set()); setAviso(`${r.inseridas} etapa(s) atrelada(s).`); await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  const criarGrupoComSelecionadas = async () => {
    const nome = window.document.getElementById('cc-novo-grupo-nome') as HTMLInputElement | null
    const tipo = (window.document.getElementById('cc-novo-grupo-tipo') as HTMLSelectElement | null)?.value as Tipo
    if (!nome?.value.trim()) { setErro('Informe o nome do novo grupo.'); return }
    setOcupado(true)
    try {
      const { id } = await api.salvarGrupo(projectId, { ...novoGrupo(tipo || 'MATERIAL', (config?.grupos.length || 0) + 1), item: nome.value.trim() })
      await atrelar(id, [...selecionadas])
      nome.value = ''
    } catch (e) { setErro((e as Error).message); setOcupado(false) }
  }

  const lerArquivo = async (file: File) => {
    const wb = XLSX.read(await file.arrayBuffer())
    const aba = wb.SheetNames.find((n) => n.trim().toUpperCase() === 'CUSTOS') || wb.SheetNames[0]
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, raw: true, defval: null })
    setArquivo({ nome: file.name, matriz })
    setOcupado(true); setErro(null)
    try { setPrevia(await api.previa(projectId, matriz)) } catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  if (!config) return <div className="cc-card">{erro ? <p className="cc-erro">{erro}</p> : <p className="cc-muted">Carregando configuração…</p>}</div>

  if (!config.aplicado) {
    return (
      <div className="cc-card cc-vazio">
        <h3>Grupos de contratação desta obra</h3>
        <p>A obra ainda não tem grupos. Aplique o padrão (143 grupos da planilha do Nizza, com prazos) e depois ajuste o que for preciso.</p>
        <button type="button" className="cc-btn cc-primario" disabled={ocupado}
          onClick={() => executar(async () => { const r = await api.aplicarPadrao(projectId); setAviso(`Padrão aplicado: ${r.grupos} grupos, ${r.vinculos} etapas atreladas (${r.sugeridos} para confirmar).`) })}>
          Aplicar padrão
        </button>
        {erro && <p className="cc-erro">{erro}</p>}
      </div>
    )
  }

  const sugeridas = config.grupos.reduce((s, g) => s + (g.etapas || []).filter((e) => e.situacao === 'SUGERIDO').length, 0)

  return (
    <div className="cc-card">
      <div className="cc-topo">
        <div className="cc-abas" role="tablist">
          <button type="button" role="tab" aria-selected={aba === 'grupos'} onClick={() => setAba('grupos')}>Grupos ({config.grupos.length}){sugeridas ? ` · ${sugeridas} a confirmar` : ''}</button>
          <button type="button" role="tab" aria-selected={aba === 'pendencias'} onClick={() => setAba('pendencias')}>Etapas fora de grupo ({config.pendencias.length})</button>
          <button type="button" role="tab" aria-selected={aba === 'custo'} onClick={() => setAba('custo')}>Custo projetado{config.importacao ? ` · ${config.importacao.referencia.slice(0, 7)}` : ' · não importado'}</button>
        </div>
        {aviso && <p className="cc-aviso" onClick={() => setAviso(null)}>{aviso}</p>}
        {erro && <p className="cc-erro">{erro}</p>}
      </div>

      {aba === 'grupos' && (
        <div className="cc-secao">
          <div className="cc-acoes">
            <button type="button" className="cc-btn" onClick={() => setEditando(novoGrupo('MATERIAL', config.grupos.length + 1))}>Novo grupo</button>
            {!confirmarRestaurar
              ? <button type="button" className="cc-btn cc-sutil" onClick={() => setConfirmarRestaurar(true)}>Restaurar padrão</button>
              : <span className="cc-confirma">Isso apaga os ajustes desta obra.
                  <button type="button" className="cc-btn cc-perigo" disabled={ocupado} onClick={() => executar(() => api.aplicarPadrao(projectId, true), 'Padrão restaurado.').then(() => setConfirmarRestaurar(false))}>Restaurar</button>
                  <button type="button" className="cc-btn cc-sutil" onClick={() => setConfirmarRestaurar(false)}>Cancelar</button>
                </span>}
          </div>

          {editando && (
            <form className="cc-form" onSubmit={(e) => { e.preventDefault(); executar(() => api.salvarGrupo(projectId, editando), 'Grupo salvo.').then(() => setEditando(null)) }}>
              <label>Tipo<select id="cc-edit-tipo" value={editando.tipo} onChange={(e) => setEditando({ ...editando, tipo: e.target.value as Tipo })}><option value="MATERIAL">Material</option><option value="MAO_DE_OBRA">Mão de obra</option></select></label>
              <label>Grupo<input id="cc-edit-item" value={editando.item} onChange={(e) => setEditando({ ...editando, item: e.target.value })} required /></label>
              <label>Insumos<input id="cc-edit-insumos" value={editando.insumos || ''} onChange={(e) => setEditando({ ...editando, insumos: e.target.value })} /></label>
              <label>Pacote de serviços<input id="cc-edit-pacote" value={editando.pacote_servicos || ''} onChange={(e) => setEditando({ ...editando, pacote_servicos: e.target.value })} /></label>
              {PRAZOS.map((p) => (
                <label key={p.campo} className="cc-prazo">{p.label} (dias)<input id={`cc-edit-${p.campo}`} type="number" min={0} value={Number(editando[p.campo]) || 0} onChange={(e) => setEditando({ ...editando, [p.campo]: Number(e.target.value) })} /></label>
              ))}
              <div className="cc-acoes"><button type="submit" className="cc-btn cc-primario" disabled={ocupado}>Salvar</button><button type="button" className="cc-btn cc-sutil" onClick={() => setEditando(null)}>Cancelar</button></div>
            </form>
          )}

          {(['MATERIAL', 'MAO_DE_OBRA'] as Tipo[]).map((tipo) => (
            <div key={tipo} className="cc-bloco">
              <h4>{TIPO_LABEL[tipo]}</h4>
              <table className="cc-tabela">
                <thead><tr><th>Grupo</th><th>Pacote</th><th>Prazos (dias)</th><th className="cc-num">Etapas</th><th className="cc-num">Projetado</th><th></th></tr></thead>
                <tbody>
                  {config.grupos.filter((g) => g.tipo === tipo).map((g) => {
                    const etapas = g.etapas || []
                    const projetado = etapas.reduce((s, e) => s + (e.custo_projetado || 0), 0)
                    const aConfirmar = etapas.filter((e) => e.situacao === 'SUGERIDO').length
                    return [
                      <tr key={g.id} className="cc-linha-grupo" onClick={() => setAberto(aberto === g.id ? null : g.id!)}>
                        <td><span aria-hidden="true">{aberto === g.id ? '▾' : '▸'}</span> {g.item}{g.insumos ? <span className="cc-muted"> · {g.insumos}</span> : null}{aConfirmar ? <span className="cc-chip cc-sugerido">{aConfirmar} a confirmar</span> : null}</td>
                        <td>{g.pacote_servicos || '—'}</td>
                        <td className="cc-mono">{PRAZOS.map((p) => Number(g[p.campo]) || 0).join(' / ')}</td>
                        <td className="cc-num">{etapas.length || <span className="cc-chip cc-alerta">sem etapas</span>}</td>
                        <td className="cc-num">{config.importacao ? fmt(projetado) : '—'}</td>
                        <td className="cc-acoes-linha" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="cc-btn cc-sutil" onClick={() => setEditando(g)}>Editar</button>
                          <button type="button" className="cc-btn cc-sutil" onClick={() => executar(() => api.excluirGrupo(projectId, g.id!), 'Grupo excluído; as etapas voltaram para as pendências.')}>Excluir</button>
                        </td>
                      </tr>,
                      aberto === g.id && (
                        <tr key={`${g.id}-etapas`}><td colSpan={6}>
                          {etapas.length === 0 ? <p className="cc-muted">Nenhuma etapa. Atrele pela aba "Etapas fora de grupo".</p> : (
                            <table className="cc-tabela cc-interna"><tbody>
                              {etapas.map((e) => (
                                <tr key={e.codigo_etapa}>
                                  <td className="cc-mono">{e.codigo_etapa}{e.origem_nivel4 ? <span className="cc-muted"> (via {e.origem_nivel4})</span> : null}</td>
                                  <td>{e.nome_obra}{e.situacao === 'SUGERIDO' ? <span className="cc-muted"> · no padrão: “{e.nome_padrao}”</span> : null}</td>
                                  <td className="cc-num">{fmt(e.custo_projetado)}</td>
                                  <td className="cc-acoes-linha">
                                    {e.situacao === 'SUGERIDO' && <button type="button" className="cc-btn cc-primario" onClick={() => executar(() => api.confirmar(projectId, e.codigo_etapa), 'Vínculo confirmado.')}>Confirmar</button>}
                                    <button type="button" className="cc-btn cc-sutil" onClick={() => executar(() => api.soltar(projectId, e.codigo_etapa), 'Etapa solta.')}>Soltar</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody></table>
                          )}
                        </td></tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {aba === 'pendencias' && (
        <div className="cc-secao">
          <div className="cc-acoes">
            <input id="cc-busca" type="search" placeholder="Buscar código ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <span className="cc-muted">{selecionadas.size} selecionada(s)</span>
            <select id="cc-grupo-destino" value={grupoDestino} onChange={(e) => setGrupoDestino(e.target.value)}>
              <option value="">Atrelar a grupo existente…</option>
              {config.grupos.map((g) => <option key={g.id} value={g.id}>{TIPO_LABEL[g.tipo]} · {g.item}{g.insumos ? ` · ${g.insumos}` : ''}</option>)}
            </select>
            <button type="button" className="cc-btn cc-primario" disabled={!grupoDestino || !selecionadas.size || ocupado} onClick={() => atrelar(Number(grupoDestino), [...selecionadas])}>Atrelar</button>
            <span className="cc-separador">ou</span>
            <select id="cc-novo-grupo-tipo" defaultValue="MATERIAL"><option value="MATERIAL">Material</option><option value="MAO_DE_OBRA">Mão de obra</option></select>
            <input id="cc-novo-grupo-nome" placeholder="Nome do novo grupo" />
            <button type="button" className="cc-btn" disabled={!selecionadas.size || ocupado} onClick={criarGrupoComSelecionadas}>Criar grupo com as selecionadas</button>
          </div>
          {conflitos && (
            <div className="cc-confirma cc-bloco">
              <p>{conflitos.lista.length} etapa(s) já estão em outro grupo: {conflitos.lista.map((c) => `${c.codigo_etapa} (${c.item})`).join(', ')}.</p>
              <button type="button" className="cc-btn cc-primario" onClick={() => atrelar(conflitos.grupoId, conflitos.codigos, true)}>Mover para o grupo escolhido</button>
              <button type="button" className="cc-btn cc-sutil" onClick={() => setConflitos(null)}>Cancelar</button>
            </div>
          )}
          <table className="cc-tabela">
            <thead><tr>
              <th><input id="cc-sel-todas" type="checkbox" aria-label="Selecionar todas" checked={pendenciasFiltradas.length > 0 && pendenciasFiltradas.every((p) => selecionadas.has(p.codigo_etapa))}
                onChange={(e) => setSelecionadas(e.target.checked ? new Set(pendenciasFiltradas.map((p) => p.codigo_etapa)) : new Set())} /></th>
              <th>Etapa</th><th>Nome no orçamento</th><th className="cc-num">Projetado</th><th>Sugestão</th>
            </tr></thead>
            <tbody>
              {pendenciasFiltradas.map((p) => (
                <tr key={p.codigo_etapa}>
                  <td><input type="checkbox" aria-label={`Selecionar ${p.codigo_etapa}`} checked={selecionadas.has(p.codigo_etapa)}
                    onChange={(e) => { const s = new Set(selecionadas); if (e.target.checked) s.add(p.codigo_etapa); else s.delete(p.codigo_etapa); setSelecionadas(s) }} /></td>
                  <td className="cc-mono">{p.codigo_etapa}</td>
                  <td>{p.nome}</td>
                  <td className="cc-num">{fmt(p.custo_projetado)}</td>
                  <td>{p.sugestao ? <button type="button" className="cc-btn cc-sutil" onClick={() => atrelar(p.sugestao!.grupo_id, [p.codigo_etapa])}>Atrelar a “{p.sugestao.item}” (padrão {p.sugestao.codigo_padrao})</button> : <span className="cc-muted">—</span>}</td>
                </tr>
              ))}
              {pendenciasFiltradas.length === 0 && <tr><td colSpan={5} className="cc-muted">Nenhuma etapa fora de grupo{busca ? ' com essa busca' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'custo' && (
        <div className="cc-secao">
          <p className="cc-muted">Envie a planilha de custo projetado (.xlsx ou .csv). Se houver uma aba chamada CUSTOS, ela é usada. Precisa das colunas "CÓDIGO" (ou "ETAPA") e "CUSTO PROJETADO". Só as etapas de nível 5 entram.</p>
          {config.importacao && <p>Última importação: referência <strong>{config.importacao.referencia.slice(0, 7)}</strong>, total <strong>{fmt(Number(config.importacao.total))}</strong>{config.importacao.arquivo ? ` (${config.importacao.arquivo})` : ''}.</p>}
          <div className="cc-acoes">
            <input id="cc-arquivo" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f) }} />
            <label>Mês de referência <input id="cc-referencia" type="month" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
          </div>
          {previa && arquivo && (
            <div className="cc-bloco">
              <p><strong>{previa.itens.length}</strong> etapas lidas, total <strong>{fmt(previa.total)}</strong>
                {previa.totalAnterior !== null ? <> · anterior {fmt(previa.totalAnterior)} (diferença {fmt(previa.total - previa.totalAnterior)})</> : null}
                {previa.ignoradas ? <> · {previa.ignoradas} linha(s) sem valor ignoradas</> : null}</p>
              {previa.foraDoOrcamento.length > 0 && <p className="cc-alerta-texto">{previa.foraDoOrcamento.length} etapa(s) não existem no orçamento desta obra: {previa.foraDoOrcamento.slice(0, 12).join(', ')}{previa.foraDoOrcamento.length > 12 ? '…' : ''}</p>}
              {previa.erros.length > 0 && <ul className="cc-erro">{previa.erros.slice(0, 20).map((er) => <li key={`${er.linha}-${er.motivo}`}>Linha {er.linha}: {er.motivo}</li>)}</ul>}
              <button type="button" className="cc-btn cc-primario" disabled={ocupado || previa.erros.length > 0 || previa.itens.length === 0}
                onClick={() => executar(async () => { const r = await api.importar(projectId, referencia, arquivo.nome, arquivo.matriz); setAviso(`Custo projetado importado: ${r.itens} etapas, total ${fmt(r.total)}.`); setPrevia(null); setArquivo(null) })}>
                Confirmar importação
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Estilos**

```css
/* src/components/contratacoes/ContratacoesConfig.css */
.cc-card { background: var(--surface, #fff); border: 1px solid var(--border, #dde3e6); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.cc-topo { display: flex; flex-direction: column; gap: 8px; }
.cc-abas { display: flex; gap: 6px; flex-wrap: wrap; }
.cc-abas button { border: 1px solid var(--border, #dde3e6); background: transparent; color: inherit; padding: 6px 12px; border-radius: 6px; cursor: pointer; font: inherit; }
.cc-abas button[aria-selected="true"] { background: var(--accent, #1f6f78); border-color: var(--accent, #1f6f78); color: #fff; }
.cc-secao { display: flex; flex-direction: column; gap: 12px; }
.cc-bloco { display: flex; flex-direction: column; gap: 6px; }
.cc-bloco h4 { margin: 4px 0; }
.cc-acoes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cc-acoes input, .cc-acoes select, .cc-form input, .cc-form select { font: inherit; padding: 5px 8px; border: 1px solid var(--border, #dde3e6); border-radius: 6px; background: transparent; color: inherit; }
.cc-btn { font: inherit; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border, #dde3e6); background: transparent; color: inherit; cursor: pointer; }
.cc-btn:disabled { opacity: .5; cursor: default; }
.cc-primario { background: var(--accent, #1f6f78); border-color: var(--accent, #1f6f78); color: #fff; }
.cc-perigo { background: #b3261e; border-color: #b3261e; color: #fff; }
.cc-sutil { border-color: transparent; text-decoration: underline; }
.cc-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; align-items: end; }
.cc-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
.cc-tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
.cc-tabela th, .cc-tabela td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border, #dde3e6); vertical-align: top; }
.cc-tabela th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
.cc-interna td { border-bottom-style: dashed; }
.cc-linha-grupo { cursor: pointer; }
.cc-num { text-align: right !important; font-variant-numeric: tabular-nums; }
.cc-mono { font-family: ui-monospace, monospace; font-size: 12.5px; }
.cc-muted { opacity: .65; }
.cc-chip { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 999px; font-size: 11.5px; }
.cc-sugerido { background: #fbeedb; color: #8a5300; }
.cc-alerta { background: #e3ebf8; color: #2f5fa8; }
.cc-erro { color: #b3261e; margin: 0; }
.cc-aviso { color: #2f7a4a; margin: 0; cursor: pointer; }
.cc-alerta-texto { color: #8a5300; }
.cc-confirma { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cc-acoes-linha { white-space: nowrap; text-align: right; }
.cc-separador { opacity: .6; }
.cc-vazio { align-items: flex-start; }
```

- [ ] **Step 4: Ligar na Gestão à Vista (`src/App.tsx`)**

1. Import no topo: `import { ContratacoesConfig } from './components/contratacoes/ContratacoesConfig'`
2. Linha 59: acrescentar `| 'contratacoes'` ao tipo `GestaoPanelTab`.
3. Depois do botão do Painel 5 (por volta da linha 3930), acrescentar:

```tsx
                <button
                  type="button"
                  className={`gestao-panel-tab-btn ${gestaoPanelTab === 'contratacoes' ? 'active' : ''}`}
                  onClick={() => setGestaoPanelTab('contratacoes')}
                >
                  <ListChecks size={14} />
                  <span>Painel 6: Contratações</span>
                </button>
```

4. Antes de `{gestaoPanelTab === 'panel5' && (` (linha ~4649), acrescentar:

```tsx
              {gestaoPanelTab === 'contratacoes' && (
                selectedProject
                  ? <ContratacoesConfig projectId={selectedProject} />
                  : <div className="gestao-card"><p>Selecione um projeto para configurar as contratações.</p></div>
              )}
```

- [ ] **Step 5: Verificar build e testes**

Run: `npx tsc --noEmit -p . && npm run build && npm run test:server`
Expected: sem erros de tipo; build ok; testes PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/contratacoes src/App.tsx
git commit -m "feat(contratacoes): tela de configuracao de grupos, pendencias e custo projetado na Gestao a Vista"
```

---

### Task 7: Validação com dados reais e publicação

**Files:** nenhum novo.

- [ ] **Step 1: Validar o padrão contra o POTY (somente leitura)**

Copiar `server/contratacoes.js` e `server/contratacoes-padrao.json` para um diretório temporário na VPS e, no container do `app`, rodar um script que carrega o orçamento do POTY por SQL (mesma consulta de `orcamentoDaObra`, projeto `40661`) e chama `resolverEtapasPadrao`. Esperado: dezenas de vínculos (a análise anterior achou 82 dos 111 códigos do Nizza no POTY), com parte `SUGERIDO`, e conflitos > 0 (o padrão repete etapas). Registrar os números para o usuário. Remover os arquivos temporários depois.

- [ ] **Step 2: Push e pedir o Redeploy**

```bash
git push origin main
```

Pedir ao usuário o Redeploy do `app` no Coolify (não mexer perto da meia-noite). No primeiro start, o `initDb` cria as tabelas e carrega o padrão (log "Padrão de grupos de contratação carregado: 143 grupos").

- [ ] **Step 3: Verificação no site (com o usuário)**

No projeto POTY, Gestão à Vista → Painel 6: Contratações:
1. "Aplicar padrão" → aviso com grupos/vínculos/sugeridos.
2. Abrir um grupo com "a confirmar", confirmar uma etapa; soltar outra e ver que ela aparece em "Etapas fora de grupo".
3. Em pendências, selecionar 2 etapas e atrelar a um grupo; tentar atrelar uma etapa já atrelada a outro grupo → aviso de conflito com opção de mover (Review Focus 5).
4. Criar grupo novo com etapas selecionadas.
5. Importar a planilha do POTY quando o usuário enviar; conferir a prévia e o total.
```
