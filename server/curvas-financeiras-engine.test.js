import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calcularCurvasFinanceiras,
  diferencaDias,
  distribuirMaoDeObraEtapa,
  distribuirMaterialEtapa,
  mesCompetenciaMo,
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
  assert.equal(eventos[0].valor, 10000)

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
      '01.01.01.01.001',
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
