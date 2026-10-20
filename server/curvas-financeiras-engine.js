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

const arredondar = (v) => Math.round(v * 100) / 100

function ultimoDiaDoMes(mesIso) {
  const [y, m] = mesIso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Data de pagamento da MO: dia `dia` do mês seguinte à competência, limitado ao último dia do mês. */
export function dataPagamentoMo(mesCompetencia, dia = 5) {
  const mesPag = proximoMesIso(mesCompetencia)
  const d = Math.min(Math.max(1, Number(dia) || 5), ultimoDiaDoMes(mesPag))
  return `${mesPag}-${String(d).padStart(2, '0')}`
}

/** Mesma data um ano depois (29/02 vira 28/02). */
export function somarUmAnoIso(dataIso) {
  if (!dataIso) return null
  const [y, m, d] = String(dataIso).slice(0, 10).split('-').map(Number)
  const mes = `${y + 1}-${String(m).padStart(2, '0')}`
  return `${mes}-${String(Math.min(d, ultimoDiaDoMes(mes))).padStart(2, '0')}`
}

/**
 * Regra efetiva de uma etapa nível 5: regra própria (código Mega) > mãe nível 4 > avó nível 3.
 * O mapa é indexado por `${codigo}|${tipo}`.
 */
export function resolverRegra(mapa, { codigoMega, codigoPrevision }, tipo) {
  if (!mapa) return null
  const segs = String(codigoPrevision || codigoMega || '').split('.')
  const candidatos = [
    codigoMega,
    segs.length > 4 ? segs.slice(0, 4).join('.') : null,
    segs.length > 3 ? segs.slice(0, 3).join('.') : null,
  ]
  for (const c of candidatos) {
    if (c && mapa.has(`${c}|${tipo}`)) return mapa.get(`${c}|${tipo}`)
  }
  return null
}

function origemRegra(regra) {
  if (!regra?.codigo_etapa) return null
  return { codigo_origem: regra.codigo_etapa, nivel: String(regra.codigo_etapa).split('.').length }
}

/**
 * Distribui Mão de Obra no tempo:
 * - Competência: corte dia 21 a 20 -> cai no mês M
 * - Financeiro: desembolso no dia `diaPagamentoMo` de M+1
 * - Retenção técnica: `retencaoPercentual`% de cada medição só é paga em `dataLiberacaoRetencao`
 *   (a competência não muda)
 */
export function distribuirMaoDeObraEtapa({
  custo,
  dataInicio,
  dataFim,
  diaCorteMo = 20,
  diaPagamentoMo = 5,
  retencaoPercentual = 0,
  dataLiberacaoRetencao = null,
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

  const fracaoRetida = dataLiberacaoRetencao && Number(retencaoPercentual) > 0
    ? Math.min(1, Number(retencaoPercentual) / 100)
    : 0

  for (const [mesComp, valComp] of Object.entries(porCompetencia)) {
    const total = arredondar(valComp)
    const retido = arredondar(total * fracaoRetida)
    const dataPag = dataPagamentoMo(mesComp, diaPagamentoMo)
    eventos.push({
      tipo: 'MAO_DE_OBRA',
      mesCompetencia: mesComp,
      mesFinanceiro: mesAnoIso(dataPag),
      dataPagamento: dataPag,
      valor: arredondar(total - retido),
    })
    if (retido > 0) {
      eventos.push({
        tipo: 'MAO_DE_OBRA',
        mesCompetencia: mesComp,
        mesFinanceiro: mesAnoIso(dataLiberacaoRetencao),
        dataPagamento: dataLiberacaoRetencao,
        valor: retido,
        retencao: true,
      })
    }
  }

  return eventos
}

/**
 * Material proporcional à execução: o peso de cada mês é espalhado pelos dias daquele mês dentro da
 * etapa (ou pelo mês inteiro, se o ponto cair fora dela); sem pontos, uniforme entre início e fim.
 * Cada dia chega `diasAntecedencia` antes e é agrupado pelo mês de chegada.
 * Retorna [{ dataEntrega (dia médio ponderado), fracao }].
 */
function chegadasProporcionais({ dataInicio, fim, pontosMensais, diasAntecedencia }) {
  const dias = []
  const pontos = (Array.isArray(pontosMensais) ? pontosMensais : [])
    .map((p) => ({ mes: String(p.data || '').slice(0, 7), peso: Number(p.previsto ?? p.base) || 0 }))
    .filter((p) => p.peso > 0 && /^\d{4}-\d{2}$/.test(p.mes))

  if (pontos.length > 0) {
    for (const p of pontos) {
      const primeiro = `${p.mes}-01`
      const ultimo = `${p.mes}-${String(ultimoDiaDoMes(p.mes)).padStart(2, '0')}`
      let ini = dataInicio > primeiro ? dataInicio : primeiro
      let f = fim < ultimo ? fim : ultimo
      if (ini > f) { ini = primeiro; f = ultimo }
      const n = diferencaDias(ini, f) + 1
      for (let i = 0; i < n; i++) dias.push({ data: somarDiasIso(ini, i), peso: p.peso / n })
    }
  } else {
    const n = diferencaDias(dataInicio, fim) + 1
    for (let i = 0; i < n; i++) dias.push({ data: somarDiasIso(dataInicio, i), peso: 1 / n })
  }

  const somaPesos = dias.reduce((s, d) => s + d.peso, 0)
  const porMes = new Map()
  for (const d of dias) {
    const chegada = somarDiasIso(d.data, -Number(diasAntecedencia || 0))
    const mes = mesAnoIso(chegada)
    const b = porMes.get(mes) || { peso: 0, offset: 0 }
    b.peso += d.peso
    b.offset += d.peso * diferencaDias(dataInicio, chegada)
    porMes.set(mes, b)
  }
  return [...porMes.values()].map((b) => ({
    dataEntrega: somarDiasIso(dataInicio, Math.round(b.offset / b.peso)),
    fracao: b.peso / somaPesos,
  }))
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

  // Modalidade 2 (padrão): chega conforme a execução — proporcional ao cronograma mensal da Prevision,
  // ou uniforme entre início e fim se a etapa não tiver pontos mensais
  for (const { dataEntrega, fracao } of chegadasProporcionais({ dataInicio, fim, pontosMensais, diasAntecedencia })) {
    adicionarEntrega(dataEntrega, valor * fracao)
  }
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
  const diaPagamentoMo = Number(parametrosObra.dia_pagamento_mo || 5)

  // Retenção técnica: liberada 1 ano após o fim da obra (informado, ou a maior data de fim das etapas)
  const dataFimEtapas = etapas.reduce((max, e) => (e.data_fim && e.data_fim > (max || '') ? e.data_fim : max), null)
  const dataFimObra = parametrosObra.data_fim_obra ? String(parametrosObra.data_fim_obra).slice(0, 10) : dataFimEtapas
  const dataLiberacaoRetencao = somarUmAnoIso(dataFimObra)

  const todosEventos = []
  const etapasCalculadas = []
  let totalOrcadoGeral = 0
  let totalMaterialGeral = 0
  let totalMoGeral = 0

  for (const etapa of etapas) {
    const cod = etapa.codigo_etapa
    const codigos = { codigoMega: cod, codigoPrevision: etapa.codigo_prevision }
    const regraMat = resolverRegra(parametrosEtapas, codigos, 'MATERIAL')
    const regraMo = resolverRegra(parametrosEtapas, codigos, 'MAO_DE_OBRA')
    const param = regraMat || {}
    const retencaoAtiva = regraMo?.retencao_ativa ?? parametrosObra.retencao_mo_ativa ?? false
    const retencaoPct = Number(regraMo?.retencao_percentual ?? parametrosObra.retencao_mo_percentual ?? 5)

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
          diaPagamentoMo,
          retencaoPercentual: retencaoAtiva ? retencaoPct : 0,
          dataLiberacaoRetencao,
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
      codigo_prevision: etapa.codigo_prevision,
      nome: etapa.nome || etapa.descricao,
      nivel: etapa.nivel,
      data_inicio: etapa.data_inicio,
      data_fim: etapa.data_fim,
      custo_material: cMat,
      custo_mao_obra: cMo,
      custo_total: cTot,
      regraMaterial: origemRegra(regraMat),
      regraMo: origemRegra(regraMo),
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
      dataFimObraEtapas: dataFimEtapas,
      dataLiberacaoRetencao,
    },
    meses,
    seriesMensal,
    etapas: etapasCalculadas,
  }
}
