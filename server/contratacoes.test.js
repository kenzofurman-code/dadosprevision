import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizarNome, nivelDoCodigo, etapaParaMega, resolverEtapasPadrao,
  expandirParaNivel5, sugestoesPorNome, lerCustoProjetado, calcularMacro, subtrairDias, hojeNoBrasil,
  avaliarPasso, calcularTrilha, REGRAS_PADRAO,
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

// O orçamento da Prevision só traz nível 5: o nível 4 do padrão expande pelos
// filhos, e como não dá para comparar o nome do ramo, entra para confirmar.
test('resolverEtapasPadrao: nível 4 ausente no orçamento expande pelos filhos como SUGERIDO', () => {
  const soNivel5 = new Map([...orcamento].filter(([c]) => c.split('.').length === 5))
  const { vinculos } = resolverEtapasPadrao([
    { ordem: 1, etapas: [{ codigo: '01.03.02.02', nivel: 4, nome: 'ARMAÇÃO' }] },
  ], soNivel5)
  assert.deepEqual(vinculos.map((v) => [v.codigo_etapa, v.situacao, v.origem_nivel4]), [
    ['01.03.02.02.006', 'SUGERIDO', '01.03.02.02'],
    ['01.03.02.02.009', 'SUGERIDO', '01.03.02.02'],
  ])
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

test('lerCustoProjetado: ponto como milhar em texto pt-BR (CSV) não vira decimal', () => {
  const r = lerCustoProjetado([
    ['ETAPA', 'CUSTO PROJETADO'],
    ['01.01.01.01.001', '1.234'],
    ['01.01.01.01.002', 'R$ 12.345.678,90'],
    ['01.01.01.01.003', '1.5'],
  ])
  assert.deepEqual(r.itens.map((i) => i.custo_projetado), [1234, 12345678.9, 1.5])
  assert.deepEqual(r.erros, [])
})

test('lerCustoProjetado: sem as colunas necessárias devolve erro claro', () => {
  const r = lerCustoProjetado([['A', 'B'], [1, 2]])
  assert.deepEqual(r.erros, [{ linha: 0, motivo: 'colunas "CÓDIGO" (ou "ETAPA") e "CUSTO PROJETADO" não encontradas' }])
  assert.deepEqual(r.itens, [])
})

test('subtrairDias trabalha só com a data', () => {
  assert.equal(subtrairDias('2026-10-10', 45), '2026-08-26')
  assert.equal(subtrairDias('2026-10-10', 0), '2026-10-10')
})

const base = (etapas, lead = 30) => ({ id: 1, tipo: 'MATERIAL', item: 'G', insumos: null, lead_time: lead, etapas })
const macro = (grupo, { proj = {}, val = {}, ini = {}, hoje = '2026-09-29' } = {}) =>
  calcularMacro({ grupos: [grupo], projetado: new Map(Object.entries(proj)),
    valores: new Map(Object.entries(val)), inicio: new Map(Object.entries(ini)), hoje }).grupos[0]
const v = (solicitado, pedido = 0, contratado = 0, realizado = 0) => ({ solicitado, pedido, contratado, realizado })

test('macro: sem projeção não divide por zero', () => {
  const g = macro(base([]))
  assert.equal(g.sinal, 'SEM_PROJECAO')
  assert.equal(g.pct.solicitado, null)
})

test('macro: percentuais e lançado pela fase mais avançada', () => {
  const g = macro(base(['a', 'b']), { proj: { a: 600, b: 400 }, val: { a: v(300, 300, 0, 100), b: v(0, 0, 0, 200) }, ini: { a: '2027-01-10' } })
  assert.deepEqual([g.projetado, g.solicitado, g.pedido, g.realizado, g.lancado, g.falta], [1000, 300, 300, 300, 500, 500])
  assert.equal(g.pct.lancado, 0.5)
  assert.equal(g.sinal, 'NO_PRAZO')
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

test('macro: tudo solicitado não fica atrasado mesmo após o limite', () => {
  const g = macro(base(['a'], 30), { proj: { a: 100 }, val: { a: v(100, 100) }, ini: { a: '2026-10-01' } })
  assert.equal(g.sinal, 'NO_PRAZO')
})

test('macro: pendência entre 95% e 100% e acima de 100%', () => {
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(96) }, ini: { a: '2027-01-01' } }).sinal, 'PENDENCIA')
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(130) }, ini: { a: '2027-01-01' } }).sinal, 'PENDENCIA')
})

test('macro: concluído com 100% realizado; sem data sem cronograma', () => {
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(100, 100, 0, 100) } }).sinal, 'CONCLUIDO')
  assert.equal(macro(base(['a']), { proj: { a: 100 }, val: { a: v(10) } }).sinal, 'SEM_DATA')
})

test('macro: resumo soma a obra e conta sinais', () => {
  const r = calcularMacro({
    grupos: [base(['a']), { ...base(['b']), id: 2 }],
    projetado: new Map([['a', 100], ['b', 50]]), valores: new Map([['a', v(20)]]),
    inicio: new Map(), hoje: '2026-09-29',
  })
  assert.deepEqual([r.resumo.projetado, r.resumo.lancado, r.resumo.falta], [150, 20, 130])
  assert.equal(r.resumo.porSinal.SEM_DATA, 2)
})

test('hojeNoBrasil usa o fuso de São Paulo, não UTC', () => {
  assert.equal(hojeNoBrasil(new Date('2026-09-30T01:30:00Z')), '2026-09-29')
  assert.equal(hojeNoBrasil(new Date('2026-09-30T12:00:00Z')), '2026-09-30')
})

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
  const semEventos = avaliarPasso({ passo: 'MAPA', numero: 5, doc: { valor: 1, data_envio: '2026-09-01' }, eventos: [], exigidas: 1 })
  assert.equal(semEventos.status, 'PENDENTE')
  assert.equal(semEventos.ultimo, '2026-09-01')
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
