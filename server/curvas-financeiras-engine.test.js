import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calcularCurvasFinanceiras,
  dataPagamentoMo,
  diferencaDias,
  distribuirMaoDeObraEtapa,
  distribuirMaterialEtapa,
  mesCompetenciaMo,
  projetarRealizado,
  aplicarVinculos,
  resolverRegra,
  separarForaDoCronograma,
  somarDiasIso,
} from './curvas-financeiras-engine.js'

test('datas: somarDiasIso e diferencaDias', () => {
  assert.equal(somarDiasIso('2026-03-15', 10), '2026-03-25')
  assert.equal(somarDiasIso('2026-03-15', -10), '2026-03-05')
  assert.equal(somarDiasIso('2026-02-28', 1), '2026-03-01')
  assert.equal(diferencaDias('2026-03-01', '2026-03-31'), 30)
})

test('regra do dia 20: mesCompetenciaMo', () => {
  // Dia 20 ou antes: cai no próprio mês
  assert.equal(mesCompetenciaMo('2026-03-01', 20), '2026-03')
  assert.equal(mesCompetenciaMo('2026-03-15', 20), '2026-03')
  assert.equal(mesCompetenciaMo('2026-03-20', 20), '2026-03')

  // Dia 21 em diante: cai no mês seguinte
  assert.equal(mesCompetenciaMo('2026-03-21', 20), '2026-04')
  assert.equal(mesCompetenciaMo('2026-03-31', 20), '2026-04')
  assert.equal(mesCompetenciaMo('2026-12-25', 20), '2027-01')
})

test('mão de obra: medição 21 a 20 e desembolso no dia 5 de M+1', () => {
  // Atividade de 10 dias: 15/03 a 24/03 (R$ 10.000, R$ 1.000/dia)
  // Dias 15, 16, 17, 18, 19, 20 (6 dias <= 20) -> Competência 2026-03 (R$ 6.000)
  // Dias 21, 22, 23, 24 (4 dias > 20) -> Competência 2026-04 (R$ 4.000)
  const eventos = distribuirMaoDeObraEtapa({
    custo: 10000,
    dataInicio: '2026-03-15',
    dataFim: '2026-03-24',
    diaCorteMo: 20,
  })

  assert.equal(eventos.length, 2)
  const ev03 = eventos.find((e) => e.mesCompetencia === '2026-03')
  const ev04 = eventos.find((e) => e.mesCompetencia === '2026-04')

  assert.ok(ev03)
  assert.ok(ev04)
  assert.equal(ev03.valor, 6000)
  assert.equal(ev03.mesFinanceiro, '2026-04') // Desembolso no mês seguinte (05 de abril)

  assert.equal(ev04.valor, 4000)
  assert.equal(ev04.mesFinanceiro, '2026-05') // Desembolso no mês seguinte (05 de maio)
})

test('material: antecedência de entrega e lotes fixos uniformes', () => {
  // Tarefa de 100 dias: 01/05 a 09/08, Custo R$ 50.000
  // Antecedência: 10 dias -> 1ª entrega em 21/04
  // 5 entregas de R$ 10.000 cada, prazo 28 dias
  const eventos = distribuirMaterialEtapa({
    custo: 50000,
    dataInicio: '2026-05-01',
    dataFim: '2026-08-09',
    diasAntecedencia: 10,
    numEntregas: 5,
    tipoPagamento: 'DIAS',
    prazoDias: 28,
  })

  assert.equal(eventos.length, 5)
  assert.equal(eventos[0].dataEntrega, '2026-04-21') // 10 dias antes de 01/05
  assert.equal(eventos[0].mesCompetencia, '2026-04')
  assert.equal(eventos[0].mesFinanceiro, '2026-05') // 21/04 + 28d = 19/05 (maio)
  // regra de lotes (2026-10-21): períodos de dias inteiros — 101 dias / 5 = a 1ª entrega abastece 20 dias
  assert.equal(eventos[0].valor, Math.round((50000 * 20 / 101) * 100) / 100)

  // Total deve bater exatamente R$ 50.000
  const soma = eventos.reduce((s, e) => s + e.valor, 0)
  assert.equal(Math.round(soma), 50000)
})

test('material: pagamento parcelado em 3x (30/60/90)', () => {
  // Custo R$ 30.000, entrega única em 10/06, parcelado 30, 60, 90
  const eventos = distribuirMaterialEtapa({
    custo: 30000,
    dataInicio: '2026-06-20',
    dataFim: '2026-06-20',
    diasAntecedencia: 10,
    numEntregas: 1,
    tipoPagamento: 'PARCELADO',
    parcelasDias: [30, 60, 90],
  })

  assert.equal(eventos.length, 3)
  assert.equal(eventos[0].valor, 10000)
  assert.equal(eventos[1].valor, 10000)
  assert.equal(eventos[2].valor, 10000)

  // Entrega em 10/06 (Competência 2026-06)
  assert.equal(eventos[0].mesCompetencia, '2026-06')
  assert.equal(eventos[1].mesCompetencia, '2026-06')
  assert.equal(eventos[2].mesCompetencia, '2026-06')

  // Vencimentos: 10/07 (Jul), 09/08 (Ago), 08/09 (Set)
  assert.equal(eventos[0].mesFinanceiro, '2026-07')
  assert.equal(eventos[1].mesFinanceiro, '2026-08')
  assert.equal(eventos[2].mesFinanceiro, '2026-09')
})

test('fechamento matemático completo do motor de curvas', () => {
  const etapas = [
    {
      codigo_etapa: '01.01.01.01.001',
      nome: 'Estrutura Concreto',
      custo_material: 60000,
      custo_mao_obra: 40000,
      data_inicio: '2026-06-01',
      data_fim: '2026-07-31',
      pontos_mensais: [
        { data: '2026-06-30', previsto: 0.5 },
        { data: '2026-07-31', previsto: 0.5 },
      ],
    },
  ]

  const paramsEtapas = new Map([
    [
      '01.01.01.01.001|MATERIAL',
      {
        dias_antecedencia: 15,
        num_entregas: 2,
        prazo_dias: 28,
      },
    ],
  ])

  const resultado = calcularCurvasFinanceiras({
    etapas,
    parametrosObra: { dia_corte_medicao_mo: 20, dias_antecedencia_padrao: 10, prazo_pagamento_padrao_dias: 28 },
    parametrosEtapas: paramsEtapas,
    realizadoHistorico: 10000,
  })

  assert.equal(resultado.kpis.totalOrcado, 100000)
  assert.equal(resultado.kpis.totalMaterial, 60000)
  assert.equal(resultado.kpis.totalMaoDeObra, 40000)
  assert.equal(resultado.kpis.saldoProjetado, 90000)

  // As séries mensais devem somar exatamente os 100.000 de competência e financeiro
  const ult = resultado.seriesMensal[resultado.seriesMensal.length - 1]
  assert.equal(Math.round(ult.competenciaAcumulado), 100000)
  assert.equal(Math.round(ult.financeiroAcumulado), 100000)
})

const somaValores = (evs) => evs.reduce((s, e) => s + e.valor, 0)
const somaPor = (evs, campo, mes) => somaValores(evs.filter((e) => e[campo] === mes))
const perto = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`)

test('mão de obra: dia de pagamento configurável em M+1', () => {
  const eventos = distribuirMaoDeObraEtapa({
    custo: 10000, dataInicio: '2026-03-01', dataFim: '2026-03-10', diaCorteMo: 20, diaPagamentoMo: 10,
  })
  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].mesCompetencia, '2026-03')
  assert.equal(eventos[0].dataPagamento, '2026-04-10')
  assert.equal(eventos[0].mesFinanceiro, '2026-04')
})

test('mão de obra: dia de pagamento limitado ao último dia do mês', () => {
  assert.equal(dataPagamentoMo('2026-01', 31), '2026-02-28')
  assert.equal(dataPagamentoMo('2026-12', 5), '2027-01-05')
})

test('mão de obra: retenção técnica retém só o financeiro e libera na data informada', () => {
  const eventos = distribuirMaoDeObraEtapa({
    custo: 10000, dataInicio: '2026-03-15', dataFim: '2026-03-24', diaCorteMo: 20, diaPagamentoMo: 5,
    retencaoPercentual: 5, dataLiberacaoRetencao: '2028-06-30',
  })
  perto(somaValores(eventos), 10000)
  perto(somaPor(eventos, 'mesCompetencia', '2026-03'), 6000)
  perto(somaPor(eventos, 'mesCompetencia', '2026-04'), 4000)
  const retidos = eventos.filter((e) => e.retencao)
  perto(somaValores(retidos), 500)
  assert.ok(retidos.every((e) => e.mesFinanceiro === '2028-06' && e.dataPagamento === '2028-06-30'))
  perto(somaPor(eventos, 'mesFinanceiro', '2026-04'), 5700)
  perto(somaPor(eventos, 'mesFinanceiro', '2026-05'), 3800)
})

test('mão de obra: retenção 0 não gera eventos de retenção', () => {
  const eventos = distribuirMaoDeObraEtapa({
    custo: 1000, dataInicio: '2026-03-01', dataFim: '2026-03-05', retencaoPercentual: 0, dataLiberacaoRetencao: '2028-01-01',
  })
  assert.equal(eventos.filter((e) => e.retencao).length, 0)
})

test('material proporcional: antecedência desloca só os dias próximos à virada do mês', () => {
  const eventos = distribuirMaterialEtapa({
    custo: 30000, dataInicio: '2026-04-01', dataFim: '2026-04-30', diasAntecedencia: 10, prazoDias: 28,
    pontosMensais: [{ data: '2026-04-30', previsto: 1 }],
  })
  perto(somaPor(eventos, 'mesCompetencia', '2026-03'), 10000)
  perto(somaPor(eventos, 'mesCompetencia', '2026-04'), 20000)
  perto(somaValores(eventos), 30000)
})

test('material sem pontos mensais: rateio uniforme entre início e fim', () => {
  const eventos = distribuirMaterialEtapa({
    custo: 61000, dataInicio: '2026-04-01', dataFim: '2026-05-31', diasAntecedencia: 0, prazoDias: 28,
  })
  perto(somaPor(eventos, 'mesCompetencia', '2026-04'), 30000)
  perto(somaPor(eventos, 'mesCompetencia', '2026-05'), 31000)
})

test('material: ponto mensal fora do intervalo da etapa não perde valor', () => {
  const eventos = distribuirMaterialEtapa({
    custo: 1000, dataInicio: '2026-04-10', dataFim: '2026-04-20', diasAntecedencia: 0, prazoDias: 28,
    pontosMensais: [{ data: '2026-04-30', previsto: 0.5 }, { data: '2026-05-31', previsto: 0.5 }],
  })
  perto(somaValores(eventos), 1000)
  perto(somaPor(eventos, 'mesCompetencia', '2026-05'), 500)
})

test('material: parcelado em 12x de 28 em 28 dias', () => {
  const parcelas = Array.from({ length: 12 }, (_, i) => 28 * (i + 1))
  const eventos = distribuirMaterialEtapa({
    custo: 12000, dataInicio: '2026-06-20', dataFim: '2026-06-20', diasAntecedencia: 0, numEntregas: 1,
    tipoPagamento: 'PARCELADO', parcelasDias: parcelas,
  })
  assert.equal(eventos.length, 12)
  assert.ok(eventos.every((e) => e.valor === 1000))
  assert.equal(eventos[11].dataVencimento, somarDiasIso('2026-06-20', 336))
})

test('material parcelado com % de cada parcela (histórico de pagamento)', () => {
  const eventos = distribuirMaterialEtapa({
    custo: 10000, dataInicio: '2026-06-01', dataFim: '2026-06-01', diasAntecedencia: 0, numEntregas: 1,
    tipoPagamento: 'PARCELADO', parcelasDias: [20, 46, 76], parcelasPct: [50, 30, 20],
  })
  assert.deepEqual(eventos.map((e) => e.valor), [5000, 3000, 2000])
  assert.deepEqual(eventos.map((e) => e.dataVencimento), ['2026-06-21', '2026-07-17', '2026-08-16'])
})

test('% das parcelas é normalizado para 100%; sem % ou com tamanho diferente, parcelas iguais', () => {
  const base = { custo: 900, dataInicio: '2026-06-01', dataFim: '2026-06-01', diasAntecedencia: 0, numEntregas: 1, tipoPagamento: 'PARCELADO', parcelasDias: [10, 40, 70] }
  assert.deepEqual(distribuirMaterialEtapa({ ...base, parcelasPct: [2, 1, 0] }).map((e) => e.valor), [600, 300, 0])
  assert.deepEqual(distribuirMaterialEtapa({ ...base, parcelasPct: [50, 50] }).map((e) => e.valor), [300, 300, 300])
  assert.deepEqual(distribuirMaterialEtapa({ ...base, parcelasPct: null }).map((e) => e.valor), [300, 300, 300])
})

test('regra com parcelas_pct chega ao motor das curvas', () => {
  const r = calcularCurvasFinanceiras({
    etapas: [{ codigo_etapa: 'A', data_inicio: '2026-06-01', data_fim: '2026-06-01', custo_material: 1000, custo_mao_obra: 0 }],
    parametrosObra: { dias_antecedencia_padrao: 0 },
    parametrosEtapas: new Map([['A|MATERIAL', { codigo_etapa: 'A', num_entregas: 1, tipo_pagamento: 'PARCELADO', parcelas_dias: [10, 45], parcelas_pct: [80, 20] }]]),
  })
  const fin = Object.fromEntries(r.seriesMensal.map((s) => [s.mes, s.financeiroMaterial]))
  assert.equal(fin['2026-06'], 800)
  assert.equal(fin['2026-07'], 200)
})

test('regras: nível 5 vence nível 4, que vence nível 3; MO e Material não colidem', () => {
  const etapa = { codigoMega: '01.02.03.04.005', codigoPrevision: '01.02.03.04.05' }
  const mapa = new Map([
    ['01.02.03|MATERIAL', { codigo_etapa: '01.02.03', dias_antecedencia: 3 }],
    ['01.02.03.04.005|MAO_DE_OBRA', { codigo_etapa: '01.02.03.04.005', retencao_ativa: true }],
  ])
  assert.equal(resolverRegra(mapa, etapa, 'MATERIAL').codigo_etapa, '01.02.03')
  mapa.set('01.02.03.04|MATERIAL', { codigo_etapa: '01.02.03.04', dias_antecedencia: 4 })
  assert.equal(resolverRegra(mapa, etapa, 'MATERIAL').codigo_etapa, '01.02.03.04')
  mapa.set('01.02.03.04.005|MATERIAL', { codigo_etapa: '01.02.03.04.005', dias_antecedencia: 5 })
  assert.equal(resolverRegra(mapa, etapa, 'MATERIAL').dias_antecedencia, 5)
  assert.equal(resolverRegra(mapa, etapa, 'MAO_DE_OBRA').retencao_ativa, true)
  assert.equal(resolverRegra(mapa, { codigoMega: '09.09.09.09.009', codigoPrevision: '09.09.09.09.09' }, 'MATERIAL'), null)
})

test('motor: regra herdada de nível 3, retenção da obra e data de liberação', () => {
  const etapas = [{
    codigo_etapa: '01.02.03.04.005', codigo_prevision: '01.02.03.04.05', nome: 'X',
    custo_material: 1000, custo_mao_obra: 1000, data_inicio: '2026-03-01', data_fim: '2026-03-10', pontos_mensais: [],
  }]
  const mapa = new Map([['01.02.03|MATERIAL', { codigo_etapa: '01.02.03', num_entregas: 1, dias_antecedencia: 0, prazo_dias: 28 }]])
  const r = calcularCurvasFinanceiras({
    etapas,
    parametrosObra: { retencao_mo_ativa: true, retencao_mo_percentual: 10, data_fim_obra: '2027-01-31', dia_pagamento_mo: 5 },
    parametrosEtapas: mapa,
  })
  assert.deepEqual(r.etapas[0].regraMaterial, { codigo_origem: '01.02.03', nivel: 3 })
  assert.equal(r.etapas[0].regraMo, null)
  assert.equal(r.kpis.dataLiberacaoRetencao, '2028-01-31')
  const fin2028 = r.seriesMensal.find((s) => s.mes === '2028-01')
  perto(fin2028.financeiroMaoDeObra, 100)
  perto(r.seriesMensal.at(-1).competenciaAcumulado, 2000)
  perto(r.seriesMensal.at(-1).financeiroAcumulado, 2000)
})

test('motor: retenção da etapa (regra MO) sobrepõe a da obra', () => {
  const etapas = [{
    codigo_etapa: '01.02.03.04.005', codigo_prevision: '01.02.03.04.05',
    custo_mao_obra: 1000, data_inicio: '2026-03-01', data_fim: '2026-03-10',
  }]
  const mapa = new Map([['01.02.03.04|MAO_DE_OBRA', { codigo_etapa: '01.02.03.04', retencao_ativa: false }]])
  const r = calcularCurvasFinanceiras({
    etapas, parametrosObra: { retencao_mo_ativa: true, retencao_mo_percentual: 10, data_fim_obra: '2027-01-31' }, parametrosEtapas: mapa,
  })
  assert.deepEqual(r.etapas[0].regraMo, { codigo_origem: '01.02.03.04', nivel: 4 })
  assert.equal(r.etapas[0].eventos.filter((e) => e.retencao).length, 0)
})

test('motor: sem data de fim da obra, libera retenção 1 ano após a maior data de fim das etapas', () => {
  const etapas = [
    { codigo_etapa: 'A', custo_mao_obra: 100, data_inicio: '2026-03-01', data_fim: '2026-03-10' },
    { codigo_etapa: 'B', custo_mao_obra: 100, data_inicio: '2026-05-01', data_fim: '2026-09-15' },
  ]
  const r = calcularCurvasFinanceiras({ etapas, parametrosObra: { retencao_mo_ativa: true, retencao_mo_percentual: 5 } })
  assert.equal(r.kpis.dataLiberacaoRetencao, '2027-09-15')
})

test('motor: cada etapa traz a matriz mensal [comp. material, comp. MO, fin. material, fin. MO]', () => {
  const r = calcularCurvasFinanceiras({
    etapas: [{
      codigo_etapa: 'A', custo_material: 1000, custo_mao_obra: 600,
      data_inicio: '2026-03-01', data_fim: '2026-03-10', pontos_mensais: [],
    }],
    parametrosObra: { dias_antecedencia_padrao: 0, prazo_pagamento_padrao_dias: 31, dia_pagamento_mo: 5 },
  })
  const m = r.etapas[0].mensal
  assert.deepEqual(m['2026-03'], [1000, 600, 0, 0])
  assert.deepEqual(m['2026-04'], [0, 0, 1000, 600])
  // a soma das matrizes de todas as etapas fecha com as séries consolidadas
  for (const s of r.seriesMensal) {
    const v = m[s.mes] || [0, 0, 0, 0]
    assert.equal(v[0], s.competenciaMaterial)
    assert.equal(v[3], s.financeiroMaoDeObra)
  }
})

test('motor: antecedência 0 e prazo 0 (à vista) da obra são respeitados', () => {
  const r = calcularCurvasFinanceiras({
    etapas: [{ codigo_etapa: 'A', custo_material: 100, data_inicio: '2026-03-01', data_fim: '2026-03-01' }],
    parametrosObra: { dias_antecedencia_padrao: 0, prazo_pagamento_padrao_dias: 0 },
  })
  const ev = r.etapas[0].eventos[0]
  assert.equal(ev.dataEntrega, '2026-03-01')
  assert.equal(ev.dataVencimento, '2026-03-01')
})

test('custo projetado: separa o que não tem etapa nível 5 no cronograma, do maior para o menor', () => {
  const custos = new Map([
    ['01.01.01.01.001', { material: 100, mao_de_obra: 50, total: 150, descricao: 'CIMENTO' }],
    ['24.01.01.01.001', { material: 6000, mao_de_obra: 0, total: 6000, descricao: 'TAXA DE ADMINISTRAÇÃO' }],
    ['21.03.01.01.001', { material: 900, mao_de_obra: 100, total: 1000, descricao: 'ITENS FORA DE ORÇAMENTO' }],
  ])
  const r = separarForaDoCronograma(custos, new Set(['01.01.01.01.001']))
  assert.deepEqual([...r.dentro.keys()], ['01.01.01.01.001'])
  assert.equal(r.totalFora, 7000)
  assert.deepEqual(r.fora.map((f) => f.codigo), ['24.01.01.01.001', '21.03.01.01.001'])
  assert.equal(r.fora[0].descricao, 'TAXA DE ADMINISTRAÇÃO')
  assert.equal(r.fora[1].mao_de_obra, 100)
})

test('custo projetado: etapa fora do cronograma com valor zero não é listada', () => {
  const custos = new Map([
    ['24.01.01.01.001', { material: 0, mao_de_obra: 0, total: 0, descricao: 'ZERADO' }],
    ['21.03.01.01.001', { material: 900, mao_de_obra: 100, total: 1000, descricao: 'ITENS FORA DE ORÇAMENTO' }],
  ])
  const r = separarForaDoCronograma(custos, new Set())
  assert.deepEqual(r.fora.map((f) => f.codigo), ['21.03.01.01.001'])
  assert.equal(r.totalFora, 1000)
})

// ---- Rastreio: físico diário como base única, regra de lotes e fluxos ------------------------

const somaPorChave = (itens, chave, campo = 'valor') => {
  const m = new Map()
  for (const i of itens) m.set(chave(i), (m.get(chave(i)) || 0) + i[campo])
  return m
}
const mesesIguais = (a, b, tol = 0.05) => {
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    assert.ok(Math.abs((a.get(k) || 0) - (b.get(k) || 0)) <= tol, `${k}: ${a.get(k)} != ${b.get(k)}`)
  }
}

test('lotes: prazo dividido em N períodos; cada entrega chega X dias antes do seu período', () => {
  const eventos = distribuirMaterialEtapa({
    custo: 100000, dataInicio: '2026-01-01', dataFim: '2026-06-30', diasAntecedencia: 10, numEntregas: 2, prazoDias: 28,
  })
  assert.deepEqual(eventos.map((e) => e.dataEntrega), ['2025-12-22', '2026-03-22'])
  // 181 dias: 1ª entrega abastece jan-mar (90 dias), 2ª abr-jun (91 dias) — ~50/50
  perto(eventos[0].valor, 100000 * 90 / 181, 0.05)
  perto(eventos[1].valor, 100000 * 91 / 181, 0.05)
})

test('lotes: cada entrega leva o material do físico do seu período', () => {
  const pontos = [0.25, 0.25, 0.2, 0.1, 0.1, 0.1].map((p, i) => ({ data: `2026-0${i + 1}-28`, previsto: p }))
  const eventos = distribuirMaterialEtapa({
    custo: 100000, dataInicio: '2026-01-01', dataFim: '2026-06-30', diasAntecedencia: 0, numEntregas: 2, prazoDias: 28,
    pontosMensais: pontos,
  })
  perto(eventos[0].valor, 70000, 0.05)
  perto(eventos[1].valor, 30000, 0.05)
})

test('mão de obra segue o físico mês a mês, com o corte do dia 20 sobre cada dia', () => {
  const eventos = distribuirMaoDeObraEtapa({
    custo: 1000, dataInicio: '2026-03-01', dataFim: '2026-04-30', diaCorteMo: 20,
    pontosMensais: [{ data: '2026-03-31', previsto: 0.7 }, { data: '2026-04-30', previsto: 0.3 }],
  })
  perto(somaPor(eventos, 'mesCompetencia', '2026-03'), 0.7 * 20 / 31 * 1000, 0.02)
  perto(somaPor(eventos, 'mesCompetencia', '2026-04'), (0.7 * 11 / 31 + 0.3 * 20 / 30) * 1000, 0.02)
  perto(somaPor(eventos, 'mesCompetencia', '2026-05'), 0.3 * 10 / 30 * 1000, 0.02)
})

test('físico sem pesos mensais: espalhado entre início e fim', () => {
  const r = calcularCurvasFinanceiras({
    etapas: [{ codigo_etapa: 'A', custo_material: 61000, data_inicio: '2026-04-01', data_fim: '2026-05-31' }],
  })
  const econ = new Map(r.etapas[0].eventosEconomico.map((e) => [e.mes, e.valor]))
  perto(econ.get('2026-04'), 30000, 0.05)
  perto(econ.get('2026-05'), 31000, 0.05)
})

test('fluxos fecham com físico, competência e financeiro (proporcional, lotes parcelados, MO com retenção)', () => {
  const pontos = [{ data: '2026-03-31', previsto: 0.5 }, { data: '2026-04-30', previsto: 0.3 }, { data: '2026-05-31', previsto: 0.2 }]
  const base = { data_inicio: '2026-03-01', data_fim: '2026-05-31', pontos_mensais: pontos }
  const etapas = [
    { ...base, codigo_etapa: 'P', custo_material: 90000, custo_mao_obra: 45000 },
    { ...base, codigo_etapa: 'L', custo_material: 60000, custo_mao_obra: 30000 },
  ]
  const r = calcularCurvasFinanceiras({
    etapas,
    parametrosObra: { dias_antecedencia_padrao: 10, retencao_mo_ativa: true, retencao_mo_percentual: 5, data_fim_obra: '2026-12-31' },
    parametrosEtapas: new Map([['L|MATERIAL', { codigo_etapa: 'L', num_entregas: 3, tipo_pagamento: 'PARCELADO', parcelas_dias: [28, 56] }]]),
  })
  for (const et of r.etapas) {
    assert.ok(et.fluxos.length > 0, `etapa ${et.codigo_etapa} sem fluxos`)
    mesesIguais(somaPorChave(et.fluxos, (f) => `${f.tipo}|${f.comp}`), somaPorChave(et.eventos, (e) => `${e.tipo}|${e.mesCompetencia}`))
    mesesIguais(somaPorChave(et.fluxos, (f) => `${f.tipo}|${f.fin}`), somaPorChave(et.eventos, (e) => `${e.tipo}|${e.mesFinanceiro}`))
    mesesIguais(somaPorChave(et.fluxos, (f) => f.fis), new Map(et.eventosEconomico.map((e) => [e.mes, e.valor])))
  }
  const mo = r.etapas[0].fluxos.filter((f) => f.tipo === 'MAO_DE_OBRA')
  assert.ok(mo.some((f) => f.fis !== f.comp && /corte/.test(f.mComp)), 'MO de fim de mês vai para a competência seguinte')
  assert.ok(mo.some((f) => /reten/.test(f.mFin) && f.fin === '2027-12'), 'retenção liberada 1 ano após o fim da obra')
  const lotes = r.etapas[1].fluxos.filter((f) => f.tipo === 'MATERIAL')
  assert.ok(lotes.every((f) => /entrega \d de 3/.test(f.mComp) && /parcela [12]\/2/.test(f.mFin)))
})

test('lotes: períodos sobre o intervalo onde existe físico, mesmo se as datas da etapa divergirem', () => {
  // datas da etapa em jan-fev, mas o cronograma mensal tem físico só em mai-jun
  const eventos = distribuirMaterialEtapa({
    custo: 1000, dataInicio: '2026-01-01', dataFim: '2026-02-28', diasAntecedencia: 10, numEntregas: 2, prazoDias: 28,
    pontosMensais: [{ data: '2026-05-31', previsto: 0.5 }, { data: '2026-06-30', previsto: 0.5 }],
  })
  // nenhuma entrega pode chegar depois do físico que abastece: 1ª antes de mai, 2ª antes de jun
  assert.deepEqual(eventos.map((e) => e.dataEntrega), ['2026-04-21', '2026-05-21'])
  perto(eventos[0].valor + eventos[1].valor, 1000, 0.02)
})

// ---- Realizado + projeção --------------------------------------------------

const MESES_E1 = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const etapaE1 = (extra = {}) => ({
  codigo_etapa: '01.01.01.01.001', codigo_prevision: '1.1.1.1.1', nome: 'E1',
  data_inicio: '2026-01-01', data_fim: '2026-06-30',
  custo_material: 600, custo_mao_obra: 600, custo_total: 1200,
  pontos_mensais: MESES_E1.map((m) => ({ data: `${m}-28`, previsto: 1 / 6 })),
  ...extra,
})
const OBRA = { dias_antecedencia_padrao: 0, prazo_pagamento_padrao_dias: 0 }
const projetar = (o) => projetarRealizado({
  etapas: [etapaE1()], parametrosObra: OBRA, parametrosEtapas: new Map(), realizado: [], pagamentos: new Map(), ...o,
})
const somaSerie = (r, campo, filtro = () => true) =>
  Math.round(r.seriesMensal.filter(filtro).reduce((s, x) => s + x[campo], 0) * 100) / 100

test('projetarRealizado: corte antes do início e sem realizado → séries iguais às da teórica', () => {
  const r = projetar({ corte: '2025-10' })
  assert.ok(r.seriesMensal.length > 0)
  for (const s of r.seriesMensal) {
    assert.equal(s.realizado, false)
    assert.ok(Math.abs(s.competenciaMensal - (s.teoricoCompetenciaMaterial + s.teoricoCompetenciaMaoDeObra)) < 0.02, s.mes)
    assert.ok(Math.abs(s.financeiroMensal - (s.teoricoFinanceiroMaterial + s.teoricoFinanceiroMaoDeObra)) < 0.02, s.mes)
  }
})

test('projetarRealizado: realizado parcial — saldo só depois do corte', () => {
  const r = projetar({
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-02-10', valor: 200, ap: null }],
  })
  assert.equal(somaSerie(r, 'competenciaMaterial', (s) => s.mes <= '2026-03'), 200)
  assert.ok(Math.abs(somaSerie(r, 'competenciaMaterial', (s) => s.mes > '2026-03') - 400) < 0.05)
  assert.equal(somaSerie(r, 'competenciaMaoDeObra', (s) => s.mes <= '2026-03'), 0)
  assert.equal(somaSerie(r, 'competenciaMaoDeObra'), 600)
  assert.equal(r.seriesMensal.filter((s) => s.realizado).map((s) => s.mes).at(-1), '2026-03')
  const e = r.etapas[0]
  assert.equal(e.realizado, 200)
  assert.equal(e.saldoProjetado, 1000)
  assert.equal(e.alerta, null)
})

test('projetarRealizado: excedente não distribui e marca a etapa', () => {
  const r = projetar({
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MAO_DE_OBRA', data: '2026-03-10', valor: 1300, ap: null }],
  })
  assert.equal(somaSerie(r, 'competenciaMensal', (s) => s.mes > '2026-03'), 0)
  assert.equal(r.etapas[0].excedente, 100)
  assert.equal(r.etapas[0].alerta, 'excedente')
  assert.equal(r.kpis.excedente, 100)
})

test('projetarRealizado: tipo diferente no Mega não gera excedente — o saldo é da etapa', () => {
  const r = projetar({
    etapas: [etapaE1({ custo_mao_obra: 0, custo_total: 600 })],
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MAO_DE_OBRA', data: '2026-03-10', valor: 50, ap: null }],
  })
  assert.equal(r.etapas[0].excedente, 0)
  assert.equal(r.etapas[0].alerta, null)
  assert.equal(r.etapas[0].saldoProjetado, 550)
  assert.ok(Math.abs(somaSerie(r, 'competenciaMaterial', (s) => s.mes > '2026-03') - 550) < 0.05)
})

test('projetarRealizado: saldo da etapa repartido pelo que falta em cada tipo', () => {
  const r = projetar({
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MAO_DE_OBRA', data: '2026-03-10', valor: 900, ap: null }],
  })
  // projetado 1200, realizado 900: saldo 300, todo em material (a MO já passou do seu custo)
  assert.equal(r.etapas[0].excedente, 0)
  assert.equal(r.etapas[0].saldoProjetado, 300)
  assert.equal(somaSerie(r, 'competenciaMaoDeObra', (s) => s.mes > '2026-03'), 0)
  assert.ok(Math.abs(somaSerie(r, 'competenciaMaterial', (s) => s.mes > '2026-03') - 300) < 0.05)
})

test('projetarRealizado: saldo sem físico futuro fica pendente', () => {
  const r = projetar({
    corte: '2026-06',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-05-10', valor: 100, ap: null }],
  })
  assert.equal(r.etapas[0].pendente, 1100)
  assert.equal(r.etapas[0].alerta, 'pendente')
  assert.equal(r.kpis.pendente, 1100)
  assert.equal(somaSerie(r, 'competenciaMensal'), 100)
})

test('projetarRealizado: pontos só até o corte com data_fim depois → pendente', () => {
  const r = projetar({
    etapas: [etapaE1({ data_fim: '2026-12-31', pontos_mensais: ['2026-01', '2026-02', '2026-03'].map((m) => ({ data: `${m}-28`, previsto: 1 / 3 })) })],
    corte: '2026-04',
  })
  assert.equal(r.etapas[0].pendente, 1200)
  assert.equal(somaSerie(r, 'competenciaMensal', (s) => s.mes > '2026-04'), 0)
})

test('projetarRealizado: etapa atrasada (previsto acabou, físico < 100% no corte) apropria o saldo todo no mês seguinte', () => {
  const pontos = (acum) => ['2026-01', '2026-02', '2026-03'].map((m, i) => ({
    data: `${m}-28`, previsto: 1 / 3, realizado_acumulado: acum[i],
  }))
  const atrasada = projetar({
    etapas: [etapaE1({ data_fim: '2026-03-31', pontos_mensais: pontos([0.3, 0.6, 0.9]) })],
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-03-10', valor: 900, ap: null }],
  })
  assert.equal(atrasada.etapas[0].pendente, 0)
  assert.equal(atrasada.etapas[0].alerta, 'atrasada')
  assert.equal(atrasada.etapas[0].mesesAtraso, 1)
  assert.equal(atrasada.kpis.atrasada, 300)
  assert.equal(atrasada.etapas[0].saldoProjetado, 300)
  // todo o saldo cai logo após o corte (a MO segue a regra do dia de corte: parte pode ir a maio)
  assert.ok(Math.abs(somaSerie(atrasada, 'competenciaMensal', (s) => s.mes > '2026-03') - 300) < 0.05)
  assert.equal(somaSerie(atrasada, 'competenciaMensal', (s) => s.mes > '2026-05'), 0)
  assert.ok(atrasada.seriesMensal.find((s) => s.mes === '2026-04').competenciaMensal > 0)

  // físico já em 100% no corte: o saldo continua pendente
  const concluida = projetar({
    etapas: [etapaE1({ data_fim: '2026-03-31', pontos_mensais: pontos([0.3, 0.6, 1]) })],
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-03-10', valor: 900, ap: null }],
  })
  assert.equal(concluida.etapas[0].pendente, 300)
})

test('projetarRealizado: etapa atrasada distribui o saldo pelos meses escolhidos', () => {
  const etapa = etapaE1({
    custo_mao_obra: 0, custo_total: 600, data_fim: '2026-03-31',
    pontos_mensais: ['2026-01', '2026-02', '2026-03'].map((m, i) => ({ data: `${m}-28`, previsto: 1 / 3, realizado_acumulado: [0.3, 0.6, 0.9][i] })),
  })
  const r = projetar({
    etapas: [etapa],
    corte: '2026-03',
    mesesAtraso: new Map([['01.01.01.01.001', 3]]),
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-03-10', valor: 300, ap: null }],
  })
  assert.equal(r.etapas[0].mesesAtraso, 3)
  const serie = (mes) => r.seriesMensal.find((s) => s.mes === mes)?.competenciaMensal || 0
  for (const mes of ['2026-04', '2026-05', '2026-06']) assert.ok(Math.abs(serie(mes) - 100) < 0.05, mes)
  assert.equal(serie('2026-07'), 0)
})

test('projetarRealizado: chegada de material antes do corte vai para o mês seguinte', () => {
  const r = projetar({ parametrosObra: { ...OBRA, dias_antecedencia_padrao: 40 }, corte: '2026-02' })
  assert.equal(somaSerie(r, 'competenciaMaterial', (s) => s.mes <= '2026-02'), 0)
  assert.ok(r.seriesMensal.find((s) => s.mes === '2026-03').competenciaMaterial > 150)
  assert.equal(somaSerie(r, 'competenciaMaterial'), 600)
})

test('projetarRealizado: fora do cronograma entra no total e no %', () => {
  const r = projetar({
    corte: '2026-03',
    realizado: [{ codigo_etapa: '99.99.99.99.999', tipo: 'MATERIAL', data: '2026-02-01', valor: 70, ap: null }],
  })
  assert.equal(somaSerie(r, 'competenciaForaCronograma'), 70)
  assert.equal(r.kpis.foraDoCronograma, 70)
  assert.equal(r.kpis.base, 1200)
  assert.equal(r.kpis.custoFinalEstimado, 1200)
  assert.equal(r.kpis.saldoCompetencia, 1130)
  assert.equal(r.kpis.realizadoAteCorte, 70)
  assert.equal(r.etapas.some((e) => e.codigo_etapa === '99.99.99.99.999'), false)
})

test('projetarRealizado: financeiro até o corte = pago por mês de vencimento; aberto vencido vai ao mês seguinte', () => {
  const r = projetar({
    etapas: [etapaE1({ custo_material: 0, custo_mao_obra: 0, custo_total: 0 })],
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-02-05', valor: 50, ap: 7 }],
    pagamentos: new Map([[7, [
      { vencimento: '2026-03-15', valor: 60, pago: 55, saldo: 5 },
      { vencimento: '2026-02-15', valor: 40, pago: 0, saldo: 40 },
    ]]]),
  })
  const fin = (m) => r.seriesMensal.find((s) => s.mes === m)?.financeiroMaterial || 0
  assert.equal(fin('2026-02'), 0)
  assert.equal(fin('2026-03'), 55)
  assert.equal(fin('2026-04'), 22.5)
  assert.equal(r.kpis.realizadoFinanceiroAteCorte, 55)
  assert.equal(r.kpis.abertoVencido, 45)
  assert.equal(r.kpis.realizadoSemPagamento, 0)
})

test('projetarRealizado: sem AP — financeiro estimado pela regra', () => {
  const r = projetar({
    etapas: [etapaE1({ custo_material: 0, custo_mao_obra: 0, custo_total: 0 })],
    corte: '2026-03',
    realizado: [{ codigo_etapa: '01.01.01.01.001', tipo: 'MAO_DE_OBRA', data: '2026-02-10', valor: 100, ap: null }],
  })
  assert.equal(r.seriesMensal.find((s) => s.mes === '2026-03').financeiroMaoDeObra, 100)
  assert.equal(r.kpis.realizadoSemPagamento, 100)
})

test('projetarRealizado: documento depois do corte é ignorado; sem data entra no corte', () => {
  const r = projetar({
    corte: '2026-03',
    realizado: [
      { codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-04-02', valor: 999, ap: null },
      { codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: null, valor: 10, ap: null },
    ],
  })
  assert.equal(r.seriesMensal.find((s) => s.mes === '2026-03').competenciaMaterial, 10)
  assert.equal(r.etapas[0].realizado, 10)
})

test('projetarRealizado: invariantes de fechamento', () => {
  const r = projetarRealizado({
    etapas: [etapaE1(), etapaE1({ codigo_etapa: '01.01.01.01.002', nome: 'E2', data_inicio: '2026-03-01', data_fim: '2026-09-30', pontos_mensais: [] })],
    parametrosObra: { dias_antecedencia_padrao: 10, prazo_pagamento_padrao_dias: 28 },
    parametrosEtapas: new Map(),
    corte: '2026-04',
    realizado: [
      { codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-01-15', valor: 250, ap: null },
      { codigo_etapa: '01.01.01.01.001', tipo: 'MAO_DE_OBRA', data: '2026-03-15', valor: 700, ap: null },
      { codigo_etapa: '01.01.01.01.002', tipo: 'MATERIAL', data: '2026-04-15', valor: 120, ap: null },
      { codigo_etapa: '88.00.00.00.000', tipo: 'MAO_DE_OBRA', data: '2026-02-15', valor: 30, ap: null },
    ],
    pagamentos: new Map(),
  })
  for (const e of r.etapas) {
    // por tipo: realizado + saldo + pendente = máx(custo, realizado) = custo + excedente
    assert.ok(Math.abs(e.realizado + e.saldoProjetado + e.pendente - (e.projetado + e.excedente)) < 0.05, e.codigo_etapa)
  }
  const k = r.kpis
  assert.ok(Math.abs(somaSerie(r, 'competenciaMensal') - (k.base + k.excedente + k.foraDoCronograma - k.pendente)) < 0.05)
  assert.ok(Math.abs(somaSerie(r, 'financeiroMensal') - somaSerie(r, 'competenciaMensal')) < 0.05)
})

test('projetarRealizado: realizado financeiro = pago das parcelas com vencimento até o corte', () => {
  const r = projetar({
    corte: '2026-03',
    pagamentos: new Map([
      [7, [{ vencimento: '2026-02-10', valor: 100, pago: 80, saldo: 20 }, { vencimento: '2026-03-31', valor: 50, pago: 50, saldo: 0 }]],
      [8, [{ vencimento: '2026-04-01', valor: 30, pago: 30, saldo: 0 }]],
    ]),
  })
  assert.equal(r.kpis.realizadoFinanceiroAteCorte, 130)
  assert.equal(r.kpis.realizadoAteCorte, 0)
})

test('projetarRealizado: pago repartido pela composição do apropriado da AP; AP sem apropriado vira material', () => {
  const r = projetar({
    etapas: [etapaE1({ custo_material: 0, custo_mao_obra: 0, custo_total: 0 })],
    corte: '2026-03',
    realizado: [
      { codigo_etapa: '01.01.01.01.001', tipo: 'MATERIAL', data: '2026-02-05', valor: 30, ap: 7 },
      { codigo_etapa: '01.01.01.01.001', tipo: 'MAO_DE_OBRA', data: '2026-02-05', valor: 10, ap: 7 },
    ],
    pagamentos: new Map([
      [7, [{ vencimento: '2026-02-20', valor: 40, pago: 40, saldo: 0 }]],
      [9, [{ vencimento: '2026-01-10', valor: 25, pago: 25, saldo: 0 }]],
    ]),
  })
  const mes = (m) => r.seriesMensal.find((s) => s.mes === m)
  assert.equal(mes('2026-02').financeiroMaterial, 30)
  assert.equal(mes('2026-02').financeiroMaoDeObra, 10)
  assert.equal(mes('2026-01').financeiroMaterial, 25)
  assert.equal(r.kpis.realizadoFinanceiroAteCorte, 65)
})

test('projetarRealizado: custo projetado fora do cronograma entra no custo final e no saldo', () => {
  const r = projetar({
    corte: '2026-03',
    projetadoFora: 300,
    realizado: [{ codigo_etapa: '16.01.01.01.001', tipo: 'MATERIAL', data: '2026-02-01', valor: 100, ap: null }],
  })
  assert.equal(r.kpis.base, 1200)
  assert.equal(r.kpis.foraProjetado, 300)
  assert.equal(r.kpis.custoProjetado, 1500)
  assert.equal(r.kpis.custoFinalEstimado, 1500)
  assert.equal(r.kpis.saldoCompetencia, 1400)
  assert.equal(r.kpis.saldoFinanceiro, 1500)
})

test('aplicarVinculos: soma o custo do código de origem na etapa de destino', () => {
  const custos = new Map([
    ['01.03.02.07.002', { material: 100, mao_de_obra: 50, total: 150, descricao: 'TIRANTE' }],
    ['01.03.02.07.020', { material: 10, mao_de_obra: 0, total: 10, descricao: 'OUTRO' }],
    ['99.01.01.01.001', { material: 5, mao_de_obra: 5, total: 10, descricao: 'FORA' }],
  ])
  const r = aplicarVinculos(custos, new Map([['99.01.01.01.001', '01.03.02.07.002']]))
  assert.equal(r.size, 2)
  assert.deepEqual(r.get('01.03.02.07.002'), { material: 105, mao_de_obra: 55, total: 160, descricao: 'TIRANTE' })
  assert.equal(r.has('99.01.01.01.001'), false)
  assert.equal(aplicarVinculos(custos, new Map()), custos)
})
