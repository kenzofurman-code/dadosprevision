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

test('a requisição leva um AbortSignal de timeout', async () => {
  const amb = ambiente([resposta(200, {})])
  const cliente = criarCliente({ token: 'tk', ...amb.opcoes })
  await cliente.get('/obras')
  assert.ok(amb.chamadas[0].init.signal instanceof AbortSignal)
})

test('timeout vira mensagem própria sem vazar o token', async () => {
  const erro = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const cliente = criarCliente({ token: 'segredo-123', fetchImpl: async () => { throw erro } })
  await assert.rejects(() => cliente.get('/obras'), (err) => {
    assert.match(err.message, /não respondeu em \/obras/)
    assert.doesNotMatch(err.message, /segredo/)
    return true
  })
})
