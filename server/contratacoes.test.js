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
