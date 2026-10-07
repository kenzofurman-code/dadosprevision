// Motor de Cálculo das Curvas de Competência e Financeira
// Integra Custo Projetado (Material x MO) com Cronograma Físico da Prevision.

export function somarDiasIso(dataIso, dias) {
  if (!dataIso) return null
  const [y, m, d] = String(dataIso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const dt = new Date(Date.UTC(y, m - 1, d + Number(dias || 0), 12, 0, 0))
  return dt.toISOString().slice(0, 10)
}

export function diferencaDias(dataIni, dataFim) {
  if (!dataIni || !dataFim) return 0
  const [y1, m1, d1] = dataIni.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = dataFim.slice(0, 10).split('-').map(Number)
  const dt1 = Date.UTC(y1, m1 - 1, d1)
  const dt2 = Date.UTC(y2, m2 - 1, d2)
  return Math.round((dt2 - dt1) / (1000 * 60 * 60 * 24))
}

export function mesAnoIso(dataIso) {
  return String(dataIso || '').slice(0, 7)
}

export function proximoMesIso(mesIso) {
  if (!mesIso || !/^\d{4}-\d{2}$/.test(mesIso)) return mesIso
  const [y, m] = mesIso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m, 1, 12, 0, 0))
  return dt.toISOString().slice(0, 7)
}

/**
 * Regra de Mão de Obra:
 * Serviços executados de 21/(M-1) a 20/M pertencem à competência M.
 */
export function mesCompetenciaMo(dataIso, diaCorte = 20) {
  if (!dataIso) return ''
  const [y, m, d] = dataIso.slice(0, 10).split('-').map(Number)
  if (d <= diaCorte) {
    return `${y}-${String(m).padStart(2, '0')}`
  }
  // Se passou do dia 20, gera competência no mês seguinte
  const prox = new Date(Date.UTC(y, m, 1, 12, 0, 0))
  return prox.toISOString().slice(0, 7)
}

/**
 * Distribui Mão de Obra no tempo:
 * - Competência: corte dia 21 a 20 -> cai no mês M
 * - Financeiro: desembolso no dia 5 de M+1 -> cai no mês M+1
 */
export function distribuirMaoDeObraEtapa({
  custo,
  dataInicio,
  dataFim,
  diaCorteMo = 20,
}) {
  const eventos = []
  const valor = Number(custo || 0)
  if (valor <= 0 || !dataInicio) return eventos

  const fim = dataFim && dataFim >= dataInicio ? dataFim : dataInicio
  const totalDias = Math.max(1, diferencaDias(dataInicio, fim) + 1)
  const valorDiario = valor / totalDias

  // Agrupar valores por mês de competência
  const porCompetencia = {}
  let dAtual = dataInicio
  for (let i = 0; i < totalDias; i++) {
    const comp = mesCompetenciaMo(dAtual, diaCorteMo)
    porCompetencia[comp] = (porCompetencia[comp] || 0) + valorDiario
    dAtual = somarDiasIso(dAtual, 1)
  }

  for (const [mesComp, valComp] of Object.entries(porCompetencia)) {
    const mesFin = proximoMesIso(mesComp)
    eventos.push({
      tipo: 'MAO_DE_OBRA',
      mesCompetencia: mesComp,
      mesFinanceiro: mesFin,
      valor: Math.round(valComp * 100) / 100,
    })
  }

  return eventos
}

/**
 * Distribui Material no tempo:
 * - Competência: Data de entrega (Início - Antecedência em dias)
 *   - Lotes fixos uniformes OU proporcional ao cronograma
 * - Financeiro: Data de entrega + Prazo de pagamento (28d, 35d ou parcelado)
 */
export function distribuirMaterialEtapa({
  custo,
  dataInicio,
  dataFim,
  diasAntecedencia = 10,
  numEntregas = null,
  tipoPagamento = 'DIAS',
  prazoDias = 28,
  parcelasDias = null,
  pontosMensais = null,
}) {
  const eventos = []
  const valor = Number(custo || 0)
  if (valor <= 0 || !dataInicio) return eventos

  const fim = dataFim && dataFim >= dataInicio ? dataFim : dataInicio
  const duracao = Math.max(0, diferencaDias(dataInicio, fim))
  const data1aEntrega = somarDiasIso(dataInicio, -Number(diasAntecedencia || 0))

  // Condições de pagamento: lista de parcelas e seus prazos
  let condicoes = []
  if (tipoPagamento === 'PARCELADO' && Array.isArray(parcelasDias) && parcelasDias.length > 0) {
    const frac = 1 / parcelasDias.length
    condicoes = parcelasDias.map((d) => ({ dias: Number(d), fracao: frac }))
  } else {
    condicoes = [{ dias: Number(prazoDias || 28), fracao: 1 }]
  }

  // Helper para gerar eventos a partir de uma entrega física
  function adicionarEntrega(dataEntrega, valorEntrega) {
    const mesComp = mesAnoIso(dataEntrega)
    for (const cond of condicoes) {
      const dataVenc = somarDiasIso(dataEntrega, cond.dias)
      const mesFin = mesAnoIso(dataVenc)
      const valParcela = valorEntrega * cond.fracao
      eventos.push({
        tipo: 'MATERIAL',
        dataEntrega,
        dataVencimento: dataVenc,
        mesCompetencia: mesComp,
        mesFinanceiro: mesFin,
        valor: Math.round(valParcela * 100) / 100,
      })
    }
  }

  // Modalidade 1: Lotes Fixos de Entrega (se numEntregas >= 1)
  if (numEntregas && Number(numEntregas) >= 1) {
    const N = Number(numEntregas)
    const valorLote = valor / N

    if (N === 1 || duracao === 0) {
      adicionarEntrega(data1aEntrega, valor)
    } else {
      const step = duracao / (N - 1)
      for (let k = 0; k < N; k++) {
        const offsetDias = Math.round(k * step)
        const dtEntrega = somarDiasIso(data1aEntrega, offsetDias)
        adicionarEntrega(dtEntrega, valorLote)
      }
    }
    return eventos
  }

  // Modalidade 2: Proporcional ao Cronograma Mensal da Prevision
  if (Array.isArray(pontosMensais) && pontosMensais.length > 0) {
    // Normalizar pesos previstos do cronograma
    const pontosValidos = pontosMensais.filter((p) => p.data && (Number(p.previsto) > 0 || Number(p.base) > 0))
    const somaPesos = pontosValidos.reduce((acc, p) => acc + (Number(p.previsto ?? p.base) || 0), 0)

    if (somaPesos > 0) {
      for (const p of pontosValidos) {
        const peso = Number(p.previsto ?? p.base) || 0
        const valorMes = (peso / somaPesos) * valor
        // A entrega ocorre com a antecedência antes do meio do mês ou início do mês
        const diaEntregaAprox = somarDiasIso(`${p.data.slice(0, 7)}-01`, -Number(diasAntecedencia || 0))
        adicionarEntrega(diaEntregaAprox, valorMes)
      }
      return eventos
    }
  }

  // Fallback padrão se não tiver cronograma detalhado: 100% entregue no início com antecedência
  adicionarEntrega(data1aEntrega, valor)
  return eventos
}

/**
 * Motor Principal: Calcula todas as curvas e a matriz mensal completa
 */
export function calcularCurvasFinanceiras({
  etapas,
  parametrosObra = {},
  parametrosEtapas = new Map(),
  realizadoHistorico = 0,
}) {
  const diaCorteMo = Number(parametrosObra.dia_corte_medicao_mo || 20)
  const antecedenciaPadrao = Number(parametrosObra.dias_antecedencia_padrao || 10)
  const prazoPadrao = Number(parametrosObra.prazo_pagamento_padrao_dias || 28)

  const todosEventos = []
  const etapasCalculadas = []
  let totalOrcadoGeral = 0
  let totalMaterialGeral = 0
  let totalMoGeral = 0

  for (const etapa of etapas) {
    const cod = etapa.codigo_etapa
    const param = parametrosEtapas.get(cod) || {}

    const cMat = Number(etapa.custo_material || 0)
    const cMo = Number(etapa.custo_mao_obra || 0)
    const cTot = cMat + cMo > 0 ? cMat + cMo : Number(etapa.custo_total || 0)

    totalMaterialGeral += cMat
    totalMoGeral += cMo
    totalOrcadoGeral += cTot

    const antMat = param.dias_antecedencia !== undefined && param.dias_antecedencia !== null
      ? Number(param.dias_antecedencia)
      : antecedenciaPadrao
    const prazMat = param.prazo_dias !== undefined && param.prazo_dias !== null
      ? Number(param.prazo_dias)
      : prazoPadrao
    const nEntregas = param.num_entregas ? Number(param.num_entregas) : null
    const tipoPag = param.tipo_pagamento || 'DIAS'
    const parcelas = param.parcelas_dias || null

    // 1. Distribuir Material
    const eventosMat = cMat > 0
      ? distribuirMaterialEtapa({
          custo: cMat,
          dataInicio: etapa.data_inicio,
          dataFim: etapa.data_fim,
          diasAntecedencia: antMat,
          numEntregas: nEntregas,
          tipoPagamento: tipoPag,
          prazoDias: prazMat,
          parcelasDias: parcelas,
          pontosMensais: etapa.pontos_mensais,
        })
      : []

    // 2. Distribuir Mão de Obra
    const eventosMo = cMo > 0
      ? distribuirMaoDeObraEtapa({
          custo: cMo,
          dataInicio: etapa.data_inicio,
          dataFim: etapa.data_fim,
          diaCorteMo,
        })
      : []

    // 3. Distribuição Econômica (CFF Puro)
    const eventosEcon = []
    if (Array.isArray(etapa.pontos_mensais) && etapa.pontos_mensais.length > 0) {
      const somaP = etapa.pontos_mensais.reduce((s, p) => s + (Number(p.previsto ?? p.base) || 0), 0)
      if (somaP > 0) {
        for (const p of etapa.pontos_mensais) {
          const w = (Number(p.previsto ?? p.base) || 0) / somaP
          if (w > 0) {
            eventosEcon.push({
              mes: p.data.slice(0, 7),
              valor: Math.round(cTot * w * 100) / 100,
            })
          }
        }
      }
    } else if (etapa.data_inicio) {
      eventosEcon.push({
        mes: etapa.data_inicio.slice(0, 7),
        valor: cTot,
      })
    }

    const eventosEtapa = [...eventosMat, ...eventosMo]
    for (const ev of eventosEtapa) {
      ev.codigo_etapa = cod
      ev.etapa_nome = etapa.nome || etapa.descricao
    }
    todosEventos.push(...eventosEtapa)

    etapasCalculadas.push({
      codigo_etapa: cod,
      nome: etapa.nome || etapa.descricao,
      nivel: etapa.nivel,
      data_inicio: etapa.data_inicio,
      data_fim: etapa.data_fim,
      custo_material: cMat,
      custo_mao_obra: cMo,
      custo_total: cTot,
      eventos: eventosEtapa,
      eventosEconomico: eventosEcon,
    })
  }

  // Descobrir todos os meses únicos envolvidos nas projeções
  const mesesSet = new Set()
  for (const ev of todosEventos) {
    if (ev.mesCompetencia) mesesSet.add(ev.mesCompetencia)
    if (ev.mesFinanceiro) mesesSet.add(ev.mesFinanceiro)
  }
  for (const et of etapasCalculadas) {
    for (const ec of et.eventosEconomico) {
      if (ec.mes) mesesSet.add(ec.mes)
    }
  }

  const meses = Array.from(mesesSet).sort()

  // Montar séries mensais consolidadas
  const seriesMensal = []
  let acumEconomico = 0
  let acumCompetencia = 0
  let acumFinanceiro = 0

  for (const m of meses) {
    let valorEcon = 0
    let valorCompMat = 0
    let valorCompMo = 0
    let valorFinMat = 0
    let valorFinMo = 0

    for (const et of etapasCalculadas) {
      for (const ec of et.eventosEconomico) {
        if (ec.mes === m) valorEcon += ec.valor
      }
    }

    for (const ev of todosEventos) {
      if (ev.mesCompetencia === m) {
        if (ev.tipo === 'MATERIAL') valorCompMat += ev.valor
        else valorCompMo += ev.valor
      }
      if (ev.mesFinanceiro === m) {
        if (ev.tipo === 'MATERIAL') valorFinMat += ev.valor
        else valorFinMo += ev.valor
      }
    }

    const totalComp = valorCompMat + valorCompMo
    const totalFin = valorFinMat + valorFinMo

    acumEconomico += valorEcon
    acumCompetencia += totalComp
    acumFinanceiro += totalFin

    seriesMensal.push({
      mes: m,
      economicoMensal: Math.round(valorEcon * 100) / 100,
      economicoAcumulado: Math.round(acumEconomico * 100) / 100,
      competenciaMensal: Math.round(totalComp * 100) / 100,
      competenciaMaterial: Math.round(valorCompMat * 100) / 100,
      competenciaMaoDeObra: Math.round(valorCompMo * 100) / 100,
      competenciaAcumulado: Math.round(acumCompetencia * 100) / 100,
      financeiroMensal: Math.round(totalFin * 100) / 100,
      financeiroMaterial: Math.round(valorFinMat * 100) / 100,
      financeiroMaoDeObra: Math.round(valorFinMo * 100) / 100,
      financeiroAcumulado: Math.round(acumFinanceiro * 100) / 100,
    })
  }

  // KPIs
  const picoFinanceiro = seriesMensal.reduce(
    (max, item) => (item.financeiroMensal > (max.valor || 0) ? { mes: item.mes, valor: item.financeiroMensal } : max),
    { mes: null, valor: 0 }
  )

  const saldoProjetado = Math.max(0, totalOrcadoGeral - Number(realizadoHistorico || 0))

  return {
    kpis: {
      totalOrcado: Math.round(totalOrcadoGeral * 100) / 100,
      totalMaterial: Math.round(totalMaterialGeral * 100) / 100,
      totalMaoDeObra: Math.round(totalMoGeral * 100) / 100,
      realizadoHistorico: Number(realizadoHistorico || 0),
      saldoProjetado: Math.round(saldoProjetado * 100) / 100,
      picoFinanceiro,
      totalMeses: meses.length,
      inicioProjecao: meses[0] || null,
      fimProjecao: meses[meses.length - 1] || null,
    },
    meses,
    seriesMensal,
    etapas: etapasCalculadas,
  }
}
