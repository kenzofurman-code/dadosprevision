import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import pool, { initDb, query } from './db.js'
import {
  repoDiario, consultarDiario, obrasDiario, resumoDiario, obterRelatorioDiario, indicadoresDiario,
} from './diario-db.js'
import { mapearObra, mapearRelatorio } from './diario-map.js'

// Só roda contra um banco descartável: nunca apaga dados de um banco real.
// db.js dá prioridade a DATABASE_URL, então ela nunca é permitida aqui; o host precisa ser local.
const hostLocal = !process.env.PGHOST || ['localhost', '127.0.0.1'].includes(process.env.PGHOST)
const pular = process.env.DIARIO_TEST_DB !== '1' || !String(process.env.PGDATABASE || '').includes('teste')
  || Boolean(process.env.DATABASE_URL) || !hostLocal
const opcoes = { skip: pular && 'defina DIARIO_TEST_DB=1, PGDATABASE com "teste", PGHOST local e sem DATABASE_URL' }

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
