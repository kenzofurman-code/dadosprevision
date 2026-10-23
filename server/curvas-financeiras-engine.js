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

/**
 * Custo projetado por etapa (código Mega) dividido entre o que tem etapa nível 5 no cronograma
 * (`dentro`, entra nas curvas) e o que não tem (`fora`: taxas, itens fora de orçamento, etapas
 * que não existem na Prevision), do maior para o menor valor.
 */
export function separarForaDoCronograma(custos, codigosEap) {
  const dentro = new Map()
  const fora = []
  for (const [codigo, v] of custos) {
    if (codigosEap.has(codigo)) dentro.set(codigo, v)
    else fora.push({ codigo, ...v })
  }
  fora.sort((a, b) => b.total - a.total)
  return { dentro, fora, totalFora: arredondar(fora.reduce((s, f) => s + f.total, 0)) }
}

/** Por mês: [competência material, competência MO, financeiro material, financeiro MO] (planilha analítica). */
function matrizMensal(eventos) {
  const m = {}
  const somar = (mes, i, v) => {
    if (!mes) return
    if (!m[mes]) m[mes] = [0, 0, 0, 0]
    m[mes][i] = arredondar(m[mes][i] + v)
  }
  for (const ev of eventos) {
    const mat = ev.tipo === 'MATERIAL'
    somar(ev.mesCompetencia, mat ? 0 : 1, ev.valor)
    somar(ev.mesFinanceiro, mat ? 2 : 3, ev.valor)
  }
  return m
}

function origemRegra(regra) {
  if (!regra?.codigo_etapa) return null
  return { codigo_origem: regra.codigo_etapa, nivel: String(regra.codigo_etapa).split('.').length }
}


/**
 * Físico diário da etapa — base única das três curvas. O peso de cada mês do cronograma
 * (`pontos_mensais[].previsto`, ou `base`) é espalhado igualmente pelos dias daquele mês dentro da
 * etapa (o mês inteiro, se o ponto cair fora dela); sem pontos, uniforme entre início e fim.
 * Retorna [{ data, peso }] com Σ peso = 1.
 */
export function fisicoDiario({ dataInicio, fim, pontosMensais }) {
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
  const soma = dias.reduce((s, d) => s + d.peso, 0) || 1
  return dias.map((d) => ({ data: d.data, peso: d.peso / soma }))
}

const fmtData = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/')

/** Fluxos { tipo, fis, comp, fin, valor, mComp, mFin } somados por chave e arredondados a centavos. */
function agregarFluxos(brutos) {
  const m = new Map()
  for (const f of brutos) {
    if (!(f.valor > 0)) continue
    const k = `${f.tipo}|${f.fis}|${f.comp}|${f.fin}|${f.mComp}|${f.mFin}`
    const atual = m.get(k)
    if (atual) atual.valor += f.valor
    else m.set(k, { ...f })
  }
  return [...m.values()].map((f) => ({ ...f, valor: arredondar(f.valor) })).filter((f) => f.valor > 0)
}

/**
 * Mão de Obra: segue o físico diário da etapa.
 * - Competência: cada dia executado de 21/M-1 a 20/M cai no mês M (corte `diaCorteMo`)
 * - Financeiro: desembolso no dia `diaPagamentoMo` de M+1
 * - Retenção técnica: `retencaoPercentual`% de cada medição só é paga em `dataLiberacaoRetencao`
 *   (a competência não muda)
 * Retorna { eventos, fluxos }.
 */
function maoDeObraComFluxos({
  custo,
  dataInicio,
  dataFim,
  diaCorteMo = 20,
  diaPagamentoMo = 5,
  retencaoPercentual = 0,
  dataLiberacaoRetencao = null,
  pontosMensais = null,
}) {
  const eventos = []
  const brutos = []
  const valor = Number(custo || 0)
  if (valor <= 0 || !dataInicio) return { eventos, fluxos: [] }

  const fim = dataFim && dataFim >= dataInicio ? dataFim : dataInicio
  // por mês de competência: valor total e quanto veio de cada mês físico
  const porCompetencia = new Map()
  for (const d of fisicoDiario({ dataInicio, fim, pontosMensais })) {
    const comp = mesCompetenciaMo(d.data, diaCorteMo)
    const fis = mesAnoIso(d.data)
    const b = porCompetencia.get(comp) || { valor: 0, porFis: new Map() }
    b.valor += valor * d.peso
    b.porFis.set(fis, (b.porFis.get(fis) || 0) + valor * d.peso)
    porCompetencia.set(comp, b)
  }

  const fracaoRetida = dataLiberacaoRetencao && Number(retencaoPercentual) > 0
    ? Math.min(1, Number(retencaoPercentual) / 100)
    : 0

  for (const [mesComp, b] of porCompetencia) {
    const total = arredondar(b.valor)
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
    for (const [fis, v] of b.porFis) {
      const mComp = fis === mesComp ? `dias 1 a ${diaCorteMo}` : `dias ${diaCorteMo + 1} em diante (corte dia ${diaCorteMo})`
      brutos.push({ tipo: 'MAO_DE_OBRA', fis, comp: mesComp, fin: mesAnoIso(dataPag), valor: v * (1 - fracaoRetida), mComp, mFin: `pago dia ${Number(dataPag.slice(8, 10))}` })
      if (fracaoRetida > 0) {
        brutos.push({
          tipo: 'MAO_DE_OBRA', fis, comp: mesComp, fin: mesAnoIso(dataLiberacaoRetencao), valor: v * fracaoRetida, mComp,
          mFin: `retenção ${Number(retencaoPercentual)}% (liberada em ${fmtData(dataLiberacaoRetencao)})`,
        })
      }
    }
  }

  return { eventos, fluxos: agregarFluxos(brutos) }
}

/** Distribui Mão de Obra no tempo (ver maoDeObraComFluxos). Retorna só os eventos. */
export function distribuirMaoDeObraEtapa(params) {
  return maoDeObraComFluxos(params).eventos
}

/**
 * Material:
 * - Competência = data de chegada na obra.
 *   - Proporcional (padrão): cada dia físico chega `diasAntecedencia` antes; uma "nota" por mês de
 *     chegada, no dia médio ponderado.
 *   - Lotes (`numEntregas` = N): o período com físico é dividido em N períodos iguais; a entrega k chega
 *     `diasAntecedencia` antes do início do seu período e leva o material do físico desse período.
 * - Financeiro: data de chegada + prazo (único ou parcelado).
 * Retorna { eventos, fluxos }.
 */
function materialComFluxos({
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
  const brutos = []
  const valor = Number(custo || 0)
  if (valor <= 0 || !dataInicio) return { eventos, fluxos: [] }

  const fim = dataFim && dataFim >= dataInicio ? dataFim : dataInicio
  const antecedencia = Number(diasAntecedencia || 0)
  const dias = fisicoDiario({ dataInicio, fim, pontosMensais })

  // Condições de pagamento: lista de parcelas e seus prazos
  let condicoes = []
  if (tipoPagamento === 'PARCELADO' && Array.isArray(parcelasDias) && parcelasDias.length > 0) {
    const frac = 1 / parcelasDias.length
    condicoes = parcelasDias.map((d, i) => ({ dias: Number(d), fracao: frac, motivo: `parcela ${i + 1}/${parcelasDias.length} (${Number(d)} dias)` }))
  } else {
    const d = Number(prazoDias ?? 28)
    condicoes = [{ dias: d, fracao: 1, motivo: `pagamento em ${d} dias` }]
  }

  // Uma entrega: eventos por parcela + fluxos por mês físico de origem (porFis: mês -> peso)
  function adicionarEntrega(dataEntrega, porFis, mComp) {
    const mesComp = mesAnoIso(dataEntrega)
    const pesoEntrega = [...porFis.values()].reduce((s, p) => s + p, 0)
    for (const cond of condicoes) {
      const dataVenc = somarDiasIso(dataEntrega, cond.dias)
      const mesFin = mesAnoIso(dataVenc)
      eventos.push({
        tipo: 'MATERIAL',
        dataEntrega,
        dataVencimento: dataVenc,
        mesCompetencia: mesComp,
        mesFinanceiro: mesFin,
        valor: arredondar(valor * pesoEntrega * cond.fracao),
      })
      for (const [fis, p] of porFis) {
        brutos.push({ tipo: 'MATERIAL', fis, comp: mesComp, fin: mesFin, valor: valor * p * cond.fracao, mComp, mFin: cond.motivo })
      }
    }
  }

  if (numEntregas && Number(numEntregas) >= 1) {
    // Lotes: o prazo (T dias) é dividido em N períodos de dias inteiros; o período k começa no dia
    // floor(k·T/N). Cada dia físico abastece o lote do seu período (dias fora da etapa: o mais próximo).
    // O intervalo é o do físico (primeiro ao último dia com execução), não as datas da etapa: se o
    // cronograma mensal divergir delas, a entrega ainda chega antes do físico que abastece.
    const N = Number(numEntregas)
    const comFisico = dias.filter((d) => d.peso > 0).map((d) => d.data).sort()
    const inicioFisico = comFisico[0] || dataInicio
    const T = diferencaDias(inicioFisico, comFisico[comFisico.length - 1] || fim) + 1
    const inicioPeriodo = (k) => Math.floor((k * T) / N)
    const lotes = Array.from({ length: N }, () => new Map())
    for (const d of dias) {
      const i = Math.min(T - 1, Math.max(0, diferencaDias(inicioFisico, d.data)))
      let k = N - 1
      while (k > 0 && inicioPeriodo(k) > i) k--
      const fis = mesAnoIso(d.data)
      lotes[k].set(fis, (lotes[k].get(fis) || 0) + d.peso)
    }
    lotes.forEach((porFis, k) => {
      if (![...porFis.values()].some((p) => p > 0)) return
      const chegada = somarDiasIso(inicioFisico, inicioPeriodo(k) - antecedencia)
      adicionarEntrega(chegada, porFis, `entrega ${k + 1} de ${N} (chega ${antecedencia} dias antes)`)
    })
    return { eventos, fluxos: agregarFluxos(brutos) }
  }

  // Proporcional: agrupa os dias pelo mês de chegada
  const porMesChegada = new Map()
  for (const d of dias) {
    const chegada = somarDiasIso(d.data, -antecedencia)
    const mes = mesAnoIso(chegada)
    const b = porMesChegada.get(mes) || { peso: 0, offset: 0, porFis: new Map() }
    b.peso += d.peso
    b.offset += d.peso * diferencaDias(dataInicio, chegada)
    const fis = mesAnoIso(d.data)
    b.porFis.set(fis, (b.porFis.get(fis) || 0) + d.peso)
    porMesChegada.set(mes, b)
  }
  for (const b of porMesChegada.values()) {
    adicionarEntrega(somarDiasIso(dataInicio, Math.round(b.offset / b.peso)), b.porFis, `chega ${antecedencia} dias antes da execução`)
  }
  return { eventos, fluxos: agregarFluxos(brutos) }
}

/** Distribui Material no tempo (ver materialComFluxos). Retorna só os eventos. */
export function distribuirMaterialEtapa(params) {
  return materialComFluxos(params).eventos
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
  const antecedenciaPadrao = Number(parametrosObra.dias_antecedencia_padrao ?? 10)
  const prazoPadrao = Number(parametrosObra.prazo_pagamento_padrao_dias ?? 28)
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
    const mat = cMat > 0
      ? materialComFluxos({
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
      : { eventos: [], fluxos: [] }

    // 2. Distribuir Mão de Obra (segue o mesmo físico diário)
    const mo = cMo > 0
      ? maoDeObraComFluxos({
          custo: cMo,
          dataInicio: etapa.data_inicio,
          dataFim: etapa.data_fim,
          diaCorteMo,
          diaPagamentoMo,
          retencaoPercentual: retencaoAtiva ? retencaoPct : 0,
          dataLiberacaoRetencao,
          pontosMensais: etapa.pontos_mensais,
        })
      : { eventos: [], fluxos: [] }
    const eventosMat = mat.eventos
    const eventosMo = mo.eventos

    // 3. Distribuição Econômica (físico-financeiro): custo total sobre o físico diário
    const eventosEcon = []
    if (etapa.data_inicio && cTot > 0) {
      const fimEtapa = etapa.data_fim && etapa.data_fim >= etapa.data_inicio ? etapa.data_fim : etapa.data_inicio
      const porMes = new Map()
      for (const d of fisicoDiario({ dataInicio: etapa.data_inicio, fim: fimEtapa, pontosMensais: etapa.pontos_mensais })) {
        const m = mesAnoIso(d.data)
        porMes.set(m, (porMes.get(m) || 0) + d.peso)
      }
      for (const [mes, w] of [...porMes].sort()) eventosEcon.push({ mes, valor: arredondar(cTot * w) })
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
      mensal: matrizMensal(eventosEtapa),
      fluxos: [...mat.fluxos, ...mo.fluxos],
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

/**
 * Realizado + projeção: até o fim do mês `corte` a competência é o apropriado do Mega
 * (`realizado`); depois, o saldo de cada etapa e tipo (custo − realizado) segue o físico que resta,
 * com as mesmas regras da curva teórica.
 * - Excedente (realizado da etapa > custo da etapa): nada é projetado; a etapa fica em alerta.
 * - Saldo sem físico depois do corte: pendente (fora das séries); a etapa fica em alerta.
 * - Código sem etapa no cronograma: "fora do cronograma", entra nas séries e no total.
 * - Financeiro do realizado: pelos vencimentos das APs em `pagamentos` (parcela vencida em aberto vai
 *   para o mês seguinte ao corte); sem AP, estimado pelas regras de pagamento da etapa.
 */
export function projetarRealizado({
  etapas,
  parametrosObra = {},
  parametrosEtapas = new Map(),
  corte,
  realizado = [],
  pagamentos = new Map(),
}) {
  const teorica = calcularCurvasFinanceiras({ etapas, parametrosObra, parametrosEtapas })
  const fimCorte = `${corte}-${String(ultimoDiaDoMes(corte)).padStart(2, '0')}`
  const posCorte = proximoMesIso(corte)
  const inicioPos = `${posCorte}-01`
  const diaPagamentoMo = Number(parametrosObra.dia_pagamento_mo || 5)
  const prazoPadrao = Number(parametrosObra.prazo_pagamento_padrao_dias ?? 28)
  const dataLiberacaoRetencao = teorica.kpis.dataLiberacaoRetencao
  const porCodigo = new Map(etapas.map((e) => [e.codigo_etapa, e]))

  const meses = new Map()
  const somar = (mes, campo, v) => {
    if (!meses.has(mes)) meses.set(mes, { compMat: 0, compMo: 0, compFora: 0, finMat: 0, finMo: 0, finFora: 0 })
    meses.get(mes)[campo] += v
  }
  const somarComp = (mes, tipo, fora, v) => {
    somar(mes, tipo === 'MATERIAL' ? 'compMat' : 'compMo', v)
    if (fora) somar(mes, 'compFora', v)
  }
  const somarFin = (mes, tipo, fora, v) => {
    somar(mes, tipo === 'MATERIAL' ? 'finMat' : 'finMo', v)
    if (fora) somar(mes, 'finFora', v)
  }

  // 1. Realizado até o corte: competência no mês do documento, financeiro pela AP ou estimado
  const realPorChave = new Map()
  let foraDoCronograma = 0
  let realizadoSemPagamento = 0
  let realizadoAteCorte = 0
  for (const r of realizado) {
    const valor = Number(r.valor) || 0
    if (!valor || (r.data && r.data > fimCorte)) continue
    const data = r.data || fimCorte
    const mes = mesAnoIso(data)
    const etapa = porCodigo.get(r.codigo_etapa)
    const fora = !etapa
    const chave = `${r.codigo_etapa}|${r.tipo}`
    realizadoAteCorte += valor
    somarComp(mes, r.tipo, fora, valor)
    if (fora) foraDoCronograma += valor
    else realPorChave.set(chave, (realPorChave.get(chave) || 0) + valor)

    const parcelas = r.ap != null ? pagamentos.get(Number(r.ap)) : null
    const totalAp = (parcelas || []).reduce((s, p) => s + (Number(p.valor) || 0), 0)
    if (totalAp > 0) {
      for (const p of parcelas) {
        const parte = (valor * (Number(p.valor) || 0)) / totalAp
        const mesV = mesAnoIso(p.vencimento)
        const aberto = mesV <= corte && p.valor > 0 ? parte * Math.min(1, Math.max(0, Number(p.saldo) / p.valor)) : 0
        if (parte - aberto) somarFin(mesV, r.tipo, fora, parte - aberto)
        if (aberto) somarFin(posCorte, r.tipo, fora, aberto)
      }
      continue
    }
    realizadoSemPagamento += valor
    const codigos = { codigoMega: r.codigo_etapa, codigoPrevision: etapa?.codigo_prevision }
    if (r.tipo === 'MATERIAL') {
      const regra = resolverRegra(parametrosEtapas, codigos, 'MATERIAL') || {}
      const prazos = regra.tipo_pagamento === 'PARCELADO' && Array.isArray(regra.parcelas_dias) && regra.parcelas_dias.length
        ? regra.parcelas_dias
        : [regra.prazo_dias ?? prazoPadrao]
      for (const d of prazos) somarFin(mesAnoIso(somarDiasIso(data, Number(d))), r.tipo, fora, valor / prazos.length)
    } else {
      const regra = resolverRegra(parametrosEtapas, codigos, 'MAO_DE_OBRA')
      const ativa = regra?.retencao_ativa ?? parametrosObra.retencao_mo_ativa ?? false
      const fracao = ativa && dataLiberacaoRetencao
        ? Math.min(1, Number(regra?.retencao_percentual ?? parametrosObra.retencao_mo_percentual ?? 5) / 100)
        : 0
      somarFin(mesAnoIso(dataPagamentoMo(mes, diaPagamentoMo)), r.tipo, fora, valor * (1 - fracao))
      if (fracao > 0) somarFin(mesAnoIso(dataLiberacaoRetencao), r.tipo, fora, valor * fracao)
    }
  }

  // 2. Saldo por etapa e tipo: projetado pelo físico depois do corte, excedente ou pendente
  const temFisicoDepois = (e) => {
    const pontos = (Array.isArray(e.pontos_mensais) ? e.pontos_mensais : [])
      .filter((p) => (Number(p.previsto ?? p.base) || 0) > 0 && /^\d{4}-\d{2}/.test(String(p.data || '')))
    if (pontos.length) return pontos.some((p) => String(p.data).slice(0, 7) > corte)
    return Boolean(e.data_inicio) && String(e.data_fim || e.data_inicio) > fimCorte
  }
  const resumo = []
  const clones = []
  for (const e of etapas) {
    const custos = { MATERIAL: Number(e.custo_material || 0), MAO_DE_OBRA: Number(e.custo_mao_obra || 0) }
    const futuro = temFisicoDepois(e)
    const r = { codigo_etapa: e.codigo_etapa, nome: e.nome || e.descricao, projetado: 0, realizado: 0, saldoProjetado: 0, excedente: 0, pendente: 0 }
    // Excedente e pendente são da etapa: o Mega e o custo projetado podem classificar o mesmo
    // insumo em tipos diferentes. O saldo é repartido entre os tipos pelo que falta em cada um.
    const real = { MATERIAL: realPorChave.get(`${e.codigo_etapa}|MATERIAL`) || 0, MAO_DE_OBRA: realPorChave.get(`${e.codigo_etapa}|MAO_DE_OBRA`) || 0 }
    r.projetado = custos.MATERIAL + custos.MAO_DE_OBRA
    r.realizado = real.MATERIAL + real.MAO_DE_OBRA
    const saldo = r.projetado - r.realizado
    const aProjetar = { MATERIAL: 0, MAO_DE_OBRA: 0 }
    if (saldo < 0) r.excedente = -saldo
    else if (saldo > 0 && !futuro) r.pendente = saldo
    else if (saldo > 0) {
      r.saldoProjetado = saldo
      const falta = { MATERIAL: Math.max(0, custos.MATERIAL - real.MATERIAL), MAO_DE_OBRA: Math.max(0, custos.MAO_DE_OBRA - real.MAO_DE_OBRA) }
      const peso = falta.MATERIAL + falta.MAO_DE_OBRA > 0 ? falta : custos
      const totalPeso = peso.MATERIAL + peso.MAO_DE_OBRA
      aProjetar.MATERIAL = (saldo * peso.MATERIAL) / totalPeso
      aProjetar.MAO_DE_OBRA = saldo - aProjetar.MATERIAL
    }
    if (aProjetar.MATERIAL > 0 || aProjetar.MAO_DE_OBRA > 0) {
      clones.push({
        ...e,
        custo_material: aProjetar.MATERIAL,
        custo_mao_obra: aProjetar.MAO_DE_OBRA,
        custo_total: aProjetar.MATERIAL + aProjetar.MAO_DE_OBRA,
        data_inicio: e.data_inicio && e.data_inicio > inicioPos ? e.data_inicio : inicioPos,
        pontos_mensais: (Array.isArray(e.pontos_mensais) ? e.pontos_mensais : [])
          .map((p) => (String(p.data || '').slice(0, 7) <= corte ? { ...p, previsto: 0, base: 0 } : p)),
      })
    }
    for (const k of ['projetado', 'realizado', 'saldoProjetado', 'excedente', 'pendente']) r[k] = arredondar(r[k])
    r.alerta = r.excedente > 0 ? 'excedente' : r.pendente > 0 ? 'pendente' : null
    if (r.projetado > 0 || r.realizado > 0) resumo.push(r)
  }

  const projecao = calcularCurvasFinanceiras({
    etapas: clones,
    parametrosObra: { ...parametrosObra, data_fim_obra: parametrosObra.data_fim_obra || teorica.kpis.dataFimObraEtapas },
    parametrosEtapas,
  })
  for (const et of projecao.etapas) {
    for (const ev of et.eventos) {
      somarComp(ev.mesCompetencia <= corte ? posCorte : ev.mesCompetencia, ev.tipo, false, ev.valor)
      somarFin(ev.mesFinanceiro <= corte ? posCorte : ev.mesFinanceiro, ev.tipo, false, ev.valor)
    }
  }

  // 3. Séries com a teórica ao lado
  const teoricaPorMes = new Map(teorica.seriesMensal.map((s) => [s.mes, s]))
  const todosMeses = [...new Set([...meses.keys(), ...teoricaPorMes.keys()])].sort()
  const vazio = { compMat: 0, compMo: 0, compFora: 0, finMat: 0, finMo: 0, finFora: 0 }
  let teoricoAteCorte = 0
  const seriesMensal = todosMeses.map((mes) => {
    const v = meses.get(mes) || vazio
    const t = teoricaPorMes.get(mes) || {}
    if (mes <= corte) teoricoAteCorte += t.competenciaMensal || 0
    return {
      mes,
      realizado: mes <= corte,
      competenciaMaterial: arredondar(v.compMat),
      competenciaMaoDeObra: arredondar(v.compMo),
      competenciaForaCronograma: arredondar(v.compFora),
      competenciaMensal: arredondar(v.compMat + v.compMo),
      financeiroMaterial: arredondar(v.finMat),
      financeiroMaoDeObra: arredondar(v.finMo),
      financeiroForaCronograma: arredondar(v.finFora),
      financeiroMensal: arredondar(v.finMat + v.finMo),
      teoricoCompetenciaMaterial: t.competenciaMaterial || 0,
      teoricoCompetenciaMaoDeObra: t.competenciaMaoDeObra || 0,
      teoricoFinanceiroMaterial: t.financeiroMaterial || 0,
      teoricoFinanceiroMaoDeObra: t.financeiroMaoDeObra || 0,
      teoricoEconomicoMensal: t.economicoMensal || 0,
    }
  })

  const soma = (k) => arredondar(resumo.reduce((s, r) => s + r[k], 0))
  const base = teorica.kpis.totalOrcado
  const desvio = arredondar(realizadoAteCorte - teoricoAteCorte)
  return {
    corte,
    seriesMensal,
    etapas: resumo,
    kpis: {
      base,
      realizadoAteCorte: arredondar(realizadoAteCorte),
      teoricoAteCorte: arredondar(teoricoAteCorte),
      desvio,
      desvioPct: base ? arredondar((desvio / base) * 100) : 0,
      saldoProjetado: soma('saldoProjetado'),
      excedente: soma('excedente'),
      pendente: soma('pendente'),
      foraDoCronograma: arredondar(foraDoCronograma),
      custoFinalEstimado: arredondar(base + soma('excedente') + foraDoCronograma),
      realizadoSemPagamento: arredondar(realizadoSemPagamento),
      inicioTeorico: teorica.kpis.inicioProjecao,
      dataLiberacaoRetencao,
    },
  }
}
