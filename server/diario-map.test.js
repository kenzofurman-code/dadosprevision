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
