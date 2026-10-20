import assert from 'node:assert/strict'
import test from 'node:test'
import { criarFatorPosterior, montarLinhas, parseSerieBcb, rankingNivel5 } from './painel-teorico.js'

const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`)
const paraMega = (c) => c // nos testes o código Prevision já é o código Mega

test('parseSerieBcb: datas dd/mm/aaaa e valores em texto; ignora inválidos', () => {
  assert.deepEqual(
    parseSerieBcb([{ data: '01/07/2026', valor: '0.61' }, { data: 'x', valor: '1' }, { data: '01/08/2026', valor: '' }]),
    [{ mes: '2026-07', variacao: 0.61 }],
  )
  assert.deepEqual(parseSerieBcb(null), [])
})

test('fator INCC: só os meses posteriores ao informado, até o último publicado', () => {
  const { fatorPosterior, ultimoMes } = criarFatorPosterior([
    { mes: '2026-08', variacao: 0.66 },
    { mes: '2026-07', variacao: 0.61 },
  ])
  assert.equal(ultimoMes, '2026-08')
  perto(fatorPosterior('2026-06'), 1.0061 * 1.0066, 1e-12)
  perto(fatorPosterior('2026-07'), 1.0066, 1e-12)
  assert.equal(fatorPosterior('2026-08'), 1)
  assert.equal(fatorPosterior(null), 1)
  assert.equal(criarFatorPosterior([]).ultimoMes, null)
})

const itensPoty = [
  { codigo: '01', descricao: 'POTY', nivel: 1, custo_total: null, peso_realizado: null },
  { codigo: '01.01.01.01.01', descricao: 'Etapa', nivel: 5, custo_total: 85128864.93, peso_realizado: 0.5468 },
]
const porEtapaPoty = new Map([['01.01.01.01.01', {
  apropriado_nominal: 49654793.17, apropriado_reajustado: 49654793.17, saldo_contratos: 16582064.78, saldo_pedidos: 1778522.61,
}]])

test('fórmulas reproduzem a linha GERAL da planilha (POTY)', () => {
  const linhas = montarLinhas({
    itens: itensPoty, porEtapa: porEtapaPoty, projetado: new Map([['01.01.01.01.01', 83976455.27]]), fatorBase: 1, paraMega,
  })
  const geral = linhas.find((l) => l.codigo === '01')
  perto(geral.evolucao_financeira, 0.5833, 0.0001)
  perto(geral.resultado_teorico, -3106330, 1)
  perto(geral.regua_b, -0.05, 0.0001)
  perto(geral.regua_a, 0.5833 - 0.5468, 0.0001)
  perto(geral.comprometido, 49654793.17 + 16582064.78 + 1778522.61, 0.01)
  perto(geral.resultado, 85128864.93 - 83976455.27, 0.01)
})

test('níveis superiores: somas dos filhos e medição física ponderada pelo orçamento reajustado', () => {
  const linhas = montarLinhas({
    itens: [
      { codigo: '01', descricao: 'Obra', nivel: 1 },
      { codigo: '01.01.01.01.01', descricao: 'A', nivel: 5, custo_total: 300, peso_realizado: 1 },
      { codigo: '01.01.01.01.02', descricao: 'B', nivel: 5, custo_total: 100, peso_realizado: 0 },
    ],
    porEtapa: new Map([['01.01.01.01.01', { apropriado_reajustado: 200 }]]),
    projetado: null,
    fatorBase: 1.1,
    paraMega,
  })
  const obra = linhas[0]
  assert.equal(obra.codigo, '01')
  perto(obra.orcamento_reajustado, 440, 1e-9)
  perto(obra.medicao_fisica, 0.75, 1e-9)
  perto(obra.apropriado_reajustado, 200, 1e-9)
  perto(obra.evolucao_financeira, 200 / 440, 1e-9)
  assert.equal(obra.custo_projetado, null)
  assert.equal(obra.regua_b, null)
})

test('orçamento zero e obra sem mês-base geram razões nulas', () => {
  const zero = montarLinhas({
    itens: [{ codigo: '01.01.01.01.01', nivel: 5, custo_total: 0, peso_realizado: 0.5 }],
    porEtapa: new Map(), projetado: null, fatorBase: 1, paraMega,
  })[0]
  assert.equal(zero.evolucao_financeira, null)
  assert.equal(zero.regua_a, null)
  const semBase = montarLinhas({
    itens: [{ codigo: '01.01.01.01.01', nivel: 5, custo_total: 100, peso_realizado: 0.5 }],
    porEtapa: new Map(), projetado: null, fatorBase: null, paraMega,
  })[0]
  assert.equal(semBase.orcamento_reajustado, null)
  assert.equal(semBase.regua_a, null)
  assert.deepEqual(rankingNivel5([zero, semBase], 'A'), [])
})

test('ranking nível 5 pelo valor absoluto, nos dois sentidos', () => {
  const linhas = montarLinhas({
    itens: [
      { codigo: '01', nivel: 1 },
      { codigo: '01.01.01.01.01', nivel: 5, custo_total: 100, peso_realizado: 0.5 }, // A = 0.1 - 0.5 = -0.4
      { codigo: '01.01.01.01.02', nivel: 5, custo_total: 100, peso_realizado: 0.5 }, // A = 0.6 - 0.5 = 0.1
      { codigo: '01.01.01.01.03', nivel: 5, custo_total: 100, peso_realizado: 0.2 }, // A = 0.9 - 0.2 = 0.7
    ],
    porEtapa: new Map([
      ['01.01.01.01.01', { apropriado_reajustado: 10 }],
      ['01.01.01.01.02', { apropriado_reajustado: 60 }],
      ['01.01.01.01.03', { apropriado_reajustado: 90 }],
    ]),
    projetado: null,
    fatorBase: 1,
    paraMega,
  })
  assert.deepEqual(rankingNivel5(linhas, 'A'), ['01.01.01.01.03', '01.01.01.01.01', '01.01.01.01.02'])
  assert.deepEqual(rankingNivel5(linhas, 'B'), []) // sem custo projetado, régua B é nula
})
