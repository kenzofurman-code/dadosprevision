import assert from 'node:assert/strict'
import test from 'node:test'
import { lerConciliacaoFinanceira } from './pagamentos-ap.js'

const CABECALHO = ['Série AP', null, 'Número AP', 'Parcela', 'Tipo documento', 'Número documento', 'Código agente',
  'Descrição agente', 'Data emissão', 'Data entrada', 'Data vencimento', 'Valor total AP', 'Valor rateado [A]',
  'Deduções [B]', 'Acréscimos [C]', 'Pagamentos [D]', 'Saldo a pagar [E] = A-B+C-D', 'Total [F] = D + E ',
  'Doc. Origem', 'AP vencida', 'AP Referência', 'Código filial', 'Filial', 'Código orçamento', 'Descrição orçamento',
  'Código estruturado']
const linha = (ap, parcela, venc, rateado, pago, saldo, cod) => {
  const l = Array(CABECALHO.length).fill(null)
  Object.assign(l, { 1: 'AP', 2: ap, 3: parcela, 4: 'NF MAT', 10: venc, 12: rateado, 15: pago, 16: saldo, 25: cod })
  return l
}

test('lê o cabeçalho do Mega e ignora linhas de nível', () => {
  const { linhas, erros } = lerConciliacaoFinanceira([
    CABECALHO,
    ['-', 'Nivel1 : 01 QOYA'],
    linha(107, '001', '2025-01-15', 768.4, 768.4, 0, '01.01.02.08.001 - REPAROS E PROTECOES EM VIZINHOS'),
    linha(107, '002', '2025-02-15', 100, 0, 100, '01.01.02.08.001 - REPAROS E PROTECOES EM VIZINHOS'),
    [null, 'Nivel1 : 16 CUSTOS I'],
  ])
  assert.deepEqual(erros, [])
  assert.equal(linhas.length, 2)
  assert.deepEqual(linhas[1], {
    ap: 107, parcela: '002', tipo_documento: 'NF MAT', vencimento: '2025-02-15',
    valor_rateado: 100, pago: 0, saldo: 100, cod_estruturado: '01.01.02.08.001',
  })
})

test('data serial do Excel e dd/mm/aaaa viram ISO', () => {
  const { linhas } = lerConciliacaoFinanceira([
    CABECALHO,
    linha(1, '001', 45672, 10, 10, 0, '01.01.01.01.001'),
    linha(2, '001', '15/01/2025', 10, 10, 0, '01.01.01.01.001'),
  ])
  assert.equal(linhas[0].vencimento, '2025-01-15')
  assert.equal(linhas[1].vencimento, '2025-01-15')
})

test('sem cabeçalho → erro', () => {
  const { linhas, erros } = lerConciliacaoFinanceira([['qualquer', 'coisa'], [1, 2]])
  assert.equal(linhas.length, 0)
  assert.deepEqual(erros, ['Cabeçalho "Número AP" não encontrado.'])
})
