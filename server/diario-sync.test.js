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

test('lista no limite de 10000 não marca remoções e vira erro', async () => {
  const lista = Array.from({ length: 10000 }, (_, i) => item(`r${i}`))
  const client = clienteFalso({ '/obras': [obraItem('O1')], '/obras/O1': {}, [LISTA('O1')]: lista })
  const repo = repoFalso(Object.fromEntries(lista.map((r) => [r._id, 'm1'])))
  const r = await sincronizarDiario({ client, repo })
  assert.deepEqual(repo.reg.marcadosObras, [])
  assert.equal(r.status, 'parcial')
  assert.match(r.erros[0].erro, /limite/)
})
