# Dados Diário Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer os diários de obra (RDO) da API do App Diário de Obra para o Postgres e expor (a) uma aba **Dados Diário** de consulta ao banco, no padrão do Dados Mega, e (b) um painel **Indicadores diários** na Gestão à Vista.

**Architecture:** Um sincronizador no servidor Express (cron noturno + script manual) lê a API externa com limite de taxa e grava no schema `diario` do Postgres (tabelas normalizadas + JSON bruto). Regras de mapeamento, montagem de SQL e cálculo de indicadores são funções puras testadas com `node --test`; o SQL real é verificado contra um Postgres descartável em Docker. A tela consulta só o banco.

**Tech Stack:** Node 24 (ESM), Express 5, `pg`, `node-cron`, `node:test`; React 19 + TypeScript + Vite, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-09-29-dados-diario-design.md`

## Global Constraints

- API: base `https://apiexterna.diariodeobra.app/v1`, somente leitura (GET), token no header `token`, limite de 150 requisições por minuto (HTTP 429 quando excedido). O cliente usa no máximo 130 por minuto.
- Variáveis de ambiente novas: `TOKEN_DIARIO` (já existe no `.env` local) e `CRON_SCHEDULE_DIARIO` (padrão `0 21 * * *`). O token nunca aparece em log, mensagem de erro, coluna do banco ou resposta de API. Nunca commitar `.env`.
- Schema `diario` é de dono exclusivo deste sincronizador; `public` (app) e `mega` não são tocados.
- A porta do Postgres continua não publicada nos `docker-compose*.yml`.
- Chave do relatório é o `_id` da API (há relatórios duplicados na mesma obra e data).
- Sinais do dia (gravados na sincronização): `dia_parado` = alguma ocorrência com tag que começa com "PARALISAÇÃO"; `dia_chuvoso` = algum período ativo com clima "Chuvoso"; `dia_impraticavel` = algum período ativo com condição "Impraticável".
- Controle de material, checklist e horário de trabalho (sempre vazios/nulos na API) não são modelados; ficam só no `raw`.
- Interface em português (pt-BR); datas exibidas `dd/mm/aaaa`; DATE do Postgres sempre convertido com `::text` na consulta.
- Mudanças cirúrgicas: não refatorar `MegaView`, `mega-columns.ts` nem o restante de `App.tsx` além das linhas indicadas.
- Commits em português no estilo do repositório (`feat(diario): ...`), terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Entradas/condições que a spec implica, mas nenhuma tarefa exercita por si só; cada uma tem um teste na tarefa dona:

1. **Relatório com data inválida, sem `_id` ou sem obra** → só aquele relatório vira erro na carga; os demais seguem (Task 1 e Task 3).
2. **API responde 200 com lista vazia para obra que já tem relatórios** → nada é marcado como removido e a carga fica `parcial` (Task 3).
3. **Erro HTTP 500/429 no meio da carga, ou mensagem de erro** → carga registra `parcial`/`erro` em `diario.carga`; o token não vaza na mensagem (Task 2 e Task 3).
4. **DATE do Postgres chegando ao navegador como `Date` com fuso (dia anterior)** → toda coluna de data sai com `::text` (Task 4 e Task 5).
5. **Obra sem diários ou período sem dados** → indicadores zerados e listas vazias, a tela mostra "Sem dados" e não quebra (Task 4 e Task 8).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `server/diario-map.js` (novo) | Conversão de datas/nomes e mapeamento JSON da API → linhas do banco. Puro. |
| `server/diario-client.js` (novo) | Cliente HTTP com token, teto de taxa e repetição em 429. |
| `server/diario-sync.js` (novo) | Orquestra a carga (obras → lista → detalhe do que mudou). `client` e `repo` injetados. |
| `server/diario-consulta.js` (novo) | Montagem pura de SQL: consultas paginadas, validação de data, upsert. |
| `server/diario-indicadores.js` (novo) | Cálculos puros dos indicadores. |
| `server/diario-db.js` (novo) | Repositório da sincronização e funções de consulta/indicadores contra o Postgres. |
| `server/schema.sql` (editar) | DDL do schema `diario`. |
| `server/index.js` (editar) | Rotas `/api/diario/*` e cron. |
| `scripts/sync-diario-local.mjs` (novo) | Carga manual: `npm run sync:diario`. |
| `src/components/diario/*` (novos) | API do front, formatos, colunas, modal do relatório, gráficos, indicadores, CSS. |
| `src/DiarioView.tsx` (novo) | Aba Dados Diário. |
| `src/App.tsx` (editar) | Registro da aba e do painel na Gestão à Vista. |

---

### Task 1: Mapeamento puro do Diário de Obra

**Files:**
- Create: `server/diario-map.js`
- Test: `server/diario-map.test.js`

**Interfaces:**
- Produces: `dataBR(v) → 'AAAA-MM-DD'|null`, `dataHoraBR(v) → 'AAAA-MM-DD HH:MM:SS'|null`, `normalizarEmpreiteira(nome) → string|null`, `ehParalisacao(tag) → boolean`, `mapearObra(item, detalhe) → linha de diario.obra`, `mapearRelatorio(raw) → { relatorio, maoObra[], equipamentos[], ocorrencias[], atividades[], fotos[] }` (lança `Error` se faltar `_id`, obra ou data válida), `COLUNAS_OBRA`, `COLUNAS_RELATORIO` (fonte única das colunas do INSERT).

- [ ] **Step 1: Escrever o teste**

Criar `server/diario-map.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dataBR, dataHoraBR, normalizarEmpreiteira, ehParalisacao, mapearObra, mapearRelatorio,
  COLUNAS_OBRA, COLUNAS_RELATORIO,
} from './diario-map.js'

const bruto = () => ({
  _id: 'rel1', data: '10/08/2026', dataFim: null, diaDaSemana: 'Segunda-Feira', numero: 693,
  status: { id: 4, descricao: 'Aprovado' },
  obra: { _id: 'obra1', nome: 'PACE | AG7' },
  clima: {
    manha: { clima: 'Chuvoso', condicao: 'Impraticável', ativo: true },
    tarde: { clima: 'Claro', condicao: 'Praticável', ativo: true },
    noite: { clima: 'Chuvoso', condicao: 'Impraticável', ativo: false },
    indicePluviometrico: 12.5,
  },
  maoDeObra: {
    opcaoSelecionada: 'padrao',
    padrao: [
      { descricao: 'Pedreiro', quantidade: 5, categoria: { descricao: 'Pereira Decol' } },
      { descricao: 'Servente', quantidade: '3', categoria: { descricao: 'PEREIRA  DECOL' } },
    ],
    personalizada: [],
  },
  equipamentos: [{ descricao: 'Betoneira', quantidade: 2 }],
  atividades: [
    { descricao: 'Concretagem laje', observacao: '', status: { descricao: 'Em Andamento' }, porcentagem: 40,
      fotos: [{ url: 'https://x/a.jpg', urlMiniatura: 'https://x/m/a.jpg' }] },
    { descricao: 'Limpeza', status: null, porcentagem: null, fotos: [] },
  ],
  ocorrencias: [
    { descricao: 'Chuva forte', tags: [{ descricao: 'PARALISAÇÃO – CHUVA (ACIMA 5 mm)', checked: true }, { descricao: 'Reunião', checked: false }], fotos: [] },
    { descricao: 'Reunião com cliente', tags: [], fotos: [{ url: 'https://x/o.jpg', urlMiniatura: 'https://x/m/o.jpg' }] },
  ],
  galeriaDeFotos: [
    { url: 'https://x/a.jpg', urlMiniatura: 'https://x/m/a.jpg', descricao: 'Laje' },
    { url: 'https://x/g.jpg', urlMiniatura: 'https://x/m/g.jpg', descricao: '' },
  ],
  log: {
    criadoPor: { dataHora: '10/08/2026 09:45', usuario: { nome: 'Felipe' } },
    modificadoPor: { dataHora: '21/08/2026 07:37', usuario: { nome: 'Lineu' } },
  },
  created: '10/08/2026 09:45:10', modified: '21/08/2026 07:37:01', linkPdf: 'https://pdf',
})

test('dataBR e dataHoraBR convertem dd/mm/aaaa para ISO e rejeitam lixo', () => {
  assert.equal(dataBR('10/08/2026'), '2026-08-10')
  assert.equal(dataBR('10/08/2026 09:45'), '2026-08-10')
  assert.equal(dataBR(null), null)
  assert.equal(dataBR('2026-08-10'), null)
  assert.equal(dataHoraBR('21/08/2026 07:37:01'), '2026-08-21 07:37:01')
  assert.equal(dataHoraBR('21/08/2026 07:37'), '2026-08-21 07:37:00')
  assert.equal(dataHoraBR('21/08/2026'), '2026-08-21 00:00:00')
  assert.equal(dataHoraBR(undefined), null)
})

test('normalizarEmpreiteira junta grafias de caixa, acento e pontuação', () => {
  assert.equal(normalizarEmpreiteira('Farias'), normalizarEmpreiteira('FARIAS'))
  assert.equal(normalizarEmpreiteira('MD.ALESSI'), 'MD ALESSI')
  assert.equal(normalizarEmpreiteira('MD Alessi'), 'MD ALESSI')
  assert.equal(normalizarEmpreiteira('C2 Ar Condicionado:'), 'C2 AR CONDICIONADO')
  assert.equal(normalizarEmpreiteira('Evolução'), 'EVOLUCAO')
  assert.equal(normalizarEmpreiteira('   '), null)
  assert.equal(normalizarEmpreiteira(null), null)
})

test('ehParalisacao reconhece só as tags de paralisação', () => {
  assert.equal(ehParalisacao('PARALISAÇÃO – CHUVA (ACIMA 5 mm)'), true)
  assert.equal(ehParalisacao('Paralisação - outros'), true)
  assert.equal(ehParalisacao('Dia Chuvoso'), false)
  assert.equal(ehParalisacao('Horas Improdutivas'), false)
})

test('mapearRelatorio: campos do relatório, sinais do dia e datas', () => {
  const { relatorio } = mapearRelatorio(bruto())
  assert.equal(relatorio.relatorio_id, 'rel1')
  assert.equal(relatorio.obra_id, 'obra1')
  assert.equal(relatorio.data, '2026-08-10')
  assert.equal(relatorio.numero, 693)
  assert.equal(relatorio.status, 'Aprovado')
  assert.equal(relatorio.clima_manha, 'Chuvoso')
  assert.equal(relatorio.condicao_manha, 'Impraticável')
  assert.equal(relatorio.indice_pluviometrico, 12.5)
  assert.equal(relatorio.dia_chuvoso, true)
  assert.equal(relatorio.dia_impraticavel, true)
  assert.equal(relatorio.dia_parado, true)
  assert.equal(relatorio.criado_por, 'Felipe')
  assert.equal(relatorio.criado_em, '2026-08-10 09:45:00')
  assert.equal(relatorio.modificado_em, '2026-08-21 07:37:00')
  assert.equal(relatorio.modified_api, '21/08/2026 07:37:01')
  assert.equal(relatorio.total_fotos, 3)
  assert.equal(relatorio.raw._id, 'rel1')
})

test('mapearRelatorio: período inativo não conta como dia chuvoso/impraticável', () => {
  const r = bruto()
  r.clima = {
    manha: { clima: 'Claro', condicao: 'Praticável', ativo: true },
    tarde: { clima: 'Claro', condicao: 'Praticável', ativo: true },
    noite: { clima: 'Chuvoso', condicao: 'Impraticável', ativo: false },
    indicePluviometrico: null,
  }
  r.ocorrencias = []
  const { relatorio } = mapearRelatorio(r)
  assert.equal(relatorio.dia_chuvoso, false)
  assert.equal(relatorio.dia_impraticavel, false)
  assert.equal(relatorio.dia_parado, false)
  assert.equal(relatorio.indice_pluviometrico, null)
})

test('mapearRelatorio: filhas (mão de obra, equipamentos, ocorrências, atividades, fotos)', () => {
  const m = mapearRelatorio(bruto())
  assert.deepEqual(m.maoObra, [
    { funcao: 'Pedreiro', quantidade: 5, empreiteira: 'Pereira Decol', empreiteira_norm: 'PEREIRA DECOL' },
    { funcao: 'Servente', quantidade: 3, empreiteira: 'PEREIRA  DECOL', empreiteira_norm: 'PEREIRA DECOL' },
  ])
  assert.deepEqual(m.equipamentos, [{ descricao: 'Betoneira', quantidade: 2 }])
  assert.deepEqual(m.ocorrencias, [
    { descricao: 'Chuva forte', tags: ['PARALISAÇÃO – CHUVA (ACIMA 5 mm)'], paralisacao: true },
    { descricao: 'Reunião com cliente', tags: [], paralisacao: false },
  ])
  assert.equal(m.atividades[0].total_fotos, 1)
  assert.equal(m.atividades[0].observacao, null)
  assert.deepEqual([m.atividades[1].status, m.atividades[1].porcentagem, m.atividades[1].total_fotos], [null, null, 0])
  assert.deepEqual(m.fotos.map((f) => [f.url, f.origem]), [
    ['https://x/a.jpg', 'galeria'], ['https://x/g.jpg', 'galeria'], ['https://x/o.jpg', 'ocorrencia'],
  ])
})

test('mapearRelatorio tolera relatório mínimo (sem clima, mão de obra ou listas)', () => {
  const m = mapearRelatorio({ _id: 'r', data: '01/01/2026', obra: { _id: 'o' } })
  assert.deepEqual([m.maoObra, m.equipamentos, m.ocorrencias, m.atividades, m.fotos], [[], [], [], [], []])
  assert.equal(m.relatorio.dia_parado, false)
  assert.equal(m.relatorio.numero, null)
})

test('mapearRelatorio recusa relatório sem _id, sem obra ou com data inválida', () => {
  assert.throws(() => mapearRelatorio({ ...bruto(), _id: undefined }), /_id/)
  assert.throws(() => mapearRelatorio({ ...bruto(), obra: null }), /sem obra/)
  assert.throws(() => mapearRelatorio({ ...bruto(), data: 'ontem' }), /data inválida/)
})

test('as colunas exportadas são exatamente as chaves mapeadas (evita valor undefined no INSERT)', () => {
  assert.deepEqual(Object.keys(mapearRelatorio(bruto()).relatorio), COLUNAS_RELATORIO)
  assert.deepEqual(Object.keys(mapearObra({ _id: 'o', nome: 'X' })), COLUNAS_OBRA)
})

test('mapearObra usa a listagem e o detalhe', () => {
  const o = mapearObra(
    { _id: 'o1', nome: 'Alberi', status: { id: 3, descricao: 'Em Andamento' }, totalRelatorios: 183, totalFotos: 444, modified: '01/01/2026 10:00:00' },
    { grupo: { descricao: 'Todas' }, dataInicio: '01/04/2025', dataFim: null, responsavel: 'Ana' },
  )
  assert.equal(o.status, 'Em Andamento')
  assert.equal(o.grupo, 'Todas')
  assert.equal(o.data_inicio, '2025-04-01')
  assert.equal(o.data_fim, null)
  assert.equal(o.total_relatorios, 183)
  assert.equal(o.modified_api, '01/01/2026 10:00:00')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test server/diario-map.test.js`
Expected: FAIL com `Cannot find module './diario-map.js'`.

- [ ] **Step 3: Implementar**

Criar `server/diario-map.js`:

```js
// Regras puras do Diário de Obra: conversão de formatos e mapeamento do JSON da API para linhas do banco.

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')

export const COLUNAS_OBRA = [
  'obra_id', 'nome', 'status_id', 'status', 'grupo', 'endereco', 'numero_contrato', 'data_inicio', 'data_fim',
  'responsavel', 'cliente', 'total_relatorios', 'total_fotos', 'modified_api', 'raw',
]

export const COLUNAS_RELATORIO = [
  'relatorio_id', 'obra_id', 'data', 'data_fim', 'numero', 'dia_semana', 'status_id', 'status',
  'clima_manha', 'condicao_manha', 'clima_tarde', 'condicao_tarde', 'clima_noite', 'condicao_noite',
  'indice_pluviometrico', 'dia_parado', 'dia_chuvoso', 'dia_impraticavel',
  'criado_por', 'criado_em', 'modificado_por', 'modificado_em', 'created_api', 'modified_api',
  'link_pdf', 'total_fotos', 'raw',
]

export function dataBR(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(valor ?? ''))
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export function dataHoraBR(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(valor ?? ''))
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`
}

export function normalizarEmpreiteira(nome) {
  const n = semAcento(nome).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  return n || null
}

export function ehParalisacao(tag) {
  return semAcento(tag).toUpperCase().startsWith('PARALISACAO')
}

const inteiro = (v) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? n : 0
}

const decimal = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const periodoComProblema = (periodo, campo, valor) =>
  Boolean(periodo?.ativo) && semAcento(periodo?.[campo]).toUpperCase() === valor

function coletarFotos(raw) {
  const vistas = new Set()
  const fotos = []
  const adicionar = (f, origem) => {
    if (!f?.url || vistas.has(f.url)) return
    vistas.add(f.url)
    fotos.push({ url: f.url, url_miniatura: f.urlMiniatura ?? null, descricao: f.descricao || null, origem })
  }
  ;(raw.galeriaDeFotos ?? []).forEach((f) => adicionar(f, 'galeria'))
  ;(raw.atividades ?? []).forEach((a) => (a.fotos ?? []).forEach((f) => adicionar(f, 'atividade')))
  ;(raw.ocorrencias ?? []).forEach((o) => (o.fotos ?? []).forEach((f) => adicionar(f, 'ocorrencia')))
  return fotos
}

export function mapearObra(item, detalhe = {}) {
  return {
    obra_id: item._id,
    nome: item.nome,
    status_id: item.status?.id ?? null,
    status: item.status?.descricao ?? null,
    grupo: detalhe.grupo?.descricao ?? null,
    endereco: detalhe.endereco ?? null,
    numero_contrato: detalhe.numeroContrato ?? null,
    data_inicio: dataBR(detalhe.dataInicio),
    data_fim: dataBR(detalhe.dataFim),
    responsavel: detalhe.responsavel ?? null,
    cliente: detalhe.cliente ?? null,
    total_relatorios: inteiro(item.totalRelatorios),
    total_fotos: inteiro(item.totalFotos),
    modified_api: item.modified ?? null,
    raw: detalhe,
  }
}

export function mapearRelatorio(raw) {
  const data = dataBR(raw.data)
  if (!raw._id) throw new Error('Relatório sem _id.')
  if (!raw.obra?._id) throw new Error(`Relatório ${raw._id} sem obra.`)
  if (!data) throw new Error(`Relatório ${raw._id} com data inválida: ${raw.data}`)

  const clima = raw.clima ?? {}
  const periodos = [clima.manha, clima.tarde, clima.noite]

  const ocorrencias = (raw.ocorrencias ?? []).map((o) => {
    const tags = (o.tags ?? []).filter((t) => t.checked).map((t) => t.descricao)
    return { descricao: o.descricao ?? null, tags, paralisacao: tags.some(ehParalisacao) }
  })

  const maoObra = (raw.maoDeObra?.padrao ?? []).map((m) => ({
    funcao: m.descricao ?? null,
    quantidade: inteiro(m.quantidade),
    empreiteira: m.categoria?.descricao ?? null,
    empreiteira_norm: normalizarEmpreiteira(m.categoria?.descricao),
  }))

  const equipamentos = (raw.equipamentos ?? []).map((e) => ({
    descricao: e.descricao ?? null,
    quantidade: inteiro(e.quantidade),
  }))

  const atividades = (raw.atividades ?? []).map((a) => ({
    descricao: a.descricao ?? null,
    observacao: a.observacao || null,
    status: a.status?.descricao ?? null,
    porcentagem: decimal(a.porcentagem),
    total_fotos: (a.fotos ?? []).length,
  }))

  const fotos = coletarFotos(raw)

  return {
    relatorio: {
      relatorio_id: raw._id,
      obra_id: raw.obra._id,
      data,
      data_fim: dataBR(raw.dataFim),
      numero: Number.isInteger(raw.numero) ? raw.numero : null,
      dia_semana: raw.diaDaSemana ?? null,
      status_id: raw.status?.id ?? null,
      status: raw.status?.descricao ?? null,
      clima_manha: clima.manha?.clima ?? null,
      condicao_manha: clima.manha?.condicao ?? null,
      clima_tarde: clima.tarde?.clima ?? null,
      condicao_tarde: clima.tarde?.condicao ?? null,
      clima_noite: clima.noite?.clima ?? null,
      condicao_noite: clima.noite?.condicao ?? null,
      indice_pluviometrico: decimal(clima.indicePluviometrico),
      dia_parado: ocorrencias.some((o) => o.paralisacao),
      dia_chuvoso: periodos.some((p) => periodoComProblema(p, 'clima', 'CHUVOSO')),
      dia_impraticavel: periodos.some((p) => periodoComProblema(p, 'condicao', 'IMPRATICAVEL')),
      criado_por: raw.log?.criadoPor?.usuario?.nome ?? null,
      criado_em: dataHoraBR(raw.log?.criadoPor?.dataHora),
      modificado_por: raw.log?.modificadoPor?.usuario?.nome ?? null,
      modificado_em: dataHoraBR(raw.log?.modificadoPor?.dataHora),
      created_api: raw.created ?? null,
      modified_api: raw.modified ?? null,
      link_pdf: raw.linkPdf ?? null,
      total_fotos: fotos.length,
      raw,
    },
    maoObra,
    equipamentos,
    ocorrencias,
    atividades,
    fotos,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test server/diario-map.test.js`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add server/diario-map.js server/diario-map.test.js
git commit -m "feat(diario): mapeamento do JSON da API para linhas do banco"
```

---

### Task 2: Cliente HTTP com limite de taxa

**Files:**
- Create: `server/diario-client.js`
- Test: `server/diario-client.test.js`

**Interfaces:**
- Produces: `criarCliente({ token, base?, fetchImpl?, agora?, dormir?, porMinuto?, esperaApos429?, tentativas429? }) → { get(caminho) → Promise<json> }`. `get` recebe caminho relativo (`/obras`), lança `Error('Diário de Obra respondeu <status> em <caminho>')` em erro HTTP e nunca inclui o token na mensagem. Sem token, `criarCliente` lança `Error('TOKEN_DIARIO não configurado.')`.

- [ ] **Step 1: Escrever o teste**

Criar `server/diario-client.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { criarCliente } from './diario-client.js'

const resposta = (status, corpo = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo })

function ambiente(respostas) {
  let t = 0
  const esperas = []
  const chamadas = []
  const fila = [...respostas]
  return {
    esperas,
    chamadas,
    opcoes: {
      agora: () => t,
      dormir: async (ms) => { esperas.push(ms); t += ms },
      fetchImpl: async (url, init) => { chamadas.push({ url, init }); return fila.length > 1 ? fila.shift() : fila[0] },
    },
  }
}

test('envia o token no header e devolve o JSON', async () => {
  const amb = ambiente([resposta(200, [{ _id: 'o1' }])])
  const cliente = criarCliente({ token: 'tk', ...amb.opcoes })
  assert.deepEqual(await cliente.get('/obras'), [{ _id: 'o1' }])
  assert.equal(amb.chamadas[0].url, 'https://apiexterna.diariodeobra.app/v1/obras')
  assert.equal(amb.chamadas[0].init.headers.token, 'tk')
})

test('sem token não cria o cliente', () => {
  assert.throws(() => criarCliente({ token: '' }), /TOKEN_DIARIO/)
})

test('respeita o teto por minuto: a requisição excedente espera a janela liberar', async () => {
  const amb = ambiente([resposta(200, {})])
  const cliente = criarCliente({ token: 'tk', porMinuto: 2, ...amb.opcoes })
  await cliente.get('/a')
  await cliente.get('/b')
  assert.equal(amb.esperas.length, 0)
  await cliente.get('/c')
  assert.deepEqual(amb.esperas, [60200])
})

test('429 espera e tenta de novo', async () => {
  const amb = ambiente([resposta(429), resposta(200, { ok: 1 })])
  const cliente = criarCliente({ token: 'tk', esperaApos429: 65000, ...amb.opcoes })
  assert.deepEqual(await cliente.get('/x'), { ok: 1 })
  assert.deepEqual(amb.esperas, [65000])
  assert.equal(amb.chamadas.length, 2)
})

test('429 persistente desiste depois das tentativas', async () => {
  const amb = ambiente([resposta(429)])
  const cliente = criarCliente({ token: 'tk', tentativas429: 2, ...amb.opcoes })
  await assert.rejects(() => cliente.get('/x'), /429/)
  assert.equal(amb.chamadas.length, 3)
})

test('erro HTTP não vaza o token na mensagem', async () => {
  const amb = ambiente([resposta(500)])
  const cliente = criarCliente({ token: 'segredo-123', ...amb.opcoes })
  await assert.rejects(() => cliente.get('/obras'), (err) => {
    assert.match(err.message, /500/)
    assert.doesNotMatch(err.message, /segredo/)
    return true
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test server/diario-client.test.js`
Expected: FAIL com `Cannot find module './diario-client.js'`.

- [ ] **Step 3: Implementar**

Criar `server/diario-client.js`:

```js
// Cliente HTTP da API externa do Diário de Obra: token no header, teto de requisições por minuto e repetição em 429.

const BASE = 'https://apiexterna.diariodeobra.app/v1'

export function criarCliente({
  token,
  base = BASE,
  fetchImpl = fetch,
  agora = Date.now,
  dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  porMinuto = 130,
  esperaApos429 = 65000,
  tentativas429 = 5,
} = {}) {
  if (!token) throw new Error('TOKEN_DIARIO não configurado.')
  let marcas = []

  async function respeitarLimite() {
    for (;;) {
      const t = agora()
      marcas = marcas.filter((m) => t - m < 60000)
      if (marcas.length < porMinuto) break
      await dormir(60000 - (t - marcas[0]) + 200)
    }
    marcas.push(agora())
  }

  async function get(caminho) {
    for (let tentativa = 0; ; tentativa++) {
      await respeitarLimite()
      const res = await fetchImpl(base + caminho, { headers: { token } })
      if (res.status === 429 && tentativa < tentativas429) {
        await dormir(esperaApos429)
        continue
      }
      if (!res.ok) throw new Error(`Diário de Obra respondeu ${res.status} em ${caminho}`)
      return res.json()
    }
  }

  return { get }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test server/diario-client.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add server/diario-client.js server/diario-client.test.js
git commit -m "feat(diario): cliente HTTP com limite de taxa e repeticao em 429"
```

---

### Task 3: Orquestrador da sincronização

**Files:**
- Create: `server/diario-sync.js`
- Test: `server/diario-sync.test.js`

**Interfaces:**
- Consumes: `mapearObra`, `mapearRelatorio` (Task 1); qualquer objeto com `get(caminho)` (Task 2).
- Produces: `sincronizarDiario({ client, repo, log? }) → { obras, novos, alterados, removidos, erros[], status: 'ok'|'parcial'|'erro' }` e `executarSincronizacaoDiario(deps)` (igual, mas devolve `{ ignorado: true }` se já houver carga em andamento no processo). Contrato do `repo` (implementado na Task 5):
  - `iniciarCarga() → Promise<number>`
  - `finalizarCarga(id, { obras, novos, alterados, removidos, erros, status }) → Promise<void>`
  - `salvarObra(linhaObra) → Promise<void>`
  - `modifiedPorRelatorio(obraId) → Promise<Map<relatorio_id, modified_api>>`
  - `salvarRelatorio(mapeado) → Promise<void>` (o retorno de `mapearRelatorio`)
  - `marcarRemovidos(obraId, idsPresentes[]) → Promise<number>`

- [ ] **Step 1: Escrever o teste**

Criar `server/diario-sync.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { sincronizarDiario, executarSincronizacaoDiario } from './diario-sync.js'

const LISTA = (id) => `/obras/${id}/relatorios?ordem=asc&limite=10000`
const DET = (o, r) => `/obras/${o}/relatorios/${r}`
const obraItem = (id, nome = `Obra ${id}`) => ({ _id: id, nome, status: { id: 3, descricao: 'Em Andamento' }, totalRelatorios: 0, totalFotos: 0, modified: 'x' })
const item = (id, modified = 'm1', data = '01/08/2026') => ({ _id: id, data, modified })
const detalhe = (id, obra = 'O1', modified = 'm1', data = '01/08/2026') => ({ _id: id, data, numero: 1, obra: { _id: obra, nome: 'x' }, modified, created: modified })

function clienteFalso(rotas) {
  const chamadas = []
  return {
    chamadas,
    async get(caminho) {
      chamadas.push(caminho)
      const r = rotas[caminho]
      if (r instanceof Error) throw r
      if (r === undefined) throw new Error(`sem rota ${caminho}`)
      return r
    },
  }
}

function repoFalso(inicial = {}) {
  const relatorios = new Map(Object.entries(inicial))
  const reg = { salvos: [], obras: [], marcadosObras: [], removidos: [], cargas: [] }
  return {
    reg,
    async iniciarCarga() { return 1 },
    async finalizarCarga(id, r) { reg.cargas.push({ id, ...r }) },
    async salvarObra(o) { reg.obras.push(o.obra_id) },
    async modifiedPorRelatorio() { return new Map(relatorios) },
    async salvarRelatorio(m) { reg.salvos.push(m.relatorio.relatorio_id); relatorios.set(m.relatorio.relatorio_id, m.relatorio.modified_api) },
    async marcarRemovidos(obraId, ids) {
      reg.marcadosObras.push(obraId)
      const sumidos = [...relatorios.keys()].filter((k) => !ids.includes(k))
      reg.removidos.push(...sumidos)
      return sumidos.length
    },
  }
}

test('primeira carga baixa o detalhe de todos os relatórios', async () => {
  const client = clienteFalso({
    '/obras': [obraItem('O1')], '/obras/O1': { grupo: null },
    [LISTA('O1')]: [item('r1'), item('r2')],
    [DET('O1', 'r1')]: detalhe('r1'), [DET('O1', 'r2')]: detalhe('r2'),
  })
  const repo = repoFalso()
  const r = await sincronizarDiario({ client, repo })
  assert.deepEqual(repo.reg.salvos, ['r1', 'r2'])
  assert.deepEqual([r.obras, r.novos, r.alterados, r.removidos, r.status], [1, 2, 0, 0, 'ok'])
  assert.equal(repo.reg.cargas[0].status, 'ok')
})

test('carga incremental baixa só o relatório novo e o alterado', async () => {
  const client = clienteFalso({
    '/obras': [obraItem('O1')], '/obras/O1': {},
    [LISTA('O1')]: [item('r1', 'm1'), item('r2', 'm2'), item('r3', 'm1')],
    [DET('O1', 'r2')]: detalhe('r2', 'O1', 'm2'), [DET('O1', 'r3')]: detalhe('r3'),
  })
  const repo = repoFalso({ r1: 'm1', r2: 'm1' })
  const r = await sincronizarDiario({ client, repo })
  assert.deepEqual(repo.reg.salvos.sort(), ['r2', 'r3'])
  assert.ok(!client.chamadas.includes(DET('O1', 'r1')))
  assert.deepEqual([r.novos, r.alterados], [1, 1])
})

test('relatório que sumiu da API é marcado como removido', async () => {
  const client = clienteFalso({ '/obras': [obraItem('O1')], '/obras/O1': {}, [LISTA('O1')]: [item('r1')] })
  const repo = repoFalso({ r1: 'm1', r9: 'm1' })
  const r = await sincronizarDiario({ client, repo })
  assert.deepEqual(repo.reg.removidos, ['r9'])
  assert.equal(r.removidos, 1)
})

test('lista vazia para obra que já tinha relatórios não remove nada e vira erro', async () => {
  const client = clienteFalso({ '/obras': [obraItem('O1')], '/obras/O1': {}, [LISTA('O1')]: [] })
  const repo = repoFalso({ r1: 'm1', r2: 'm1' })
  const r = await sincronizarDiario({ client, repo })
  assert.deepEqual(repo.reg.marcadosObras, [])
  assert.equal(r.status, 'parcial')
  assert.match(r.erros[0].erro, /lista vazia/)
})

test('falha na lista de uma obra não impede as outras nem marca remoções nela', async () => {
  const client = clienteFalso({
    '/obras': [obraItem('O1'), obraItem('O2')], '/obras/O1': {}, '/obras/O2': {},
    [LISTA('O1')]: new Error('boom'), [LISTA('O2')]: [item('r5')], [DET('O2', 'r5')]: detalhe('r5', 'O2'),
  })
  const repo = repoFalso()
  const r = await sincronizarDiario({ client, repo })
  assert.deepEqual(repo.reg.marcadosObras, ['O2'])
  assert.deepEqual(repo.reg.salvos, ['r5'])
  assert.equal(r.status, 'parcial')
  assert.equal(r.erros[0].obra, 'Obra O1')
})

test('falha em um relatório é registrada e os demais são salvos', async () => {
  const client = clienteFalso({
    '/obras': [obraItem('O1')], '/obras/O1': {}, [LISTA('O1')]: [item('r1'), item('r2')],
    [DET('O1', 'r1')]: new Error('500'), [DET('O1', 'r2')]: detalhe('r2'),
  })
  const repo = repoFalso()
  const r = await sincronizarDiario({ client, repo })
  assert.deepEqual(repo.reg.salvos, ['r2'])
  assert.equal(r.novos, 1)
  assert.equal(r.erros[0].relatorio, 'r1')
  assert.equal(r.status, 'parcial')
})

test('relatório com data inválida vira erro do relatório, sem derrubar a carga', async () => {
  const client = clienteFalso({
    '/obras': [obraItem('O1')], '/obras/O1': {}, [LISTA('O1')]: [item('r1')], [DET('O1', 'r1')]: detalhe('r1', 'O1', 'm1', 'ontem'),
  })
  const r = await sincronizarDiario({ client, repo: repoFalso() })
  assert.equal(r.status, 'parcial')
  assert.match(r.erros[0].erro, /data inválida/)
})

test('falha ao listar obras finaliza a carga com status erro', async () => {
  const client = clienteFalso({ '/obras': new Error('fora do ar') })
  const repo = repoFalso()
  const r = await sincronizarDiario({ client, repo })
  assert.equal(r.status, 'erro')
  assert.equal(repo.reg.cargas[0].status, 'erro')
})

test('duas execuções simultâneas: a segunda é ignorada', async () => {
  let liberar
  const trava = new Promise((res) => { liberar = res })
  const client = { async get(c) { if (c === '/obras') { await trava; return [] } throw new Error(c) } }
  const primeira = executarSincronizacaoDiario({ client, repo: repoFalso() })
  const segunda = await executarSincronizacaoDiario({ client, repo: repoFalso() })
  assert.deepEqual(segunda, { ignorado: true })
  liberar()
  assert.equal((await primeira).status, 'ok')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test server/diario-sync.test.js`
Expected: FAIL com `Cannot find module './diario-sync.js'`.

- [ ] **Step 3: Implementar**

Criar `server/diario-sync.js`:

```js
// Orquestra a carga do Diário de Obra: obras → lista de relatórios → detalhe só do que é novo ou mudou.
// `client` fala com a API e `repo` com o banco; ambos são injetados para permitir teste sem rede nem Postgres.
import { mapearObra, mapearRelatorio } from './diario-map.js'

export async function sincronizarDiario({ client, repo, log = () => {} }) {
  const cargaId = await repo.iniciarCarga()
  const resumo = { obras: 0, novos: 0, alterados: 0, removidos: 0, erros: [] }

  async function sincronizarObra(item) {
    const detalhe = await client.get(`/obras/${item._id}`)
    await repo.salvarObra(mapearObra(item, detalhe))
    resumo.obras++

    const lista = await client.get(`/obras/${item._id}/relatorios?ordem=asc&limite=10000`)
    if (!Array.isArray(lista)) throw new Error('Lista de relatórios em formato inesperado.')
    const conhecidos = await repo.modifiedPorRelatorio(item._id)

    for (const r of lista) {
      const antes = conhecidos.get(r._id)
      if (antes !== undefined && antes === r.modified) continue
      try {
        const bruto = await client.get(`/obras/${item._id}/relatorios/${r._id}`)
        await repo.salvarRelatorio(mapearRelatorio(bruto))
        if (antes === undefined) resumo.novos++
        else resumo.alterados++
      } catch (err) {
        resumo.erros.push({ obra: item.nome, relatorio: r._id, erro: err.message })
      }
    }

    if (lista.length === 0 && conhecidos.size > 0) {
      resumo.erros.push({ obra: item.nome, erro: 'API devolveu lista vazia para obra com relatórios; remoções ignoradas.' })
    } else {
      resumo.removidos += await repo.marcarRemovidos(item._id, lista.map((r) => r._id))
    }
    log(`[Diário] ${item.nome}: ${lista.length} relatórios na API`)
  }

  let fatal = null
  try {
    const obras = await client.get('/obras')
    if (!Array.isArray(obras)) throw new Error('Lista de obras em formato inesperado.')
    for (const item of obras) {
      try {
        await sincronizarObra(item)
      } catch (err) {
        resumo.erros.push({ obra: item.nome, erro: err.message })
      }
    }
  } catch (err) {
    fatal = err
    resumo.erros.push({ erro: err.message })
  }

  const status = fatal ? 'erro' : resumo.erros.length ? 'parcial' : 'ok'
  await repo.finalizarCarga(cargaId, { ...resumo, status })
  return { ...resumo, status }
}

let emExecucao = false

// Evita duas cargas ao mesmo tempo dentro do mesmo processo (cron sobreposto).
export async function executarSincronizacaoDiario(deps) {
  if (emExecucao) return { ignorado: true }
  emExecucao = true
  try {
    return await sincronizarDiario(deps)
  } finally {
    emExecucao = false
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test server/diario-sync.test.js`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add server/diario-sync.js server/diario-sync.test.js
git commit -m "feat(diario): orquestrador da sincronizacao incremental"
```

---

### Task 4: Consultas e indicadores puros

**Files:**
- Create: `server/diario-consulta.js`, `server/diario-indicadores.js`
- Test: `server/diario-consulta.test.js`, `server/diario-indicadores.test.js`

**Interfaces:**
- Produces (`diario-consulta.js`): `TABELAS` (chaves `relatorios, atividades, mao_obra, equipamentos, ocorrencias, fotos, cargas`); `montarConsulta(tabela, { obra, search, page, pageSize }) → { contagem: {sql, params}, dados: {sql, params}, paginacao: {page, pageSize, offset} }` (lança erro com `status: 400` para tabela desconhecida; `pageSize` limitado a 200); `validarData(valor, nome) → 'AAAA-MM-DD'|null` (lança erro `status: 400`); `montarUpsert(tabela, colunas, chave, { jsonb?, extras? }) → sql`.
- Produces (`diario-indicadores.js`): `diasSemDiario(datas, { inicio?, fim? }) → { corridos, comDiario, semDiario }`; `montarIndicadores(entrada, { dataInicio?, dataFim? })` → `{ efetivo, clima, ocorrencias, preenchimento }`. `entrada` traz as linhas do SQL da Task 5: `efetivoDia [{data,total}]`, `efetivoEmpreiteira [{chave,rotulo,total}]`, `efetivoFuncao [{rotulo,total}]`, `climaObra [{obra_id,obra_nome,relatorios,chuvosos,impraticaveis,parados,chuva_mm}]`, `tags [{tag,total}]`, `ocorrenciaTotais {ocorrencias,relatorios}`, `preenchimentoObra [{obra_id,obra_nome,relatorios,aprovados,em_revisao,preenchendo,pendentes_antigos,datas[]}]`.

- [ ] **Step 1: Escrever os testes**

Criar `server/diario-consulta.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { TABELAS, montarConsulta, validarData, montarUpsert } from './diario-consulta.js'

test('tabela desconhecida vira erro 400 (não vai para o SQL)', () => {
  assert.throws(() => montarConsulta('usuarios; DROP TABLE x'), (e) => e.status === 400 && /desconhecida/.test(e.message))
})

test('sem filtros: só exclui removidos, sem parâmetros de filtro', () => {
  const c = montarConsulta('relatorios')
  assert.match(c.contagem.sql, /FROM diario\.relatorio r JOIN diario\.obra o/)
  assert.match(c.contagem.sql, /WHERE r\.removido_em IS NULL/)
  assert.deepEqual(c.contagem.params, [])
  assert.deepEqual(c.dados.params, [50, 0])
  assert.match(c.dados.sql, /LIMIT \$1 OFFSET \$2/)
})

test('obra e busca entram como parâmetros posicionais, busca em minúsculas', () => {
  const c = montarConsulta('atividades', { obra: 'O1', search: '  Laje ', page: 2, pageSize: 25 })
  assert.deepEqual(c.contagem.params, ['O1', '%laje%'])
  assert.deepEqual(c.dados.params, ['O1', '%laje%', 25, 50])
  assert.match(c.dados.sql, /r\.obra_id = \$1/)
  assert.match(c.dados.sql, /LOWER\(a\.descricao\) LIKE \$2/)
  assert.match(c.dados.sql, /LIMIT \$3 OFFSET \$4/)
  assert.deepEqual(c.paginacao, { page: 2, pageSize: 25, offset: 50 })
})

test('cargas ignora filtro de obra e não filtra removidos', () => {
  const c = montarConsulta('cargas', { obra: 'O1' })
  assert.deepEqual(c.contagem.params, [])
  assert.doesNotMatch(c.contagem.sql, /WHERE/)
})

test('tamanho de página é limitado a 200 e valores absurdos caem no padrão', () => {
  assert.equal(montarConsulta('fotos', { pageSize: 9999 }).paginacao.pageSize, 200)
  assert.equal(montarConsulta('fotos', { pageSize: 'abc', page: -3 }).paginacao.pageSize, 50)
  assert.equal(montarConsulta('fotos', { pageSize: 'abc', page: -3 }).paginacao.page, 0)
})

test('toda coluna DATE selecionada é convertida para texto (o driver pg devolveria Date com fuso)', () => {
  for (const [nome, t] of Object.entries(TABELAS)) {
    if (nome === 'cargas') continue
    assert.match(t.select, /r\.data::text AS data/, nome)
    assert.doesNotMatch(t.select.replace(/r\.data::text AS data/g, ''), /\br\.data\b/, nome)
  }
})

test('toda consulta de relatório-filho devolve relatorio_id (a tela abre o diário pela linha)', () => {
  for (const [nome, t] of Object.entries(TABELAS)) {
    if (nome === 'cargas') continue
    assert.match(t.select, /r\.relatorio_id/, nome)
  }
})

test('validarData aceita AAAA-MM-DD real e vazio; rejeita o resto com 400', () => {
  assert.equal(validarData('2026-09-29', 'dataInicio'), '2026-09-29')
  assert.equal(validarData('', 'dataInicio'), null)
  assert.equal(validarData(undefined, 'dataInicio'), null)
  for (const ruim of ['29/09/2026', '2026-9-1', '2026-13-01', '2026-02-30', 'abc', "2026-01-01'; --"]) {
    assert.throws(() => validarData(ruim, 'dataInicio'), (e) => e.status === 400 && /dataInicio/.test(e.message), ruim)
  }
})

test('montarUpsert gera INSERT ... ON CONFLICT com jsonb e extras', () => {
  assert.equal(
    montarUpsert('t', ['id', 'nome', 'raw'], 'id', { jsonb: ['raw'], extras: [['em', 'now()']] }),
    'INSERT INTO t (id, nome, raw, em) VALUES ($1, $2, $3::jsonb, now()) ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, raw = EXCLUDED.raw, em = now()',
  )
})
```

Criar `server/diario-indicadores.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { diasSemDiario, montarIndicadores } from './diario-indicadores.js'

test('diasSemDiario conta dias corridos sem relatório entre a primeira e a última data', () => {
  assert.deepEqual(diasSemDiario(['2026-08-01', '2026-08-02', '2026-08-05']), { corridos: 5, comDiario: 3, semDiario: 2 })
  assert.deepEqual(diasSemDiario(['2026-08-01', '2026-08-01']), { corridos: 1, comDiario: 1, semDiario: 0 })
})

test('diasSemDiario respeita o período pedido dentro do intervalo da obra', () => {
  const datas = ['2026-08-01', '2026-08-05', '2026-08-10']
  assert.deepEqual(diasSemDiario(datas, { inicio: '2026-08-03', fim: '2026-08-10' }), { corridos: 8, comDiario: 2, semDiario: 6 })
  assert.deepEqual(diasSemDiario(datas, { inicio: '2026-07-01', fim: '2026-12-31' }), { corridos: 10, comDiario: 3, semDiario: 7 })
})

test('diasSemDiario sem datas ou com período fora do intervalo devolve zeros', () => {
  const zeros = { corridos: 0, comDiario: 0, semDiario: 0 }
  assert.deepEqual(diasSemDiario([]), zeros)
  assert.deepEqual(diasSemDiario(['2026-08-01'], { inicio: '2026-09-01', fim: '2026-09-30' }), zeros)
})

test('diasSemDiario atravessa mês e ano sem erro de fuso', () => {
  assert.deepEqual(diasSemDiario(['2025-12-30', '2026-01-02']), { corridos: 4, comDiario: 2, semDiario: 2 })
})

test('montarIndicadores com entrada vazia devolve zeros e listas vazias (obra sem dados)', () => {
  const r = montarIndicadores({})
  assert.deepEqual(r.efetivo, { porDia: [], porEmpreiteira: [], porFuncao: [], homensDia: 0, diasComEfetivo: 0, mediaPorDia: 0 })
  assert.deepEqual(r.clima.totais, { relatorios: 0, chuvosos: 0, impraticaveis: 0, parados: 0, chuvaMm: 0 })
  assert.deepEqual(r.ocorrencias, { total: 0, relatorios: 0, porTag: [] })
  assert.equal(r.preenchimento.totais.semDiario, 0)
  assert.deepEqual(r.preenchimento.porObra, [])
})

test('montarIndicadores soma totais e converte nomes das colunas', () => {
  const r = montarIndicadores({
    efetivoDia: [{ data: '2026-08-01', total: 10 }, { data: '2026-08-02', total: '15' }],
    efetivoEmpreiteira: [{ chave: 'PEREIRA DECOL', rotulo: 'Pereira Decol', total: '25' }],
    efetivoFuncao: [{ rotulo: 'Pedreiro', total: 12 }],
    climaObra: [
      { obra_id: 'O1', obra_nome: 'Obra 1', relatorios: 2, chuvosos: 1, impraticaveis: 1, parados: 0, chuva_mm: '5.25' },
      { obra_id: 'O2', obra_nome: 'Obra 2', relatorios: 3, chuvosos: 2, impraticaveis: 0, parados: 1, chuva_mm: '0.2' },
    ],
    tags: [{ tag: 'Reunião', total: '4' }],
    ocorrenciaTotais: { ocorrencias: 7, relatorios: 5 },
    preenchimentoObra: [{
      obra_id: 'O1', obra_nome: 'Obra 1', relatorios: 3, aprovados: 2, em_revisao: 1, preenchendo: 0,
      pendentes_antigos: 1, datas: ['2026-08-01', '2026-08-02', '2026-08-04'],
    }],
  }, { dataInicio: null, dataFim: null })
  assert.equal(r.efetivo.homensDia, 25)
  assert.equal(r.efetivo.mediaPorDia, 12.5)
  assert.equal(r.efetivo.porDia[1].total, 15)
  assert.deepEqual(r.clima.totais, { relatorios: 5, chuvosos: 3, impraticaveis: 1, parados: 1, chuvaMm: 5.5 })
  assert.equal(r.ocorrencias.porTag[0].total, 4)
  assert.deepEqual(r.preenchimento.porObra[0], {
    obraId: 'O1', obraNome: 'Obra 1', relatorios: 3, aprovados: 2, emRevisao: 1, preenchendo: 0,
    pendentesAntigos: 1, corridos: 4, comDiario: 3, semDiario: 1,
  })
  assert.equal(r.preenchimento.totais.pendentesAntigos, 1)
  assert.equal(r.preenchimento.totais.semDiario, 1)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test server/diario-consulta.test.js server/diario-indicadores.test.js`
Expected: FAIL com `Cannot find module`.

- [ ] **Step 3: Implementar**

Criar `server/diario-consulta.js`:

```js
// Montagem pura de SQL do Diário de Obra: consultas paginadas da aba Dados Diário e upserts da sincronização.
// Nomes de tabela e coluna vêm só das constantes abaixo; valores sempre vão por parâmetro.

const DATA_R = 'r.data::text AS data'
const JUNTA_OBRA = 'JOIN diario.obra o ON o.obra_id = r.obra_id'
const filha = (tabela, alias) =>
  `FROM diario.${tabela} ${alias} JOIN diario.relatorio r ON r.relatorio_id = ${alias}.relatorio_id ${JUNTA_OBRA}`
const ORDEM_R = 'r.data DESC, r.numero DESC'
const BASE = 'r.removido_em IS NULL'

export const TABELAS = {
  relatorios: {
    select: `r.relatorio_id, r.obra_id, o.nome AS obra_nome, ${DATA_R}, r.numero, r.dia_semana, r.status,
      r.clima_manha, r.condicao_manha, r.clima_tarde, r.condicao_tarde, r.clima_noite, r.condicao_noite,
      r.indice_pluviometrico, r.dia_parado, r.dia_chuvoso, r.dia_impraticavel, r.total_fotos,
      r.criado_por, r.criado_em::text AS criado_em, r.modificado_por, r.modificado_em::text AS modificado_em`,
    from: `FROM diario.relatorio r ${JUNTA_OBRA}`,
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: ORDEM_R,
    busca: ['o.nome', 'r.status', 'r.criado_por', 'r.modificado_por', 'CAST(r.numero AS TEXT)'],
  },
  atividades: {
    select: `a.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, a.descricao, a.observacao, a.status, a.porcentagem, a.total_fotos`,
    from: filha('atividade', 'a'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, a.id`,
    busca: ['o.nome', 'a.descricao', 'a.observacao', 'a.status'],
  },
  mao_obra: {
    select: `m.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, m.funcao, m.quantidade, m.empreiteira`,
    from: filha('mao_obra', 'm'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, m.id`,
    busca: ['o.nome', 'm.funcao', 'm.empreiteira'],
  },
  equipamentos: {
    select: `e.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, e.descricao, e.quantidade`,
    from: filha('equipamento', 'e'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, e.id`,
    busca: ['o.nome', 'e.descricao'],
  },
  ocorrencias: {
    select: `oc.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, oc.descricao,
      array_to_string(oc.tags, ', ') AS tags, oc.paralisacao`,
    from: filha('ocorrencia', 'oc'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, oc.id`,
    busca: ['o.nome', 'oc.descricao', "array_to_string(oc.tags, ', ')"],
  },
  fotos: {
    select: `f.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, f.url, f.url_miniatura, f.descricao, f.origem`,
    from: filha('foto', 'f'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, f.id`,
    busca: ['o.nome', 'f.descricao', 'f.origem'],
  },
  cargas: {
    select: `c.id, c.iniciada_em::text AS iniciada_em, c.finalizada_em::text AS finalizada_em, c.status,
      c.obras, c.novos, c.alterados, c.removidos, jsonb_array_length(c.erros) AS erros`,
    from: 'FROM diario.carga c',
    obraColuna: null,
    base: null,
    orderBy: 'c.id DESC',
    busca: ['c.status'],
  },
}

export function montarConsulta(tabela, { obra = '', search = '', page = 0, pageSize = 50 } = {}) {
  const t = TABELAS[tabela]
  if (!t) throw Object.assign(new Error(`Tabela do Diário desconhecida: ${tabela}`), { status: 400 })

  const condicoes = []
  const params = []
  if (t.base) condicoes.push(t.base)
  if (obra && t.obraColuna) {
    params.push(obra)
    condicoes.push(`${t.obraColuna} = $${params.length}`)
  }
  const termo = String(search || '').trim().toLowerCase()
  if (termo) {
    params.push(`%${termo}%`)
    condicoes.push(`(${t.busca.map((c) => `LOWER(${c}) LIKE $${params.length}`).join(' OR ')})`)
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''

  const tamanho = Math.min(200, Math.max(1, Math.trunc(Number(pageSize)) || 50))
  const pagina = Math.max(0, Math.trunc(Number(page)) || 0)
  const deslocamento = pagina * tamanho
  const n = params.length

  return {
    contagem: { sql: `SELECT COUNT(*)::int AS total ${t.from} ${where}`, params: [...params] },
    dados: {
      sql: `SELECT ${t.select} ${t.from} ${where} ORDER BY ${t.orderBy} LIMIT $${n + 1} OFFSET $${n + 2}`,
      params: [...params, tamanho, deslocamento],
    },
    paginacao: { page: pagina, pageSize: tamanho, offset: deslocamento },
  }
}

export function validarData(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null
  const texto = String(valor)
  let valida = false
  try {
    valida = /^\d{4}-\d{2}-\d{2}$/.test(texto) && new Date(`${texto}T00:00:00Z`).toISOString().slice(0, 10) === texto
  } catch {
    valida = false
  }
  if (!valida) throw Object.assign(new Error(`${nome} deve estar no formato AAAA-MM-DD.`), { status: 400 })
  return texto
}

// extras: [[coluna, expressaoSql]] aplicadas tanto no INSERT quanto no UPDATE (ex.: atualizado_em = now()).
export function montarUpsert(tabela, colunas, chave, { jsonb = [], extras = [] } = {}) {
  const valores = colunas.map((c, i) => (jsonb.includes(c) ? `$${i + 1}::jsonb` : `$${i + 1}`))
  const colunasInsert = [...colunas, ...extras.map(([c]) => c)]
  const valoresInsert = [...valores, ...extras.map(([, e]) => e)]
  const atualizacoes = [
    ...colunas.filter((c) => c !== chave).map((c) => `${c} = EXCLUDED.${c}`),
    ...extras.map(([c, e]) => `${c} = ${e}`),
  ]
  return `INSERT INTO ${tabela} (${colunasInsert.join(', ')}) VALUES (${valoresInsert.join(', ')}) ON CONFLICT (${chave}) DO UPDATE SET ${atualizacoes.join(', ')}`
}
```

Criar `server/diario-indicadores.js`:

```js
// Cálculos puros dos indicadores do Diário de Obra. O SQL (diario-db.js) só agrega; a forma final é montada aqui.

const DIA_MS = 86400000
const utc = (iso) => {
  const [a, m, d] = iso.split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}
const soma = (linhas, campo) => linhas.reduce((t, l) => t + (Number(l[campo]) || 0), 0)
const arredondar = (n) => Math.round(n * 10) / 10

// Dias corridos entre a primeira e a última data (limitados pelo período pedido) sem relatório.
// Não desconta domingo nem feriado: é um número informativo.
export function diasSemDiario(datas, { inicio = null, fim = null } = {}) {
  const unicas = [...new Set(datas)].sort()
  const zero = { corridos: 0, comDiario: 0, semDiario: 0 }
  if (!unicas.length) return zero
  const de = inicio && inicio > unicas[0] ? inicio : unicas[0]
  const ate = fim && fim < unicas[unicas.length - 1] ? fim : unicas[unicas.length - 1]
  if (de > ate) return zero
  const corridos = Math.round((utc(ate) - utc(de)) / DIA_MS) + 1
  const comDiario = unicas.filter((d) => d >= de && d <= ate).length
  return { corridos, comDiario, semDiario: corridos - comDiario }
}

export function montarIndicadores(entrada, { dataInicio = null, dataFim = null } = {}) {
  const {
    efetivoDia = [], efetivoEmpreiteira = [], efetivoFuncao = [], climaObra = [],
    tags = [], ocorrenciaTotais = { ocorrencias: 0, relatorios: 0 }, preenchimentoObra = [],
  } = entrada

  const homensDia = soma(efetivoDia, 'total')
  const preenchimento = preenchimentoObra.map((o) => {
    const dias = diasSemDiario(o.datas ?? [], { inicio: dataInicio, fim: dataFim })
    return {
      obraId: o.obra_id, obraNome: o.obra_nome, relatorios: o.relatorios, aprovados: o.aprovados,
      emRevisao: o.em_revisao, preenchendo: o.preenchendo, pendentesAntigos: o.pendentes_antigos,
      corridos: dias.corridos, comDiario: dias.comDiario, semDiario: dias.semDiario,
    }
  })

  return {
    efetivo: {
      porDia: efetivoDia.map((d) => ({ data: d.data, total: Number(d.total) })),
      porEmpreiteira: efetivoEmpreiteira.map((e) => ({ chave: e.chave, rotulo: e.rotulo, total: Number(e.total) })),
      porFuncao: efetivoFuncao.map((f) => ({ rotulo: f.rotulo, total: Number(f.total) })),
      homensDia,
      diasComEfetivo: efetivoDia.length,
      mediaPorDia: efetivoDia.length ? arredondar(homensDia / efetivoDia.length) : 0,
    },
    clima: {
      totais: {
        relatorios: soma(climaObra, 'relatorios'),
        chuvosos: soma(climaObra, 'chuvosos'),
        impraticaveis: soma(climaObra, 'impraticaveis'),
        parados: soma(climaObra, 'parados'),
        chuvaMm: arredondar(soma(climaObra, 'chuva_mm')),
      },
      porObra: climaObra.map((o) => ({
        obraId: o.obra_id, obraNome: o.obra_nome, relatorios: o.relatorios, chuvosos: o.chuvosos,
        impraticaveis: o.impraticaveis, parados: o.parados, chuvaMm: arredondar(Number(o.chuva_mm) || 0),
      })),
    },
    ocorrencias: {
      total: ocorrenciaTotais.ocorrencias,
      relatorios: ocorrenciaTotais.relatorios,
      porTag: tags.map((t) => ({ tag: t.tag, total: Number(t.total) })),
    },
    preenchimento: {
      totais: {
        relatorios: soma(preenchimento, 'relatorios'),
        aprovados: soma(preenchimento, 'aprovados'),
        emRevisao: soma(preenchimento, 'emRevisao'),
        preenchendo: soma(preenchimento, 'preenchendo'),
        pendentesAntigos: soma(preenchimento, 'pendentesAntigos'),
        semDiario: soma(preenchimento, 'semDiario'),
      },
      porObra: preenchimento,
    },
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test server/diario-consulta.test.js server/diario-indicadores.test.js`
Expected: PASS (15 testes).

- [ ] **Step 5: Commit**

```bash
git add server/diario-consulta.js server/diario-consulta.test.js server/diario-indicadores.js server/diario-indicadores.test.js
git commit -m "feat(diario): montagem de consultas e calculo dos indicadores"
```

---

### Task 5: Schema `diario` e acesso ao banco

**Files:**
- Modify: `server/schema.sql` (acrescentar ao final)
- Create: `server/diario-db.js`
- Test: `server/diario-db.integration.test.js` (roda só com `DIARIO_TEST_DB=1` e um banco cujo nome contenha `teste`)

**Interfaces:**
- Consumes: `query`, `withTransaction`, `initDb` e o `pool` (export default) de `server/db.js`; `COLUNAS_OBRA`, `COLUNAS_RELATORIO` (Task 1); `montarConsulta`, `montarUpsert` (Task 4); `montarIndicadores` (Task 4).
- Produces (`diario-db.js`):
  - `repoDiario` com exatamente o contrato do `repo` da Task 3.
  - `consultarDiario(tabela, { obra, search, page, pageSize }) → { records, total, page, pageSize, hasMore }`
  - `obrasDiario() → [{ obra_id, nome, status, relatorios, primeira_data, ultima_data }]`
  - `resumoDiario(obra) → { relatorios, atividades, maoObra, equipamentos, ocorrencias, fotos, ultimaCarga }`
  - `obterRelatorioDiario(id) → { relatorio, maoObra, equipamentos, ocorrencias, atividades, fotos } | null` (`relatorio` é o `to_jsonb` da linha + `obra_nome`, com `raw`)
  - `indicadoresDiario({ obra, dataInicio, dataFim }) → resultado de montarIndicadores`

- [ ] **Step 1: Subir um Postgres descartável**

O Docker Desktop precisa estar aberto (peça ao usuário se `docker ps` falhar). Banco de teste, porta local 55432, nunca a VPS:

```bash
docker run -d --name diario-teste -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=diario_teste -p 55432:5432 postgres:16-alpine
docker ps --filter name=diario-teste --format '{{.Status}}'
```
Expected: `Up ...`. Variáveis para os passos seguintes (bash):

```bash
export PGHOST=localhost PGPORT=55432 PGDATABASE=diario_teste PGUSER=postgres PGPASSWORD=teste DIARIO_TEST_DB=1
```

Se o shell não preservar o `export` entre chamadas de comando, repita essas variáveis como prefixo em cada comando (`PGHOST=localhost ... node ...`). Não exporte `TOKEN_DIARIO` vazio: ele é usado só como prefixo nos comandos que sobem o servidor.

- [ ] **Step 2: Escrever o teste de integração**

Criar `server/diario-db.integration.test.js`:

```js
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import pool, { initDb, query } from './db.js'
import {
  repoDiario, consultarDiario, obrasDiario, resumoDiario, obterRelatorioDiario, indicadoresDiario,
} from './diario-db.js'
import { mapearObra, mapearRelatorio } from './diario-map.js'

// Só roda contra um banco descartável: nunca apaga dados de um banco real.
const pular = process.env.DIARIO_TEST_DB !== '1' || !String(process.env.PGDATABASE || '').includes('teste')
const opcoes = { skip: pular && 'defina DIARIO_TEST_DB=1 e PGDATABASE com "teste"' }

after(() => pool.end())

const obraItem = { _id: 'teste-O1', nome: 'Obra Um', status: { id: 3, descricao: 'Em Andamento' }, totalRelatorios: 3, totalFotos: 2, modified: 'x' }
const relatorio = (id, data, statusId, extra = {}) => ({
  _id: id, data, numero: 1, diaDaSemana: 'Segunda-Feira',
  status: { id: statusId, descricao: statusId === 4 ? 'Aprovado' : 'Preenchendo Relatório' },
  obra: { _id: 'teste-O1', nome: 'Obra Um' }, modified: 'm1', created: 'm1', ...extra,
})
const A = relatorio('teste-rel-a', '10/08/2026', 4, {
  clima: { manha: { clima: 'Chuvoso', condicao: 'Impraticável', ativo: true }, tarde: { clima: 'Claro', condicao: 'Praticável', ativo: true }, noite: { ativo: false }, indicePluviometrico: 10 },
  maoDeObra: { padrao: [
    { descricao: 'Pedreiro', quantidade: 5, categoria: { descricao: 'Pereira Decol' } },
    { descricao: 'Servente', quantidade: 3, categoria: { descricao: 'PEREIRA  DECOL' } },
  ] },
  equipamentos: [{ descricao: 'Betoneira', quantidade: 2 }],
  atividades: [{ descricao: 'Concretagem', status: { descricao: 'Em Andamento' }, porcentagem: 40, fotos: [] }],
  ocorrencias: [{ descricao: 'Chuva', tags: [{ descricao: 'PARALISAÇÃO – CHUVA (ACIMA 5 mm)', checked: true }], fotos: [] }],
  galeriaDeFotos: [{ url: 'https://x/1.jpg', urlMiniatura: 'https://x/m1.jpg' }, { url: 'https://x/2.jpg', urlMiniatura: 'https://x/m2.jpg' }],
})
const B = relatorio('teste-rel-b', '10/08/2026', 1)
const C = relatorio('teste-rel-c', '13/08/2026', 1)

test('grava, consulta, indica, remove e restaura (SQL real)', opcoes, async () => {
  await initDb()
  await query('DELETE FROM diario.relatorio')
  await query('DELETE FROM diario.obra')
  await repoDiario.salvarObra(mapearObra(obraItem, { grupo: { descricao: 'Todas' } }))
  for (const bruto of [A, B, C]) await repoDiario.salvarRelatorio(mapearRelatorio(bruto))
  await repoDiario.salvarRelatorio(mapearRelatorio(A)) // idempotente: não duplica filhas

  const rels = await consultarDiario('relatorios', {})
  assert.equal(rels.total, 3)
  assert.equal(rels.records[0].data, '2026-08-13') // DATE volta como texto, sem deslocar o dia
  assert.equal((await consultarDiario('mao_obra', { obra: 'teste-O1' })).total, 2)
  assert.equal((await consultarDiario('relatorios', { search: 'preench' })).total, 2)
  assert.equal((await consultarDiario('relatorios', { obra: 'outra' })).total, 0)

  const [obra] = await obrasDiario()
  assert.deepEqual([obra.relatorios, obra.primeira_data, obra.ultima_data], [3, '2026-08-10', '2026-08-13'])

  const resumo = await resumoDiario('')
  assert.deepEqual([resumo.relatorios, resumo.atividades, resumo.maoObra, resumo.fotos], [3, 1, 2, 2])

  const det = await obterRelatorioDiario('teste-rel-a')
  assert.equal(det.relatorio.obra_nome, 'Obra Um')
  assert.equal(det.maoObra.length, 2)
  assert.equal(det.relatorio.raw._id, 'teste-rel-a')
  assert.equal(await obterRelatorioDiario('nao-existe'), null)

  const ind = await indicadoresDiario({})
  assert.equal(ind.efetivo.homensDia, 8)
  assert.deepEqual(ind.efetivo.porEmpreiteira[0], { chave: 'PEREIRA DECOL', rotulo: ind.efetivo.porEmpreiteira[0].rotulo, total: 8 })
  assert.deepEqual([ind.clima.totais.parados, ind.clima.totais.chuvosos, ind.clima.totais.chuvaMm], [1, 1, 10])
  assert.equal(ind.ocorrencias.porTag[0].tag, 'PARALISAÇÃO – CHUVA (ACIMA 5 mm)')
  assert.deepEqual(
    [ind.preenchimento.totais.relatorios, ind.preenchimento.totais.aprovados, ind.preenchimento.totais.preenchendo,
      ind.preenchimento.totais.pendentesAntigos, ind.preenchimento.totais.semDiario],
    [3, 1, 2, 2, 2],
  )
  assert.equal((await indicadoresDiario({ dataInicio: '2026-08-11', dataFim: '2026-08-31' })).preenchimento.totais.relatorios, 1)
  assert.equal((await indicadoresDiario({ obra: 'outra' })).efetivo.homensDia, 0)

  assert.equal(await repoDiario.marcarRemovidos('teste-O1', ['teste-rel-a', 'teste-rel-b']), 1)
  assert.equal((await consultarDiario('relatorios', {})).total, 2)
  assert.equal(await repoDiario.marcarRemovidos('teste-O1', ['teste-rel-a', 'teste-rel-b', 'teste-rel-c']), 0)
  assert.equal((await consultarDiario('relatorios', {})).total, 3)

  const carga = await repoDiario.iniciarCarga()
  await repoDiario.finalizarCarga(carga, { obras: 1, novos: 3, alterados: 0, removidos: 0, erros: [], status: 'ok' })
  assert.equal((await resumoDiario('')).ultimaCarga.status, 'ok')
  assert.equal((await consultarDiario('cargas', {})).records[0].status, 'ok')
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test server/diario-db.integration.test.js`
Expected: FAIL com `Cannot find module './diario-db.js'` (ou `SKIP` se as variáveis do Step 1 não estiverem exportadas — exporte e rode de novo).

- [ ] **Step 4: Acrescentar o DDL ao final de `server/schema.sql`**

```sql

-- Diário de Obra (API externa): schema de dono exclusivo do sincronizador (server/diario-sync.js).
CREATE SCHEMA IF NOT EXISTS diario;

CREATE TABLE IF NOT EXISTS diario.carga (
  id SERIAL PRIMARY KEY,
  iniciada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_em TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'executando',
  obras INTEGER NOT NULL DEFAULT 0,
  novos INTEGER NOT NULL DEFAULT 0,
  alterados INTEGER NOT NULL DEFAULT 0,
  removidos INTEGER NOT NULL DEFAULT 0,
  erros JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS diario.obra (
  obra_id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  status_id INTEGER,
  status TEXT,
  grupo TEXT,
  endereco TEXT,
  numero_contrato TEXT,
  data_inicio DATE,
  data_fim DATE,
  responsavel TEXT,
  cliente TEXT,
  total_relatorios INTEGER,
  total_fotos INTEGER,
  modified_api TEXT,
  raw JSONB,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diario.relatorio (
  relatorio_id TEXT PRIMARY KEY,
  obra_id TEXT NOT NULL REFERENCES diario.obra(obra_id),
  data DATE NOT NULL,
  data_fim DATE,
  numero INTEGER,
  dia_semana TEXT,
  status_id INTEGER,
  status TEXT,
  clima_manha TEXT,
  condicao_manha TEXT,
  clima_tarde TEXT,
  condicao_tarde TEXT,
  clima_noite TEXT,
  condicao_noite TEXT,
  indice_pluviometrico NUMERIC,
  dia_parado BOOLEAN NOT NULL DEFAULT false,
  dia_chuvoso BOOLEAN NOT NULL DEFAULT false,
  dia_impraticavel BOOLEAN NOT NULL DEFAULT false,
  criado_por TEXT,
  criado_em TIMESTAMP,
  modificado_por TEXT,
  modificado_em TIMESTAMP,
  created_api TEXT,
  modified_api TEXT,
  link_pdf TEXT,
  total_fotos INTEGER NOT NULL DEFAULT 0,
  removido_em TIMESTAMPTZ,
  raw JSONB NOT NULL,
  sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diario_relatorio_obra_data ON diario.relatorio (obra_id, data);

CREATE TABLE IF NOT EXISTS diario.mao_obra (
  id BIGSERIAL PRIMARY KEY,
  relatorio_id TEXT NOT NULL REFERENCES diario.relatorio(relatorio_id) ON DELETE CASCADE,
  funcao TEXT,
  quantidade INTEGER NOT NULL DEFAULT 0,
  empreiteira TEXT,
  empreiteira_norm TEXT
);
CREATE INDEX IF NOT EXISTS idx_diario_mao_obra_relatorio ON diario.mao_obra (relatorio_id);

CREATE TABLE IF NOT EXISTS diario.equipamento (
  id BIGSERIAL PRIMARY KEY,
  relatorio_id TEXT NOT NULL REFERENCES diario.relatorio(relatorio_id) ON DELETE CASCADE,
  descricao TEXT,
  quantidade INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_diario_equipamento_relatorio ON diario.equipamento (relatorio_id);

CREATE TABLE IF NOT EXISTS diario.ocorrencia (
  id BIGSERIAL PRIMARY KEY,
  relatorio_id TEXT NOT NULL REFERENCES diario.relatorio(relatorio_id) ON DELETE CASCADE,
  descricao TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  paralisacao BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_diario_ocorrencia_relatorio ON diario.ocorrencia (relatorio_id);

CREATE TABLE IF NOT EXISTS diario.atividade (
  id BIGSERIAL PRIMARY KEY,
  relatorio_id TEXT NOT NULL REFERENCES diario.relatorio(relatorio_id) ON DELETE CASCADE,
  descricao TEXT,
  observacao TEXT,
  status TEXT,
  porcentagem NUMERIC,
  total_fotos INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_diario_atividade_relatorio ON diario.atividade (relatorio_id);

CREATE TABLE IF NOT EXISTS diario.foto (
  id BIGSERIAL PRIMARY KEY,
  relatorio_id TEXT NOT NULL REFERENCES diario.relatorio(relatorio_id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_miniatura TEXT,
  descricao TEXT,
  origem TEXT
);
CREATE INDEX IF NOT EXISTS idx_diario_foto_relatorio ON diario.foto (relatorio_id);
```

- [ ] **Step 5: Implementar `server/diario-db.js`**

```js
// Acesso ao banco do Diário de Obra (schema `diario`): repositório da sincronização, consultas da aba e indicadores.
import { query, withTransaction } from './db.js'
import { COLUNAS_OBRA, COLUNAS_RELATORIO } from './diario-map.js'
import { montarConsulta, montarUpsert } from './diario-consulta.js'
import { montarIndicadores } from './diario-indicadores.js'

const UPSERT_OBRA = montarUpsert('diario.obra', COLUNAS_OBRA, 'obra_id', {
  jsonb: ['raw'],
  extras: [['atualizado_em', 'now()']],
})
const UPSERT_RELATORIO = montarUpsert('diario.relatorio', COLUNAS_RELATORIO, 'relatorio_id', {
  jsonb: ['raw'],
  extras: [['removido_em', 'NULL'], ['sincronizado_em', 'now()']],
})

const valores = (colunas, linha) => colunas.map((c) => (c === 'raw' ? JSON.stringify(linha.raw) : linha[c]))

// tabela → { chave no objeto mapeado, coluna → tipo SQL }. Só constantes entram no SQL.
const FILHAS = {
  mao_obra: { chave: 'maoObra', colunas: { funcao: 'text', quantidade: 'int', empreiteira: 'text', empreiteira_norm: 'text' } },
  equipamento: { chave: 'equipamentos', colunas: { descricao: 'text', quantidade: 'int' } },
  ocorrencia: { chave: 'ocorrencias', colunas: { descricao: 'text', tags: 'text[]', paralisacao: 'boolean' } },
  atividade: { chave: 'atividades', colunas: { descricao: 'text', observacao: 'text', status: 'text', porcentagem: 'numeric', total_fotos: 'int' } },
  foto: { chave: 'fotos', colunas: { url: 'text', url_miniatura: 'text', descricao: 'text', origem: 'text' } },
}

async function gravarFilhas(q, relatorioId, mapeado) {
  for (const [tabela, def] of Object.entries(FILHAS)) {
    await q(`DELETE FROM diario.${tabela} WHERE relatorio_id = $1`, [relatorioId])
    const linhas = mapeado[def.chave]
    if (!linhas.length) continue
    const colunas = Object.keys(def.colunas)
    const tipos = colunas.map((c) => `${c} ${def.colunas[c]}`).join(', ')
    await q(
      `INSERT INTO diario.${tabela} (relatorio_id, ${colunas.join(', ')})
       SELECT $1, ${colunas.map((c) => `x.${c}`).join(', ')}
       FROM jsonb_to_recordset($2::jsonb) AS x(${tipos})`,
      [relatorioId, JSON.stringify(linhas)],
    )
  }
}

export const repoDiario = {
  async iniciarCarga() {
    const { rows } = await query('INSERT INTO diario.carga DEFAULT VALUES RETURNING id')
    return rows[0].id
  },

  async finalizarCarga(id, r) {
    await query(
      `UPDATE diario.carga
          SET finalizada_em = now(), status = $2, obras = $3, novos = $4, alterados = $5, removidos = $6, erros = $7::jsonb
        WHERE id = $1`,
      [id, r.status, r.obras, r.novos, r.alterados, r.removidos, JSON.stringify(r.erros)],
    )
  },

  async salvarObra(obra) {
    await query(UPSERT_OBRA, valores(COLUNAS_OBRA, obra))
  },

  async modifiedPorRelatorio(obraId) {
    const { rows } = await query('SELECT relatorio_id, modified_api FROM diario.relatorio WHERE obra_id = $1', [obraId])
    return new Map(rows.map((r) => [r.relatorio_id, r.modified_api]))
  },

  async salvarRelatorio(mapeado) {
    await withTransaction(async (q) => {
      await q(UPSERT_RELATORIO, valores(COLUNAS_RELATORIO, mapeado.relatorio))
      await gravarFilhas(q, mapeado.relatorio.relatorio_id, mapeado)
    })
  },

  // Quem voltou a aparecer na API é restaurado; quem sumiu é marcado (nunca apagado). Devolve quantos sumiram agora.
  async marcarRemovidos(obraId, ids) {
    await query(
      `UPDATE diario.relatorio SET removido_em = NULL
        WHERE obra_id = $1 AND removido_em IS NOT NULL AND relatorio_id = ANY($2::text[])`,
      [obraId, ids],
    )
    const { rowCount } = await query(
      `UPDATE diario.relatorio SET removido_em = now()
        WHERE obra_id = $1 AND removido_em IS NULL AND NOT (relatorio_id = ANY($2::text[]))`,
      [obraId, ids],
    )
    return rowCount
  },
}

export async function consultarDiario(tabela, opcoes = {}) {
  const { contagem, dados, paginacao } = montarConsulta(tabela, opcoes)
  const [cont, lista] = await Promise.all([
    query(contagem.sql, contagem.params),
    query(dados.sql, dados.params),
  ])
  const total = cont.rows[0].total
  return {
    records: lista.rows,
    total,
    page: paginacao.page,
    pageSize: paginacao.pageSize,
    hasMore: paginacao.offset + paginacao.pageSize < total,
  }
}

export async function obrasDiario() {
  const { rows } = await query(`
    SELECT o.obra_id, o.nome, o.status,
           COUNT(r.relatorio_id) FILTER (WHERE r.removido_em IS NULL)::int AS relatorios,
           (MIN(r.data) FILTER (WHERE r.removido_em IS NULL))::text AS primeira_data,
           (MAX(r.data) FILTER (WHERE r.removido_em IS NULL))::text AS ultima_data
      FROM diario.obra o
      LEFT JOIN diario.relatorio r ON r.obra_id = o.obra_id
     GROUP BY o.obra_id, o.nome, o.status
     ORDER BY o.nome`)
  return rows
}

export async function resumoDiario(obra = '') {
  const params = obra ? [obra] : []
  const filtro = obra ? 'AND r.obra_id = $1' : ''
  const contar = (tabela) =>
    `(SELECT COUNT(*)::int FROM diario.${tabela} x JOIN diario.relatorio r ON r.relatorio_id = x.relatorio_id WHERE r.removido_em IS NULL ${filtro})`
  const [{ rows: [totais] }, { rows: [ultimaCarga] }] = await Promise.all([
    query(
      `SELECT (SELECT COUNT(*)::int FROM diario.relatorio r WHERE r.removido_em IS NULL ${filtro}) AS relatorios,
              ${contar('atividade')} AS atividades, ${contar('mao_obra')} AS "maoObra",
              ${contar('equipamento')} AS equipamentos, ${contar('ocorrencia')} AS ocorrencias, ${contar('foto')} AS fotos`,
      params,
    ),
    query(`SELECT id, iniciada_em::text AS iniciada_em, finalizada_em::text AS finalizada_em, status, novos, alterados, removidos
             FROM diario.carga ORDER BY id DESC LIMIT 1`),
  ])
  return { ...totais, ultimaCarga: ultimaCarga ?? null }
}

export async function obterRelatorioDiario(id) {
  const { rows } = await query(
    `SELECT to_jsonb(r) || jsonb_build_object('obra_nome', o.nome) AS relatorio
       FROM diario.relatorio r JOIN diario.obra o ON o.obra_id = r.obra_id
      WHERE r.relatorio_id = $1`,
    [id],
  )
  if (!rows.length) return null
  const filha = (sql) => query(sql, [id]).then((r) => r.rows)
  const [maoObra, equipamentos, ocorrencias, atividades, fotos] = await Promise.all([
    filha('SELECT funcao, quantidade, empreiteira FROM diario.mao_obra WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT descricao, quantidade FROM diario.equipamento WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT descricao, tags, paralisacao FROM diario.ocorrencia WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT descricao, observacao, status, porcentagem, total_fotos FROM diario.atividade WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT url, url_miniatura, descricao, origem FROM diario.foto WHERE relatorio_id = $1 ORDER BY id'),
  ])
  return { relatorio: rows[0].relatorio, maoObra, equipamentos, ocorrencias, atividades, fotos }
}

export async function indicadoresDiario({ obra = '', dataInicio = null, dataFim = null } = {}) {
  const params = [obra || null, dataInicio, dataFim]
  const onde = `r.removido_em IS NULL
    AND ($1::text IS NULL OR r.obra_id = $1)
    AND ($2::date IS NULL OR r.data >= $2::date)
    AND ($3::date IS NULL OR r.data <= $3::date)`
  const ler = (sql) => query(sql, params).then((r) => r.rows)
  const [efetivoDia, efetivoEmpreiteira, efetivoFuncao, climaObra, tags, ocorrenciaTotais, preenchimentoObra] = await Promise.all([
    ler(`SELECT r.data::text AS data, SUM(m.quantidade)::int AS total
           FROM diario.relatorio r JOIN diario.mao_obra m ON m.relatorio_id = r.relatorio_id
          WHERE ${onde} GROUP BY r.data ORDER BY r.data`),
    ler(`SELECT COALESCE(m.empreiteira_norm, 'SEM EMPREITEIRA') AS chave,
                COALESCE(MIN(m.empreiteira), 'Sem empreiteira') AS rotulo,
                SUM(m.quantidade)::int AS total
           FROM diario.relatorio r JOIN diario.mao_obra m ON m.relatorio_id = r.relatorio_id
          WHERE ${onde} GROUP BY 1 ORDER BY total DESC, chave LIMIT 15`),
    ler(`SELECT COALESCE(NULLIF(TRIM(m.funcao), ''), 'Sem função') AS rotulo, SUM(m.quantidade)::int AS total
           FROM diario.relatorio r JOIN diario.mao_obra m ON m.relatorio_id = r.relatorio_id
          WHERE ${onde} GROUP BY 1 ORDER BY total DESC, rotulo LIMIT 15`),
    ler(`SELECT o.obra_id, o.nome AS obra_nome, COUNT(*)::int AS relatorios,
                COUNT(*) FILTER (WHERE r.dia_chuvoso)::int AS chuvosos,
                COUNT(*) FILTER (WHERE r.dia_impraticavel)::int AS impraticaveis,
                COUNT(*) FILTER (WHERE r.dia_parado)::int AS parados,
                COALESCE(SUM(r.indice_pluviometrico), 0)::float AS chuva_mm
           FROM diario.relatorio r JOIN diario.obra o ON o.obra_id = r.obra_id
          WHERE ${onde} GROUP BY o.obra_id, o.nome ORDER BY o.nome`),
    ler(`SELECT t AS tag, COUNT(*)::int AS total
           FROM diario.relatorio r JOIN diario.ocorrencia oc ON oc.relatorio_id = r.relatorio_id, unnest(oc.tags) AS t
          WHERE ${onde} GROUP BY t ORDER BY total DESC, t LIMIT 15`),
    ler(`SELECT COUNT(oc.id)::int AS ocorrencias, COUNT(DISTINCT r.relatorio_id)::int AS relatorios
           FROM diario.relatorio r JOIN diario.ocorrencia oc ON oc.relatorio_id = r.relatorio_id
          WHERE ${onde}`),
    ler(`SELECT o.obra_id, o.nome AS obra_nome, COUNT(*)::int AS relatorios,
                COUNT(*) FILTER (WHERE r.status_id = 4)::int AS aprovados,
                COUNT(*) FILTER (WHERE r.status_id = 3)::int AS em_revisao,
                COUNT(*) FILTER (WHERE r.status_id = 1)::int AS preenchendo,
                COUNT(*) FILTER (WHERE r.status_id IS DISTINCT FROM 4
                                   AND r.data < ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 7))::int AS pendentes_antigos,
                array_agg(DISTINCT r.data::text) AS datas
           FROM diario.relatorio r JOIN diario.obra o ON o.obra_id = r.obra_id
          WHERE ${onde} GROUP BY o.obra_id, o.nome ORDER BY o.nome`),
  ])
  return montarIndicadores(
    { efetivoDia, efetivoEmpreiteira, efetivoFuncao, climaObra, tags, ocorrenciaTotais: ocorrenciaTotais[0], preenchimentoObra },
    { dataInicio, dataFim },
  )
}
```

- [ ] **Step 6: Rodar e ver passar**

Run (com as variáveis do Step 1 exportadas): `node --test server/diario-db.integration.test.js`
Expected: PASS (1 teste). Se falhar por sintaxe SQL, corrija a consulta apontada — o erro do Postgres nomeia a posição.

- [ ] **Step 7: Rodar toda a suíte do servidor**

Run: `npm run test:server`
Expected: todos passam; o teste de integração aparece como `skipped` quando as variáveis não estão definidas.

- [ ] **Step 8: Commit**

```bash
git add server/schema.sql server/diario-db.js server/diario-db.integration.test.js
git commit -m "feat(diario): schema diario e acesso ao banco verificados em Postgres real"
```

---

### Task 6: Rotas, agendamento e infraestrutura

**Files:**
- Modify: `server/index.js` (imports; rotas após o bloco de contratações, antes de `// Sync endpoint`; cron dentro de `start()`)
- Create: `scripts/sync-diario-local.mjs`
- Modify: `package.json` (script `sync:diario`), `.env.example`, `docker-compose.yml`, `docker-compose.coolify.yml`, `README.md`

**Interfaces:**
- Consumes: tudo de `diario-db.js` (Task 5), `criarCliente` (Task 2), `executarSincronizacaoDiario` (Task 3), `validarData` (Task 4), o helper `rota(fn)` já existente em `server/index.js` (envolve a resposta em `{ ok: true, ...retorno }` e trata `err.status`).
- Produces: `GET /api/diario/obras` → `{ ok, obras[] }`; `GET /api/diario/summary?obra=` → `{ ok, summary }`; `GET /api/diario/data?table&obra&page&limit&search` → `{ ok, records, total, page, pageSize, hasMore }`; `GET /api/diario/relatorios/:id` → `{ ok, relatorio, maoObra, equipamentos, ocorrencias, atividades, fotos }` (404 se não existe); `GET /api/diario/indicadores?obra&dataInicio&dataFim` → `{ ok, efetivo, clima, ocorrencias, preenchimento }`.

- [ ] **Step 1: Imports em `server/index.js`**

Depois do bloco `import { obterConfig, ... } from './contratacoes-db.js'`, acrescentar:

```js
import {
  repoDiario, consultarDiario, obrasDiario, resumoDiario, obterRelatorioDiario, indicadoresDiario,
} from './diario-db.js'
import { criarCliente } from './diario-client.js'
import { executarSincronizacaoDiario } from './diario-sync.js'
import { validarData } from './diario-consulta.js'
```

- [ ] **Step 2: Rotas**

Logo antes de `// Sync endpoint` (depois da última rota `/api/contratacoes/custo/importar`), acrescentar:

```js
// ---- Diário de Obra ------------------------------------------------------
const texto = (v) => String(v ?? '').trim()

app.get('/api/diario/obras', rota(async () => ({ obras: await obrasDiario() })))
app.get('/api/diario/summary', rota(async (req) => ({ summary: await resumoDiario(texto(req.query.obra)) })))
app.get('/api/diario/data', rota((req) => {
  const tabela = texto(req.query.table)
  if (!tabela) throw Object.assign(new Error('Parâmetro table é obrigatório.'), { status: 400 })
  return consultarDiario(tabela, {
    obra: texto(req.query.obra),
    search: texto(req.query.search),
    page: Number(req.query.page) || 0,
    pageSize: Number(req.query.limit) || 50,
  })
}))
app.get('/api/diario/relatorios/:id', rota(async (req) => {
  const detalhe = await obterRelatorioDiario(texto(req.params.id))
  if (!detalhe) throw Object.assign(new Error('Relatório não encontrado.'), { status: 404 })
  return detalhe
}))
app.get('/api/diario/indicadores', rota((req) => indicadoresDiario({
  obra: texto(req.query.obra),
  dataInicio: validarData(req.query.dataInicio, 'dataInicio'),
  dataFim: validarData(req.query.dataFim, 'dataFim'),
})))
```

- [ ] **Step 3: Cron em `start()`**

Dentro de `start()`, depois do bloco `if (cron.validate(schedule)) { ... }` do sync da Prevision e antes de `app.listen(...)`, acrescentar:

```js
    // Diário de Obra: só agenda se houver token. Padrão 21:00 (depois da sincronização da Prevision, às 20:00).
    const tokenDiario = process.env.TOKEN_DIARIO
    const scheduleDiario = process.env.CRON_SCHEDULE_DIARIO || '0 21 * * *'
    if (tokenDiario && cron.validate(scheduleDiario)) {
      cron.schedule(scheduleDiario, () => {
        console.log(`[CRON] Sincronizando Diário de Obra (${new Date().toISOString()})...`)
        executarSincronizacaoDiario({ client: criarCliente({ token: tokenDiario }), repo: repoDiario, log: console.log })
          .then((r) => console.log(`[CRON] Diário: ${r.ignorado ? 'já em execução' : `${r.status}, ${r.novos} novos, ${r.alterados} alterados, ${r.removidos} removidos, ${r.erros.length} erros`}`))
          .catch((err) => console.error('[CRON] Erro na sincronização do Diário:', err.message))
      })
      console.log(`Agendador do Diário de Obra ativo com regra: ${scheduleDiario}`)
    } else if (!tokenDiario) {
      console.log('TOKEN_DIARIO não definido: sincronização do Diário de Obra desativada.')
    }
```

- [ ] **Step 4: Script de carga manual**

Criar `scripts/sync-diario-local.mjs`:

```js
// Carga manual do Diário de Obra (primeira carga leva ~20 min por causa do limite de 150 req/min).
// Uso: npm run sync:diario   (usa TOKEN_DIARIO e as variáveis PG* do .env / ambiente)
import dotenv from 'dotenv'
import { initDb } from '../server/db.js'
import { criarCliente } from '../server/diario-client.js'
import { executarSincronizacaoDiario } from '../server/diario-sync.js'
import { repoDiario } from '../server/diario-db.js'

dotenv.config()
await initDb()
const resultado = await executarSincronizacaoDiario({
  client: criarCliente({ token: process.env.TOKEN_DIARIO }),
  repo: repoDiario,
  log: console.log,
})
console.log(JSON.stringify({ ...resultado, erros: resultado.erros?.slice(0, 10) }, null, 2))
process.exit(resultado.status === 'erro' ? 1 : 0)
```

Em `package.json`, dentro de `"scripts"`, depois de `"sync:analytics"`:

```json
    "sync:diario": "node scripts/sync-diario-local.mjs",
```

- [ ] **Step 5: Variáveis e compose**

Em `.env.example`, depois do bloco `CRON_SCHEDULE_APPROVO`:

```
# Diário de Obra (API externa). Token: sistema do Diário > Cadastros > Empresa > Gerar token.
TOKEN_DIARIO=
# Padrão: 21:00 todo dia. Primeira carga leva ~20 min (limite de 150 req/min); as seguintes são incrementais.
CRON_SCHEDULE_DIARIO=0 21 * * *
```

Em `docker-compose.yml` e em `docker-compose.coolify.yml`, no serviço `app`, logo depois da linha `CRON_SYNC_SCHEDULE: ${CRON_SYNC_SCHEDULE:-0 20 * * *}` (existe uma vez por arquivo), acrescentar com a mesma indentação:

```yaml
      TOKEN_DIARIO: ${TOKEN_DIARIO:-}
      CRON_SCHEDULE_DIARIO: ${CRON_SCHEDULE_DIARIO:-0 21 * * *}
```

- [ ] **Step 6: README**

Acrescentar ao final de `README.md` uma seção curta (português):

```markdown
## Diário de Obra

O app sincroniza os diários de obra (RDO) da API do App Diário de Obra para o schema `diario` do Postgres.
Requer `TOKEN_DIARIO` no `.env` (gerado no sistema do Diário em Cadastros > Empresa > Gerar token).
A sincronização roda pelo cron do servidor (`CRON_SCHEDULE_DIARIO`, padrão 21:00) e é incremental: baixa só o que é novo ou mudou.
Primeira carga (~20 min por causa do limite de 150 req/min): `docker compose exec app node scripts/sync-diario-local.mjs`
ou, no desenvolvimento, `npm run sync:diario`. A aba **Dados Diário** consulta o banco; os indicadores estão na Gestão à Vista.
```

- [ ] **Step 7: Verificar rotas contra o Postgres descartável**

Com as variáveis do Task 5/Step 1 exportadas e o banco de teste com os dados do teste de integração (rode `node --test server/diario-db.integration.test.js` antes se estiver vazio; o teste deixa 3 relatórios no banco):

```bash
TOKEN_DIARIO= PORT=3100 node server/index.js &
sleep 3
curl -s localhost:3100/api/diario/obras
curl -s "localhost:3100/api/diario/data?table=relatorios&limit=2"
curl -s "localhost:3100/api/diario/indicadores?dataInicio=2026-08-01&dataFim=2026-08-31"
curl -s -o /dev/null -w "%{http_code}\n" "localhost:3100/api/diario/indicadores?dataInicio=31-08-2026"
curl -s -o /dev/null -w "%{http_code}\n" "localhost:3100/api/diario/data?table=usuarios"
curl -s -o /dev/null -w "%{http_code}\n" "localhost:3100/api/diario/relatorios/nao-existe"
kill %1
```
Expected: os três primeiros devolvem JSON com `"ok":true` (obras com `teste-O1`; `records` de `relatorios`; `efetivo.homensDia` 8); os três últimos imprimem `400`, `400` e `404`. O log de partida mostra `TOKEN_DIARIO não definido` (o prefixo `TOKEN_DIARIO=` desliga o cron para o teste).

- [ ] **Step 8: Commit**

```bash
git add server/index.js scripts/sync-diario-local.mjs package.json .env.example docker-compose.yml docker-compose.coolify.yml README.md
git commit -m "feat(diario): rotas /api/diario, agendamento e variaveis de ambiente"
```

---

### Task 7: Aba Dados Diário (front-end)

**Files:**
- Create: `src/components/diario/formatos.ts`, `src/components/diario/diario-api.ts`, `src/components/diario/diario-columns.ts`, `src/components/diario/Diario.css`, `src/components/diario/DiarioRelatorioModal.tsx`, `src/DiarioView.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: as rotas da Task 6; `MegaColumnModal` e o tipo `MegaColumnDef` de `src/components/mega/*` (props genéricas: `isOpen, onClose, allColumns, activeColumnIds, onApplyColumns`); as classes CSS `mega-*` de `src/MegaView.css` (já carregado pelo `App`).
- Produces: `formatos.ts` → `fmtInteiro(v)`, `fmtNumero(v)`, `fmtData(v)`; `diario-api.ts` → tipos `TabelaDiario`, `ObraDiario`, `ResumoDiario`, `PaginaDiario`, `RelatorioDetalhe`, `IndicadoresDiario` e o objeto `diarioApi { obras(), resumo(obra), dados(tabela, {obra,page,limit,search}), relatorio(id), indicadores({obra,dataInicio,dataFim}) }`; `COLUNAS_DIARIO: Record<TabelaDiario, MegaColumnDef[]>`; componentes `DiarioView` e `DiarioRelatorioModal({ relatorioId, onClose })`.

- [ ] **Step 1: `src/components/diario/formatos.ts`**

```ts
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

const vazio = (v: unknown) => v === null || v === undefined || v === ''

export function fmtInteiro(v: unknown): string {
  return vazio(v) || !Number.isFinite(Number(v)) ? '-' : inteiro.format(Number(v))
}

export function fmtNumero(v: unknown): string {
  return vazio(v) || !Number.isFinite(Number(v)) ? '-' : decimal.format(Number(v))
}

// 'AAAA-MM-DD' ou 'AAAA-MM-DD HH:MM:SS' (também com 'T') → 'dd/mm/aaaa' ou 'dd/mm/aaaa HH:MM'
export function fmtData(v: unknown): string {
  if (typeof v !== 'string' || !v) return '-'
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return v
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`
}
```

- [ ] **Step 2: `src/components/diario/diario-api.ts`**

```ts
export type TabelaDiario = 'relatorios' | 'atividades' | 'mao_obra' | 'equipamentos' | 'ocorrencias' | 'fotos' | 'cargas'

export interface ObraDiario {
  obra_id: string
  nome: string
  status: string | null
  relatorios: number
  primeira_data: string | null
  ultima_data: string | null
}

export interface ResumoDiario {
  relatorios: number
  atividades: number
  maoObra: number
  equipamentos: number
  ocorrencias: number
  fotos: number
  ultimaCarga: { id: number; iniciada_em: string; finalizada_em: string | null; status: string; novos: number; alterados: number; removidos: number } | null
}

export interface PaginaDiario {
  records: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface RelatorioDetalhe {
  relatorio: Record<string, any> & { raw: Record<string, any> }
  maoObra: { funcao: string | null; quantidade: number; empreiteira: string | null }[]
  equipamentos: { descricao: string | null; quantidade: number }[]
  ocorrencias: { descricao: string | null; tags: string[]; paralisacao: boolean }[]
  atividades: { descricao: string | null; observacao: string | null; status: string | null; porcentagem: string | null; total_fotos: number }[]
  fotos: { url: string; url_miniatura: string | null; descricao: string | null; origem: string | null }[]
}

export interface IndicadoresDiario {
  efetivo: {
    porDia: { data: string; total: number }[]
    porEmpreiteira: { chave: string; rotulo: string; total: number }[]
    porFuncao: { rotulo: string; total: number }[]
    homensDia: number
    diasComEfetivo: number
    mediaPorDia: number
  }
  clima: {
    totais: { relatorios: number; chuvosos: number; impraticaveis: number; parados: number; chuvaMm: number }
    porObra: { obraId: string; obraNome: string; relatorios: number; chuvosos: number; impraticaveis: number; parados: number; chuvaMm: number }[]
  }
  ocorrencias: { total: number; relatorios: number; porTag: { tag: string; total: number }[] }
  preenchimento: {
    totais: { relatorios: number; aprovados: number; emRevisao: number; preenchendo: number; pendentesAntigos: number; semDiario: number }
    porObra: { obraId: string; obraNome: string; relatorios: number; aprovados: number; emRevisao: number; preenchendo: number; pendentesAntigos: number; corridos: number; comDiario: number; semDiario: number }[]
  }
}

async function obter<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const corpo = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(corpo.error || `Erro ${res.status}`)
  return corpo as T
}

export const diarioApi = {
  obras: () => obter<{ obras: ObraDiario[] }>('/api/diario/obras').then((r) => r.obras),
  resumo: (obra: string) =>
    obter<{ summary: ResumoDiario }>(`/api/diario/summary?obra=${encodeURIComponent(obra)}`).then((r) => r.summary),
  dados: (tabela: TabelaDiario, p: { obra: string; page: number; limit: number; search: string }) => {
    const q = new URLSearchParams({ table: tabela, page: String(p.page), limit: String(p.limit) })
    if (p.obra) q.set('obra', p.obra)
    if (p.search) q.set('search', p.search)
    return obter<PaginaDiario>(`/api/diario/data?${q}`)
  },
  relatorio: (id: string) => obter<RelatorioDetalhe>(`/api/diario/relatorios/${encodeURIComponent(id)}`),
  indicadores: (f: { obra: string; dataInicio: string; dataFim: string }) => {
    const q = new URLSearchParams()
    if (f.obra) q.set('obra', f.obra)
    if (f.dataInicio) q.set('dataInicio', f.dataInicio)
    if (f.dataFim) q.set('dataFim', f.dataFim)
    return obter<IndicadoresDiario>(`/api/diario/indicadores?${q}`)
  },
}
```

- [ ] **Step 3: `src/components/diario/diario-columns.ts`**

```ts
import type { MegaColumnDef } from '../mega/mega-columns'
import type { TabelaDiario } from './diario-api'

type Extra = Partial<Omit<MegaColumnDef, 'id' | 'label' | 'type'>>
const col = (id: string, label: string, type: MegaColumnDef['type'], extra: Extra = {}): MegaColumnDef =>
  ({ id, label, type, category: 'outros', defaultVisible: true, ...extra })

const obraEData: MegaColumnDef[] = [
  col('obra_nome', 'Obra', 'text', { category: 'identificacao' }),
  col('data', 'Data', 'date', { category: 'datas' }),
  col('numero', 'Nº', 'code', { category: 'identificacao', align: 'right' }),
]

export const COLUNAS_DIARIO: Record<TabelaDiario, MegaColumnDef[]> = {
  relatorios: [
    ...obraEData,
    col('dia_semana', 'Dia da semana', 'text', { category: 'datas', defaultVisible: false }),
    col('status', 'Status', 'badge', { category: 'status' }),
    col('clima_manha', 'Clima manhã', 'text'),
    col('condicao_manha', 'Condição manhã', 'text', { defaultVisible: false }),
    col('clima_tarde', 'Clima tarde', 'text'),
    col('condicao_tarde', 'Condição tarde', 'text', { defaultVisible: false }),
    col('clima_noite', 'Clima noite', 'text', { defaultVisible: false }),
    col('condicao_noite', 'Condição noite', 'text', { defaultVisible: false }),
    col('indice_pluviometrico', 'Chuva (mm)', 'number', { category: 'valores', align: 'right' }),
    col('dia_parado', 'Dia parado', 'text', { category: 'status' }),
    col('dia_chuvoso', 'Dia chuvoso', 'text', { category: 'status' }),
    col('dia_impraticavel', 'Impraticável', 'text', { category: 'status' }),
    col('total_fotos', 'Fotos', 'number', { category: 'valores', align: 'right' }),
    col('criado_por', 'Criado por', 'text', { category: 'identificacao' }),
    col('criado_em', 'Criado em', 'date', { category: 'datas', defaultVisible: false }),
    col('modificado_por', 'Modificado por', 'text', { category: 'identificacao', defaultVisible: false }),
    col('modificado_em', 'Modificado em', 'date', { category: 'datas', defaultVisible: false }),
  ],
  atividades: [
    ...obraEData,
    col('descricao', 'Atividade', 'text', { category: 'itens' }),
    col('observacao', 'Observação', 'text', { category: 'itens', defaultVisible: false }),
    col('status', 'Status', 'badge', { category: 'status' }),
    col('porcentagem', 'Avanço (%)', 'number', { category: 'valores', align: 'right' }),
    col('total_fotos', 'Fotos', 'number', { category: 'valores', align: 'right' }),
  ],
  mao_obra: [
    ...obraEData,
    col('funcao', 'Função', 'text', { category: 'itens' }),
    col('quantidade', 'Quantidade', 'number', { category: 'valores', align: 'right' }),
    col('empreiteira', 'Empreiteira', 'text', { category: 'itens' }),
  ],
  equipamentos: [
    ...obraEData,
    col('descricao', 'Equipamento', 'text', { category: 'itens' }),
    col('quantidade', 'Quantidade', 'number', { category: 'valores', align: 'right' }),
  ],
  ocorrencias: [
    ...obraEData,
    col('descricao', 'Ocorrência', 'text', { category: 'itens' }),
    col('tags', 'Tags', 'text', { category: 'itens' }),
    col('paralisacao', 'Paralisação', 'text', { category: 'status' }),
  ],
  fotos: [
    ...obraEData,
    col('url_miniatura', 'Foto', 'text', { category: 'itens' }),
    col('descricao', 'Descrição', 'text', { category: 'itens' }),
    col('origem', 'Origem', 'text', { category: 'itens' }),
  ],
  cargas: [
    col('id', 'Carga', 'code', { category: 'identificacao' }),
    col('iniciada_em', 'Início', 'date', { category: 'datas' }),
    col('finalizada_em', 'Fim', 'date', { category: 'datas' }),
    col('status', 'Status', 'badge', { category: 'status' }),
    col('obras', 'Obras', 'number', { category: 'valores', align: 'right' }),
    col('novos', 'Novos', 'number', { category: 'valores', align: 'right' }),
    col('alterados', 'Alterados', 'number', { category: 'valores', align: 'right' }),
    col('removidos', 'Removidos', 'number', { category: 'valores', align: 'right' }),
    col('erros', 'Erros', 'number', { category: 'valores', align: 'right' }),
  ],
}
```

- [ ] **Step 4: `src/components/diario/Diario.css`**

```css
/* Aba Dados Diário (usa também as classes mega-* de src/MegaView.css) */
.dd-miniatura { width: 56px; height: 40px; object-fit: cover; border-radius: 4px; display: block; }
.dd-linha-clicavel { cursor: pointer; }
.dd-info-carga { font-size: 12px; opacity: .7; margin: 0 0 8px; }

/* Modal do relatório */
.dd-modal-corpo { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
.dd-secao h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
.dd-grade-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 16px; }
.dd-grade-info span { display: block; font-size: 11.5px; opacity: .65; }
.dd-grade-info strong { font-size: 14px; }
.dd-tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
.dd-tabela th, .dd-tabela td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border, #dde3e6); }
.dd-tabela th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
.dd-num { text-align: right !important; font-variant-numeric: tabular-nums; }
.dd-fotos { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.dd-foto { width: 100%; height: 84px; object-fit: cover; border-radius: 6px; display: block; }
.dd-etiquetas { display: flex; gap: 4px; flex-wrap: wrap; }
.dd-etiqueta { font-size: 11.5px; padding: 1px 8px; border-radius: 999px; background: rgba(0, 0, 0, .06); }
.dd-etiqueta.alerta { background: rgba(179, 38, 30, .1); color: #b3261e; }
.dd-lista { margin: 0; padding-left: 18px; font-size: 13px; }

/* Painel de indicadores (Gestão à Vista) */
.dd-indicadores { display: flex; flex-direction: column; gap: 16px; }
.dd-filtros { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
.dd-filtros label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.dd-filtros input, .dd-filtros select { font: inherit; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border, #dde3e6); background: var(--surface, #fff); color: inherit; }
.dd-btn { font: inherit; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border, #dde3e6); background: transparent; color: inherit; cursor: pointer; }
.dd-cartoes { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.dd-cartao { border: 1px solid var(--border, #dde3e6); border-radius: 8px; padding: 10px 12px; background: var(--surface, #fff); }
.dd-cartao span { display: block; font-size: 12px; opacity: .65; }
.dd-cartao strong { font-size: 22px; font-variant-numeric: tabular-nums; }
.dd-cartao small { display: block; opacity: .6; }
.dd-cartao.alerta strong { color: #b3261e; }
.dd-grade-graficos { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.dd-bloco { border: 1px solid var(--border, #dde3e6); border-radius: 8px; padding: 12px 14px; background: var(--surface, #fff); overflow-x: auto; }
.dd-bloco h4 { margin: 0 0 8px; }
.dd-svg { width: 100%; height: auto; }
.dd-barra { fill: #2f6f8f; }
.dd-eixo { font-size: 10px; fill: currentColor; opacity: .65; }
.dd-linha-eixo { stroke: currentColor; opacity: .3; }
.dd-hbar-linha { display: grid; grid-template-columns: minmax(90px, 40%) 1fr 56px; align-items: center; gap: 8px; font-size: 12.5px; padding: 2px 0; }
.dd-hbar-rotulo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-hbar-trilho { background: rgba(0, 0, 0, .06); border-radius: 4px; height: 10px; }
.dd-hbar-barra { background: #2f6f8f; height: 100%; border-radius: 4px; }
.dd-hbar-valor { text-align: right; font-variant-numeric: tabular-nums; }
.dd-vazio { opacity: .6; margin: 0; }
.dd-erro { color: #b3261e; margin: 0; }
```

- [ ] **Step 5: `src/components/diario/DiarioRelatorioModal.tsx`**

```tsx
import { Fragment, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import './Diario.css'
import { diarioApi, type RelatorioDetalhe } from './diario-api'
import { fmtData, fmtInteiro, fmtNumero } from './formatos'

type Comentario = { descricao: string; dataHora: string; usuario?: { nome?: string } }

export function DiarioRelatorioModal({ relatorioId, onClose }: { relatorioId: string | null; onClose: () => void }) {
  const [detalhe, setDetalhe] = useState<RelatorioDetalhe | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!relatorioId) return
    let vivo = true
    setDetalhe(null)
    setErro(null)
    diarioApi.relatorio(relatorioId)
      .then((d) => { if (vivo) setDetalhe(d) })
      .catch((e: Error) => { if (vivo) setErro(e.message) })
    return () => { vivo = false }
  }, [relatorioId])

  const efetivoPorEmpreiteira = useMemo(() => {
    const grupos = new Map<string, { funcao: string | null; quantidade: number }[]>()
    for (const m of detalhe?.maoObra ?? []) {
      const chave = m.empreiteira || 'Sem empreiteira'
      grupos.set(chave, [...(grupos.get(chave) ?? []), m])
    }
    return [...grupos.entries()].map(([empreiteira, itens]) => ({
      empreiteira,
      itens,
      total: itens.reduce((t, i) => t + i.quantidade, 0),
    }))
  }, [detalhe])

  if (!relatorioId) return null
  const r = detalhe?.relatorio
  const comentarios = ((r?.raw?.comentarios ?? []) as Comentario[])

  return (
    <div className="mega-modal-overlay" onClick={onClose}>
      <div className="mega-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="mega-modal-header">
          <div className="mega-modal-title">
            <h3>{r ? `${r.obra_nome} — Relatório nº ${r.numero ?? '-'}` : 'Diário de obra'}</h3>
            <p>{r ? `${fmtData(r.data)} · ${r.dia_semana ?? ''} · ${r.status ?? ''}` : 'Carregando…'}</p>
          </div>
          <button type="button" className="mega-modal-close" onClick={onClose} title="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="dd-modal-corpo">
          {erro && <p className="dd-erro">{erro}</p>}
          {!detalhe && !erro && <p className="dd-vazio">Carregando diário…</p>}
          {detalhe && r && (
            <>
              <section className="dd-secao">
                <h4>Clima</h4>
                <table className="dd-tabela">
                  <thead><tr><th>Período</th><th>Clima</th><th>Condição</th></tr></thead>
                  <tbody>
                    <tr><td>Manhã</td><td>{r.clima_manha ?? '-'}</td><td>{r.condicao_manha ?? '-'}</td></tr>
                    <tr><td>Tarde</td><td>{r.clima_tarde ?? '-'}</td><td>{r.condicao_tarde ?? '-'}</td></tr>
                    <tr><td>Noite</td><td>{r.clima_noite ?? '-'}</td><td>{r.condicao_noite ?? '-'}</td></tr>
                  </tbody>
                </table>
                <div className="dd-grade-info" style={{ marginTop: 8 }}>
                  <div><span>Chuva (mm)</span><strong>{fmtNumero(r.indice_pluviometrico)}</strong></div>
                  <div><span>Criado por</span><strong>{r.criado_por ?? '-'}</strong></div>
                  <div><span>Modificado por</span><strong>{r.modificado_por ?? '-'}</strong></div>
                  <div><span>Modificado em</span><strong>{fmtData(r.modificado_em)}</strong></div>
                </div>
                {r.link_pdf && (
                  <p style={{ margin: '8px 0 0' }}><a href={r.link_pdf} target="_blank" rel="noreferrer">Abrir PDF do relatório</a></p>
                )}
              </section>

              <section className="dd-secao">
                <h4>Atividades ({detalhe.atividades.length})</h4>
                {detalhe.atividades.length === 0 ? <p className="dd-vazio">Nenhuma atividade.</p> : (
                  <table className="dd-tabela">
                    <thead><tr><th>Atividade</th><th>Status</th><th className="dd-num">Avanço (%)</th><th className="dd-num">Fotos</th></tr></thead>
                    <tbody>
                      {detalhe.atividades.map((a, i) => (
                        <tr key={i}>
                          <td>{a.descricao ?? '-'}{a.observacao ? <><br /><small>{a.observacao}</small></> : null}</td>
                          <td>{a.status ?? '-'}</td>
                          <td className="dd-num">{fmtNumero(a.porcentagem)}</td>
                          <td className="dd-num">{fmtInteiro(a.total_fotos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="dd-secao">
                <h4>Mão de obra ({fmtInteiro(detalhe.maoObra.reduce((t, m) => t + m.quantidade, 0))} pessoas)</h4>
                {efetivoPorEmpreiteira.length === 0 ? <p className="dd-vazio">Sem efetivo lançado.</p> : (
                  <table className="dd-tabela">
                    <thead><tr><th>Empreiteira / função</th><th className="dd-num">Quantidade</th></tr></thead>
                    <tbody>
                      {efetivoPorEmpreiteira.map((g) => (
                        <Fragment key={g.empreiteira}>
                          <tr><td><strong>{g.empreiteira}</strong></td><td className="dd-num"><strong>{fmtInteiro(g.total)}</strong></td></tr>
                          {g.itens.map((i, idx) => (
                            <tr key={`${g.empreiteira}-${idx}`}><td style={{ paddingLeft: 20 }}>{i.funcao ?? '-'}</td><td className="dd-num">{fmtInteiro(i.quantidade)}</td></tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="dd-secao">
                <h4>Equipamentos ({detalhe.equipamentos.length})</h4>
                {detalhe.equipamentos.length === 0 ? <p className="dd-vazio">Nenhum equipamento.</p> : (
                  <table className="dd-tabela">
                    <thead><tr><th>Equipamento</th><th className="dd-num">Quantidade</th></tr></thead>
                    <tbody>
                      {detalhe.equipamentos.map((e, i) => (
                        <tr key={i}><td>{e.descricao ?? '-'}</td><td className="dd-num">{fmtInteiro(e.quantidade)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="dd-secao">
                <h4>Ocorrências ({detalhe.ocorrencias.length})</h4>
                {detalhe.ocorrencias.length === 0 ? <p className="dd-vazio">Nenhuma ocorrência.</p> : (
                  <ul className="dd-lista">
                    {detalhe.ocorrencias.map((o, i) => (
                      <li key={i}>
                        {o.descricao ?? '-'}
                        <div className="dd-etiquetas">
                          {o.tags.map((t) => <span key={t} className={`dd-etiqueta ${o.paralisacao && t.toUpperCase().startsWith('PARALIS') ? 'alerta' : ''}`}>{t}</span>)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {comentarios.length > 0 && (
                <section className="dd-secao">
                  <h4>Comentários ({comentarios.length})</h4>
                  <ul className="dd-lista">
                    {comentarios.map((c, i) => (
                      <li key={i}>{c.descricao} <small>— {c.usuario?.nome ?? '-'}, {c.dataHora}</small></li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="dd-secao">
                <h4>Fotos ({detalhe.fotos.length})</h4>
                {detalhe.fotos.length === 0 ? <p className="dd-vazio">Sem fotos.</p> : (
                  <div className="dd-fotos">
                    {detalhe.fotos.map((f) => (
                      <a key={f.url} href={f.url} target="_blank" rel="noreferrer" title={f.descricao ?? ''}>
                        <img className="dd-foto" src={f.url_miniatura ?? f.url} alt={f.descricao ?? ''} loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
```


- [ ] **Step 6: `src/DiarioView.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle, Building2, Camera, ChevronLeft, ChevronRight, ClipboardList, ListChecks,
  RefreshCw, Search, Server, SlidersHorizontal, Users, Wrench,
} from 'lucide-react'
import './MegaView.css'
import './components/diario/Diario.css'
import { MegaColumnModal } from './components/mega/MegaColumnModal'
import type { MegaColumnDef } from './components/mega/mega-columns'
import { diarioApi, type ObraDiario, type ResumoDiario, type TabelaDiario } from './components/diario/diario-api'
import { COLUNAS_DIARIO } from './components/diario/diario-columns'
import { DiarioRelatorioModal } from './components/diario/DiarioRelatorioModal'
import { fmtData, fmtInteiro, fmtNumero } from './components/diario/formatos'

type Registro = Record<string, unknown>

const ABAS: { chave: TabelaDiario; rotulo: string; icone: LucideIcon; contador?: keyof Omit<ResumoDiario, 'ultimaCarga'> }[] = [
  { chave: 'relatorios', rotulo: 'Relatórios', icone: ClipboardList, contador: 'relatorios' },
  { chave: 'atividades', rotulo: 'Atividades', icone: ListChecks, contador: 'atividades' },
  { chave: 'mao_obra', rotulo: 'Mão de obra', icone: Users, contador: 'maoObra' },
  { chave: 'equipamentos', rotulo: 'Equipamentos', icone: Wrench, contador: 'equipamentos' },
  { chave: 'ocorrencias', rotulo: 'Ocorrências', icone: AlertCircle, contador: 'ocorrencias' },
  { chave: 'fotos', rotulo: 'Fotos', icone: Camera, contador: 'fotos' },
  { chave: 'cargas', rotulo: 'Status das cargas', icone: Server },
]

const chaveColunas = (t: TabelaDiario) => `dadosprevision_diario_colunas_${t}`

function lerColunas(tabela: TabelaDiario, todas: MegaColumnDef[]): string[] {
  try {
    const salvas = JSON.parse(localStorage.getItem(chaveColunas(tabela)) || 'null')
    if (Array.isArray(salvas)) {
      const validas = salvas.filter((id) => todas.some((c) => c.id === id))
      if (validas.length) return validas
    }
  } catch {
    // sem localStorage ou JSON inválido: usa o padrão
  }
  return todas.filter((c) => c.defaultVisible).map((c) => c.id)
}

function renderBadge(valor: unknown) {
  if (!valor) return <span className="mega-badge neutral">-</span>
  const s = String(valor).toUpperCase()
  const classe =
    s.includes('APROV') || s === 'OK' || s.includes('CONCLU') ? 'success'
      : s.includes('ERRO') || s.includes('PARALIS') ? 'danger'
        : s.includes('PREENCH') || s.includes('REVIS') || s.includes('PARCIAL') || s.includes('EXECUT') || s.includes('ANDAMENTO') ? 'warning'
          : 'info'
  return <span className={`mega-badge ${classe}`}>{String(valor)}</span>
}

function renderCelula(registro: Registro, col: MegaColumnDef) {
  const v = registro[col.id]
  if (col.id === 'url_miniatura') {
    return v ? (
      <a href={String(registro.url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <img className="dd-miniatura" src={String(v)} alt="" loading="lazy" />
      </a>
    ) : '-'
  }
  if (typeof v === 'boolean') return v ? 'Sim' : '-'
  if (col.type === 'badge') return renderBadge(v)
  if (col.type === 'date') return fmtData(v)
  if (col.type === 'number') return fmtNumero(v)
  return v === null || v === undefined || v === '' ? '-' : String(v)
}

export function DiarioView() {
  const [aba, setAba] = useState<TabelaDiario>('relatorios')
  const [obras, setObras] = useState<ObraDiario[]>([])
  const [obra, setObra] = useState('')
  const [resumo, setResumo] = useState<ResumoDiario | null>(null)
  const [registros, setRegistros] = useState<Registro[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(50)
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [colunasAbertas, setColunasAbertas] = useState(false)
  const [colunasAtivas, setColunasAtivas] = useState<string[]>([])
  const [relatorioAberto, setRelatorioAberto] = useState<string | null>(null)

  const todasColunas = COLUNAS_DIARIO[aba]
  const definicoes = useMemo(
    () => colunasAtivas.map((id) => todasColunas.find((c) => c.id === id)).filter((c): c is MegaColumnDef => Boolean(c)),
    [colunasAtivas, todasColunas],
  )

  useEffect(() => {
    diarioApi.obras().then(setObras).catch((e: Error) => setErro(e.message))
  }, [recarga])

  useEffect(() => {
    let vivo = true
    diarioApi.resumo(obra)
      .then((r) => { if (vivo) setResumo(r) })
      .catch(() => { if (vivo) setResumo(null) })
    return () => { vivo = false }
  }, [obra, recarga])

  useEffect(() => {
    const t = setTimeout(() => { setBuscaAplicada(busca.trim()); setPagina(0) }, 300)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    setColunasAtivas(lerColunas(aba, COLUNAS_DIARIO[aba]))
  }, [aba])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    diarioApi.dados(aba, { obra, page: pagina, limit: porPagina, search: buscaAplicada })
      .then((r) => { if (vivo) { setRegistros(r.records); setTotal(r.total) } })
      .catch((e: Error) => { if (vivo) { setRegistros([]); setTotal(0); setErro(e.message) } })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [aba, obra, pagina, porPagina, buscaAplicada, recarga])

  function trocarAba(nova: TabelaDiario) {
    setAba(nova)
    setPagina(0)
    setBusca('')
    setBuscaAplicada('')
  }

  function aplicarColunas(ids: string[]) {
    setColunasAtivas(ids)
    try { localStorage.setItem(chaveColunas(aba), JSON.stringify(ids)) } catch { /* sem localStorage */ }
  }

  const totalPaginas = Math.ceil(total / porPagina)
  const carga = resumo?.ultimaCarga

  return (
    <div className="mega-view-container">
      <p className="dd-info-carga">
        {carga
          ? `Última carga: ${fmtData(carga.finalizada_em ?? carga.iniciada_em)} — ${carga.status} (${fmtInteiro(carga.novos)} novos, ${fmtInteiro(carga.alterados)} alterados, ${fmtInteiro(carga.removidos)} removidos)`
          : 'Nenhuma carga do Diário de Obra registrada ainda.'}
      </p>

      <div className="mega-navigation-bar">
        <div className="mega-tabs">
          {ABAS.map((a) => (
            <button key={a.chave} type="button" className={`mega-tab-btn ${aba === a.chave ? 'active' : ''}`} onClick={() => trocarAba(a.chave)}>
              <a.icone size={15} />
              <span>{a.rotulo}</span>
              {a.contador && resumo && <span className="mega-tab-badge">{fmtInteiro(resumo[a.contador])}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mega-toolbar">
        <div className="mega-toolbar-left">
          {aba !== 'cargas' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building2 size={16} style={{ color: 'var(--text-muted)' }} />
              <select className="mega-filter-select" value={obra} onChange={(e) => { setObra(e.target.value); setPagina(0) }}>
                <option value="">Todas as obras ({obras.length})</option>
                {obras.map((o) => <option key={o.obra_id} value={o.obra_id}>{o.nome}</option>)}
              </select>
            </div>
          )}
          <div className="mega-search-box">
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar nesta tabela..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        <div className="mega-toolbar-right">
          <button type="button" className="mega-btn" onClick={() => setColunasAbertas(true)} title="Escolher quais colunas mostrar ou ocultar">
            <SlidersHorizontal size={14} className="text-primary" />
            <span>Colunas ({colunasAtivas.length}/{todasColunas.length})</span>
          </button>
          <button type="button" className="mega-btn" onClick={() => setRecarga((n) => n + 1)} title="Atualizar dados">
            <RefreshCw size={14} className={carregando ? 'mega-loading-spinner' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      <div className="mega-table-container">
        <div className="mega-table-scroll">
          <table className="mega-table">
            <thead>
              <tr>{definicoes.map((c) => <th key={c.id} className={c.align === 'right' ? 'num-cell' : ''}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={Math.max(1, definicoes.length)} className="text-center">
                  <div className="mega-loading-state"><RefreshCw size={24} className="mega-loading-spinner" /><span>Carregando registros do Diário de Obra...</span></div>
                </td></tr>
              ) : erro ? (
                <tr><td colSpan={Math.max(1, definicoes.length)} className="text-center">
                  <div className="mega-empty-state"><AlertCircle size={28} /><span>{erro}</span></div>
                </td></tr>
              ) : registros.length === 0 ? (
                <tr><td colSpan={Math.max(1, definicoes.length)} className="text-center">
                  <div className="mega-empty-state"><AlertCircle size={28} /><span>Nenhum registro encontrado para os filtros selecionados.</span></div>
                </td></tr>
              ) : (
                registros.map((registro, i) => {
                  const relId = registro.relatorio_id ? String(registro.relatorio_id) : null
                  return (
                    <tr
                      key={String(registro.id ?? registro.relatorio_id ?? i)}
                      className={relId ? 'dd-linha-clicavel' : undefined}
                      onClick={relId ? () => setRelatorioAberto(relId) : undefined}
                      title={relId ? 'Abrir o diário completo' : undefined}
                    >
                      {definicoes.map((c) => <td key={c.id} className={c.align === 'right' ? 'num-cell' : ''}>{renderCelula(registro, c)}</td>)}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mega-pagination">
          <div>
            Mostrando {total === 0 ? 0 : pagina * porPagina + 1} a {Math.min((pagina + 1) * porPagina, total)} de <strong>{fmtInteiro(total)}</strong> registros
          </div>
          <div className="mega-pagination-controls">
            <select className="mega-filter-select" value={porPagina} onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(0) }} style={{ padding: '4px 8px', fontSize: '11px' }}>
              <option value={25}>25 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>
            <button type="button" className="mega-page-btn" disabled={pagina === 0 || carregando} onClick={() => setPagina((p) => Math.max(0, p - 1))} title="Página anterior"><ChevronLeft size={16} /></button>
            <span>Página {pagina + 1} de {totalPaginas || 1}</span>
            <button type="button" className="mega-page-btn" disabled={pagina >= totalPaginas - 1 || carregando} onClick={() => setPagina((p) => p + 1)} title="Próxima página"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <MegaColumnModal
        isOpen={colunasAbertas}
        onClose={() => setColunasAbertas(false)}
        allColumns={todasColunas}
        activeColumnIds={colunasAtivas}
        onApplyColumns={aplicarColunas}
      />
      <DiarioRelatorioModal relatorioId={relatorioAberto} onClose={() => setRelatorioAberto(null)} />
    </div>
  )
}
```

- [ ] **Step 7: Registrar a aba em `src/App.tsx`**

Fazer exatamente estas edições (números de linha aproximados, use o texto para localizar):

1. Import de ícone: na lista de `lucide-react` (início do arquivo), acrescentar `ClipboardList,` em ordem alfabética (depois de `ChevronRight,`), se ainda não existir.
2. Depois de `import { MegaView } from './MegaView'` acrescentar: `import { DiarioView } from './DiarioView'`.
3. No tipo `DataView`, depois de `| 'dados_mega'`, acrescentar `| 'dados_diario'`.
4. No objeto `columns`, depois de `dados_mega: [],`, acrescentar `dados_diario: [],`.
5. Em `const lastDataView = useRef<Exclude<DataView, 'gestao_a_vista' | 'curvas' | 'dados_mega'>>('projects')` acrescentar `| 'dados_diario'` dentro do `Exclude`.
6. Logo antes de `const isMilestoneDashboard = ...` acrescentar: `const isTelaExterna = activeView === 'dados_mega' || activeView === 'dados_diario'`.
7. No cálculo de `activeTab`, no encadeamento que já tem `: activeView === 'dados_mega' ? { label: 'Dados Mega', icon: Layers3 }`, acrescentar antes do `: tabs.find(...)` final: `: activeView === 'dados_diario' ? { label: 'Dados Diário', icon: ClipboardList }`.
8. Em `changeView`: `if (view !== 'gestao_a_vista' && view !== 'curvas' && view !== 'dados_mega') lastDataView.current = view` → acrescentar `&& view !== 'dados_diario'`.
9. No botão "Dados Prevision": `activeView !== 'gestao_a_vista' && activeView !== 'curvas' && activeView !== 'dados_mega' ? 'active' : ''` → acrescentar `&& activeView !== 'dados_diario'`.
10. Depois do botão "Dados Mega" (o `<button ... onClick={() => changeView('dados_mega')}>...Dados Mega</button>`), acrescentar:

```tsx
          <button
            className={`header-view-button ${activeView === 'dados_diario' ? 'active' : ''}`}
            type="button"
            onClick={() => changeView('dados_diario')}
          >
            <ClipboardList size={16} />
            Dados Diário
          </button>
```
11. Trocar as quatro condições que escondem elementos nas telas externas para incluir a nova:
    - `{activeView !== 'curvas' && activeView !== 'dados_mega' && (` (seção `summary`) → `{activeView !== 'curvas' && !isTelaExterna && (`
    - `{activeView !== 'gestao_a_vista' && activeView !== 'curvas' && activeView !== 'dados_mega' && (` (nav `data-tabs`) → `{activeView !== 'gestao_a_vista' && activeView !== 'curvas' && !isTelaExterna && (`
    - `{activeView !== 'dados_mega' && (` (toolbar em `<section className="workspace">`) → `{!isTelaExterna && (`
    - `{activeView !== 'projects' && activeView !== 'gestao_a_vista' && activeView !== 'curvas' && activeView !== 'dados_mega' && (` (footer `pagination`) → `{activeView !== 'projects' && activeView !== 'gestao_a_vista' && activeView !== 'curvas' && !isTelaExterna && (`
12. No `table-panel`: trocar `activeView === 'dados_mega' ? 'mega-panel' : ''` por `isTelaExterna ? 'mega-panel' : ''`, e logo depois trocar `{activeView === 'dados_mega' ? (\n <MegaView />\n ) : loading ? (` por:

```tsx
          {activeView === 'dados_mega' ? (
            <MegaView />
          ) : activeView === 'dados_diario' ? (
            <DiarioView />
          ) : loading ? (
```

- [ ] **Step 8: Build e lint**

Run: `npm run build`
Expected: sem erros de TypeScript (`tsc -b && vite build`). Corrija tipos apontados (a nota do Step 5 sobre `Fragment` é o ponto mais provável).

Run: `npm run lint`
Expected: sem novos erros (avisos pré-existentes podem existir).

- [ ] **Step 9: Verificar no navegador**

Com as variáveis do Task 5/Step 1 exportadas e o banco de teste populado (rode o teste de integração antes):

```bash
TOKEN_DIARIO= PORT=3100 node server/index.js &
```
Abrir `http://localhost:3100` (preview do navegador embutido), clicar em **Dados Diário**. Verificar: contadores nas abas, os 3 relatórios de teste em "Relatórios" com data `13/08/2026` primeiro, filtro de obra, busca por "preench" (2 linhas), botão **Colunas** (ocultar/mostrar e persistir ao recarregar), clique numa linha abrindo o modal com mão de obra agrupada por empreiteira, e a aba "Status das cargas". Sem erros no console. Depois `kill %1`.

- [ ] **Step 10: Commit**

```bash
git add src/components/diario src/DiarioView.tsx src/App.tsx
git commit -m "feat(diario): aba Dados Diario com consulta ao banco e modal do relatorio"
```

---

### Task 8: Painel de indicadores na Gestão à Vista

**Files:**
- Create: `src/components/diario/graficos.tsx`, `src/components/diario/DiarioIndicadores.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `diarioApi.obras()`, `diarioApi.indicadores(...)`, tipos `IndicadoresDiario`, `ObraDiario` (Task 7); `fmtInteiro`, `fmtNumero`, `fmtData` (Task 7); classes `dd-*` de `Diario.css` (Task 7).
- Produces: `BarrasDia({ dados: {data, total}[] })`, `BarrasHorizontais({ itens: {rotulo, total}[] })`, `DiarioIndicadores()` (sem props).

- [ ] **Step 1: `src/components/diario/graficos.tsx`**

```tsx
import './Diario.css'
import { fmtData, fmtInteiro } from './formatos'

export function BarrasDia({ dados }: { dados: { data: string; total: number }[] }) {
  if (!dados.length) return <p className="dd-vazio">Sem dados no período.</p>
  const largura = 720
  const alturaBarras = 170
  const margemEsquerda = 34
  const max = Math.max(...dados.map((d) => d.total), 1)
  const faixa = (largura - margemEsquerda) / dados.length
  return (
    <svg viewBox={`0 0 ${largura} ${alturaBarras + 20}`} className="dd-svg" role="img" aria-label="Efetivo por dia">
      <text x={0} y={10} className="dd-eixo">{fmtInteiro(max)}</text>
      <line x1={margemEsquerda} y1={alturaBarras} x2={largura} y2={alturaBarras} className="dd-linha-eixo" />
      {dados.map((d, i) => {
        const altura = (d.total / max) * (alturaBarras - 14)
        return (
          <rect
            key={d.data}
            x={margemEsquerda + i * faixa + faixa * 0.1}
            y={alturaBarras - altura}
            width={Math.max(1, faixa * 0.8)}
            height={altura}
            className="dd-barra"
          >
            <title>{`${fmtData(d.data)}: ${fmtInteiro(d.total)}`}</title>
          </rect>
        )
      })}
      <text x={margemEsquerda} y={alturaBarras + 14} className="dd-eixo">{fmtData(dados[0].data)}</text>
      <text x={largura} y={alturaBarras + 14} textAnchor="end" className="dd-eixo">{fmtData(dados[dados.length - 1].data)}</text>
    </svg>
  )
}

export function BarrasHorizontais({ itens }: { itens: { rotulo: string; total: number }[] }) {
  if (!itens.length) return <p className="dd-vazio">Sem dados no período.</p>
  const max = Math.max(...itens.map((i) => i.total), 1)
  return (
    <div>
      {itens.map((i) => (
        <div className="dd-hbar-linha" key={i.rotulo}>
          <span className="dd-hbar-rotulo" title={i.rotulo}>{i.rotulo}</span>
          <div className="dd-hbar-trilho"><div className="dd-hbar-barra" style={{ width: `${(i.total / max) * 100}%` }} /></div>
          <span className="dd-hbar-valor">{fmtInteiro(i.total)}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: `src/components/diario/DiarioIndicadores.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import './Diario.css'
import { diarioApi, type IndicadoresDiario, type ObraDiario } from './diario-api'
import { BarrasDia, BarrasHorizontais } from './graficos'
import { fmtInteiro, fmtNumero } from './formatos'

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function Cartao({ rotulo, valor, detalhe, alerta = false }: { rotulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className={`dd-cartao ${alerta ? 'alerta' : ''}`}>
      <span>{rotulo}</span>
      <strong>{valor}</strong>
      {detalhe && <small>{detalhe}</small>}
    </div>
  )
}

export function DiarioIndicadores() {
  const [obras, setObras] = useState<ObraDiario[]>([])
  const [obra, setObra] = useState('')
  const [dataFim, setDataFim] = useState(hoje())
  const [dataInicio, setDataInicio] = useState(somarDias(hoje(), -30))
  const [dados, setDados] = useState<IndicadoresDiario | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    diarioApi.obras().then(setObras).catch((e: Error) => setErro(e.message))
  }, [])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    diarioApi.indicadores({ obra, dataInicio, dataFim })
      .then((d) => { if (vivo) setDados(d) })
      .catch((e: Error) => { if (vivo) { setDados(null); setErro(e.message) } })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [obra, dataInicio, dataFim])

  function periodo(dias: number | null) {
    if (dias === null) { setDataInicio(''); setDataFim(''); return }
    setDataFim(hoje())
    setDataInicio(somarDias(hoje(), -dias))
  }

  const semDados = dados && dados.preenchimento.totais.relatorios === 0

  return (
    <div className="gestao-card dd-indicadores">
      <div className="dd-filtros">
        <label>
          <span>Obra do Diário</span>
          <select value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Todas as obras ({obras.length})</option>
            {obras.map((o) => <option key={o.obra_id} value={o.obra_id}>{o.nome}</option>)}
          </select>
        </label>
        <label><span>De</span><input type="date" value={dataInicio} max={dataFim || undefined} onChange={(e) => setDataInicio(e.target.value)} /></label>
        <label><span>Até</span><input type="date" value={dataFim} min={dataInicio || undefined} onChange={(e) => setDataFim(e.target.value)} /></label>
        <button type="button" className="dd-btn" onClick={() => periodo(30)}>30 dias</button>
        <button type="button" className="dd-btn" onClick={() => periodo(90)}>90 dias</button>
        <button type="button" className="dd-btn" onClick={() => periodo(null)}>Tudo</button>
        {carregando && <RefreshCw size={16} className="spin" />}
      </div>

      {erro && <p className="dd-erro">{erro}</p>}
      {!erro && dados && semDados && <p className="dd-vazio">Sem dados no período para a seleção atual.</p>}

      {dados && !semDados && (
        <>
          <div className="dd-cartoes">
            <Cartao rotulo="Homens-dia" valor={fmtInteiro(dados.efetivo.homensDia)} detalhe={`média ${fmtNumero(dados.efetivo.mediaPorDia)} por dia com efetivo`} />
            <Cartao rotulo="Diários" valor={fmtInteiro(dados.preenchimento.totais.relatorios)} detalhe={`${fmtInteiro(dados.preenchimento.totais.aprovados)} aprovados`} />
            <Cartao rotulo="Dias parados" valor={fmtInteiro(dados.clima.totais.parados)} detalhe="tag PARALISAÇÃO" alerta={dados.clima.totais.parados > 0} />
            <Cartao rotulo="Dias chuvosos" valor={fmtInteiro(dados.clima.totais.chuvosos)} detalhe={`${fmtNumero(dados.clima.totais.chuvaMm)} mm registrados`} />
            <Cartao rotulo="Dias impraticáveis" valor={fmtInteiro(dados.clima.totais.impraticaveis)} />
            <Cartao rotulo="Ocorrências" valor={fmtInteiro(dados.ocorrencias.total)} detalhe={`em ${fmtInteiro(dados.ocorrencias.relatorios)} diários`} />
            <Cartao rotulo="Pendentes há +7 dias" valor={fmtInteiro(dados.preenchimento.totais.pendentesAntigos)} detalhe="não aprovados" alerta={dados.preenchimento.totais.pendentesAntigos > 0} />
            <Cartao rotulo="Dias sem diário" valor={fmtInteiro(dados.preenchimento.totais.semDiario)} detalhe="corridos, informativo" />
          </div>

          <div className="dd-grade-graficos">
            <div className="dd-bloco">
              <h4>Efetivo por dia (homens-dia)</h4>
              <BarrasDia dados={dados.efetivo.porDia} />
            </div>
            <div className="dd-bloco">
              <h4>Efetivo por empreiteira (top 15)</h4>
              <BarrasHorizontais itens={dados.efetivo.porEmpreiteira.map((e) => ({ rotulo: e.rotulo, total: e.total }))} />
            </div>
            <div className="dd-bloco">
              <h4>Efetivo por função (top 15)</h4>
              <BarrasHorizontais itens={dados.efetivo.porFuncao} />
            </div>
            <div className="dd-bloco">
              <h4>Ocorrências por tag (top 15)</h4>
              <BarrasHorizontais itens={dados.ocorrencias.porTag.map((t) => ({ rotulo: t.tag, total: t.total }))} />
            </div>
          </div>

          <div className="dd-bloco">
            <h4>Clima e dias parados por obra</h4>
            <table className="dd-tabela">
              <thead>
                <tr><th>Obra</th><th className="dd-num">Diários</th><th className="dd-num">Chuvosos</th><th className="dd-num">Impraticáveis</th><th className="dd-num">Parados</th><th className="dd-num">Chuva (mm)</th></tr>
              </thead>
              <tbody>
                {dados.clima.porObra.map((o) => (
                  <tr key={o.obraId}>
                    <td>{o.obraNome}</td><td className="dd-num">{fmtInteiro(o.relatorios)}</td><td className="dd-num">{fmtInteiro(o.chuvosos)}</td>
                    <td className="dd-num">{fmtInteiro(o.impraticaveis)}</td><td className="dd-num">{fmtInteiro(o.parados)}</td><td className="dd-num">{fmtNumero(o.chuvaMm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dd-bloco">
            <h4>Preenchimento dos diários por obra</h4>
            <table className="dd-tabela">
              <thead>
                <tr><th>Obra</th><th className="dd-num">Diários</th><th className="dd-num">Aprovados</th><th className="dd-num">Em revisão</th><th className="dd-num">Preenchendo</th><th className="dd-num">Pendentes +7d</th><th className="dd-num">Sem diário / corridos</th></tr>
              </thead>
              <tbody>
                {dados.preenchimento.porObra.map((o) => (
                  <tr key={o.obraId}>
                    <td>{o.obraNome}</td><td className="dd-num">{fmtInteiro(o.relatorios)}</td><td className="dd-num">{fmtInteiro(o.aprovados)}</td>
                    <td className="dd-num">{fmtInteiro(o.emRevisao)}</td><td className="dd-num">{fmtInteiro(o.preenchendo)}</td>
                    <td className="dd-num">{fmtInteiro(o.pendentesAntigos)}</td><td className="dd-num">{fmtInteiro(o.semDiario)} / {fmtInteiro(o.corridos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Registrar o painel em `src/App.tsx`**

1. Import: depois de `import { DiarioView } from './DiarioView'` acrescentar `import { DiarioIndicadores } from './components/diario/DiarioIndicadores'`.
2. Tipo: `type GestaoPanelTab = 'overview' | 'panel1' | 'panel2' | 'panel3' | 'matrix' | 'panel5' | 'milestones' | 'contratacoes'` → acrescentar `| 'diario'`.
3. Botão da sub-aba: depois do botão "Painel 6: Contratações" (o `<button ... setGestaoPanelTab('contratacoes')>...</button>`), antes de `<div className="gestao-top-actions">`, acrescentar:

```tsx
                <button
                  type="button"
                  className={`gestao-panel-tab-btn ${gestaoPanelTab === 'diario' ? 'active' : ''}`}
                  onClick={() => setGestaoPanelTab('diario')}
                >
                  <ListChecks size={14} />
                  <span>Painel 7: Indicadores diários</span>
                </button>
```
4. Conteúdo: logo depois do bloco `{gestaoPanelTab === 'contratacoes' && ( ... )}` (que termina antes de `{gestaoPanelTab === 'panel5' && (`), acrescentar:

```tsx
              {gestaoPanelTab === 'diario' && <DiarioIndicadores />}
```
5. Conferir com `Grep` por `gestaoPanelTab` que nenhuma outra lógica precisa conhecer o novo valor (impressão A4 usa `gestaoPanelTab === 'matrix'` apenas). O seletor de projeto/mês da barra superior continua visível mas não afeta este painel (ele tem os próprios filtros).

- [ ] **Step 4: Build e lint**

Run: `npm run build` — Expected: sem erros. Run: `npm run lint` — Expected: sem novos erros.

- [ ] **Step 5: Verificar no navegador**

Servidor como no Task 7/Step 9. Abrir **Gestão à Vista** → **Painel 7: Indicadores diários**. Verificar com os 3 relatórios de teste (datas de agosto/2026; use **Tudo** no período): cartões (Homens-dia 8, Diários 3, Dias parados 1, Pendentes +7d 2, Dias sem diário 2), gráfico de efetivo por dia com uma barra, barras por empreiteira "Pereira Decol" 8, tag "PARALISAÇÃO – CHUVA (ACIMA 5 mm)". Trocar a obra para uma inexistente não é possível pelo select; em vez disso, escolher datas sem relatórios (De 2026-01-01, Até 2026-01-31) e confirmar a mensagem "Sem dados no período" sem erro no console. Sem erros no console.

- [ ] **Step 6: Commit**

```bash
git add src/components/diario src/App.tsx
git commit -m "feat(diario): painel de indicadores diarios na Gestao a Vista"
```

---

### Task 9: Primeira carga real, verificação ponta a ponta e documentação

**Files:**
- Modify: `AGENTS.md` (nota curta sobre o schema `diario`)

**Interfaces:**
- Consumes: tudo das tarefas anteriores.

- [ ] **Step 1: Primeira carga real contra o banco de teste**

Primeiro limpe os dados de teste das tarefas anteriores (só existem no banco descartável):

```bash
docker exec diario-teste psql -U postgres -d diario_teste -c "DELETE FROM diario.relatorio; DELETE FROM diario.obra;"
```

Com as variáveis do Task 5/Step 1 exportadas (o `.env` fornece `TOKEN_DIARIO`):

```bash
npm run sync:diario
```
Expected (≈ 20 min; imprime `[Diário] <obra>: N relatórios na API` por obra) e, ao final, JSON com `"status": "ok"`, `"obras": 16`, `"novos": 2099`, `"erros": []`. Se aparecer `429` no log, o cliente já espera e repete sozinho.

- [ ] **Step 2: Conferir os totais contra a API**

```bash
docker exec diario-teste psql -U postgres -d diario_teste -c "SELECT (SELECT COUNT(*) FROM diario.obra) obras, (SELECT COUNT(*) FROM diario.relatorio WHERE removido_em IS NULL) relatorios, (SELECT COUNT(*) FROM diario.atividade) atividades, (SELECT COALESCE(SUM(quantidade),0) FROM diario.mao_obra) homens_dia, (SELECT COUNT(*) FROM diario.ocorrencia) ocorrencias, (SELECT COUNT(*) FROM diario.foto) fotos;"
```
Expected (dados de 2026-09-29; valem como conferência, a diferença de poucas unidades é normal se houver diários novos): obras 16, relatorios ≈ 2099, atividades ≈ 26758, homens_dia ≈ 80871, ocorrencias ≈ 1911, fotos ≈ 11.6 mil.

- [ ] **Step 3: Segunda carga é incremental e rápida**

```bash
npm run sync:diario
```
Expected: `"novos": 0` (ou só os diários criados nesse intervalo), poucos `alterados`, `"status": "ok"`, duração de poucos minutos (16 obras + 16 listagens + detalhes só do que mudou).

- [ ] **Step 4: Verificação no navegador com os dados reais**

`TOKEN_DIARIO= PORT=3100 node server/index.js &` e abrir `http://localhost:3100`. Em **Dados Diário**: contadores reais, abrir um relatório antigo e um de obra com fotos (ex.: ÍCARO | AG7) e confirmar mão de obra por empreiteira, ocorrências com tags e fotos carregando; testar busca por "concreto" na aba Atividades. Em **Gestão à Vista → Painel 7**: período **Tudo** e depois **30 dias**; confirmar que "Dias parados" é pequeno (≈ 18 no total histórico), "Dias chuvosos" ≈ 328 e que o efetivo por empreiteira mostra Thal Engenharia/Terceiros/Piemonte entre as maiores. Sem erros no console. `kill %1`.

- [ ] **Step 5: Suíte completa**

```bash
npm run test:server
npm run build
npm run lint
```
Rode `npm run test:server` num shell **sem** `DIARIO_TEST_DB` exportado: o teste de integração aparece como `skipped` (ele apaga `diario.relatorio`/`diario.obra` e já foi verificado na Task 5; não o rode sobre a carga real). Expected: todos os demais testes passam; build e lint sem erros.

- [ ] **Step 6: Documentar no `AGENTS.md`**

Em `AGENTS.md`, na seção "Cuidados ao trabalhar neste repositório", acrescentar como último item:

```markdown
- O schema `diario` é dono exclusivo do sincronizador do Diário de Obra (`server/diario-sync.js`, cron
  `CRON_SCHEDULE_DIARIO`); nada mais escreve nele. A API do Diário é somente leitura e limitada a 150
  requisições por minuto — a primeira carga (`npm run sync:diario`) leva ~20 min. `TOKEN_DIARIO` só vive no
  `.env`. Testes de SQL do Diário: `DIARIO_TEST_DB=1` com um Postgres descartável cujo nome contenha "teste".
```

- [ ] **Step 7: Limpar o ambiente de teste**

```bash
docker rm -f diario-teste
```
Expected: container removido; nenhum arquivo do teste fica no repositório (o JSON bruto da API fica fora dele).

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md
git commit -m "docs(diario): notas sobre o schema diario e a carga inicial"
```

---

## Self-Review (feita ao escrever o plano)

**Cobertura da spec:** fonte e limites → Tasks 2/3; schema `diario` e tabelas filhas → Task 5; normalização de empreiteira → Task 1; sinais dia parado/chuvoso/impraticável → Task 1; sincronização incremental, remoção sem apagar, falha isolada por obra, registro em `diario.carga` → Tasks 3/5; API `/api/diario/*` → Task 6; aba Dados Diário (sub-abas, filtro de obra, busca, paginação, colunas configuráveis, modal do relatório com fotos) → Task 7; painel de indicadores na Gestão à Vista com seletor próprio de obra e período → Task 8; env/compose/README → Task 6; testes puros + SQL em Postgres descartável + verificação no navegador → Tasks 1–9. Fora de escopo respeitado (sem cruzamento Prevision/Mega, sem controle de material/checklist/horário, sem visões salvas).

**Placeholders:** nenhum. Os blocos de código dos testes e módulos puros foram executados antes de entrar no plano (40 testes passando e o mapeamento rodou sem erro nos 2.099 relatórios reais).

**Consistência de tipos/nomes:** `COLUNAS_OBRA`/`COLUNAS_RELATORIO` (Task 1) são a fonte única usada em `diario-db.js`; contrato do `repo` (Task 3) == `repoDiario` (Task 5); `montarIndicadores` (Task 4) consome exatamente as colunas do SQL da Task 5 e devolve o formato de `IndicadoresDiario` (Task 7); rotas da Task 6 devolvem os campos que `diario-api.ts` lê (`records`, `summary`, `obras`, detalhe achatado).

**Riscos assumidos e onde são verificados:** SQL nunca foi rodado contra Postgres antes da Task 5 (por isso o teste de integração vem antes da tela); a tela só é verificada por build + navegador (o projeto não tem testes de React).
