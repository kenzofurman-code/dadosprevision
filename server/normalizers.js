const NUMERIC_KEYS = new Set([
  'area', 'progresso_esperado', 'progresso_realizado', 'custo_orcado', 'custo_realizado',
  'atraso_dias', 'idp', 'dias_desde_inicio', 'dias_ate_fim', 'posicao_servico',
  'posicao_pavimento', 'duracao_dias', 'custo_vinculado', 'custo_linha_base',
  'ultima_medicao_base', 'ultima_medicao_esperado', 'ultima_medicao_realizado',
  'progresso_fisico_base', 'progresso_unidade_base', 'progresso_unidade_esperado',
  'progresso_unidade_realizado', 'quantidade_unidade', 'saldo_unidade',
  'ultima_medicao_progresso_unidade', 'parte', 'total_microservicos', 'progresso_base',
  'posicao', 'defasagem_dias', 'nivel', 'custo_mao_obra', 'custo_material', 'custo_total',
  'peso_base', 'peso_previsto', 'peso_realizado', 'peso_vinculado', 'porcentagem',
  'total_pesos_atividades', 'total_pesos_etapas', 'total_atividades', 'total_medicoes',
  'total_pavimentos', 'total_servicos', 'total_marcos', 'total_linhas_base',
  'total_responsaveis', 'total_restricoes', 'total_orcamentos', 'total_itens_cff',
  'total_pesos_orcamento', 'total_dashboards',
])

const DATE_KEYS = new Set([
  'data_inicio', 'data_fim', 'ultima_medicao', 'linha_base_inicio', 'linha_base_fim',
  'primeira_medicao_em', 'ultima_medicao_em', 'ultima_medicao_data', 'data_referencia',
  'data_referencia_unidade', 'data_real_inicio', 'data_real_fim', 'data_medicao', 'data',
  'data_inicio_obra', 'data_fim_obra',
])

const TIMESTAMP_KEYS = new Set(['criado_em', 'excluido_em', 'vencimento_em', 'concluido_em'])

function clean(value) {
  const result = JSON.parse(JSON.stringify(value ?? {}))
  if (!result || Array.isArray(result) || typeof result !== 'object') return result
  for (const [field, fieldValue] of Object.entries(result)) {
    if (NUMERIC_KEYS.has(field)) result[field] = numberOrNull(fieldValue)
    else if (DATE_KEYS.has(field)) result[field] = dateOrNull(fieldValue)
    else if (TIMESTAMP_KEYS.has(field)) result[field] = timestampOrNull(fieldValue)
  }
  return result
}

export function numberOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function dateOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

export function timestampOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function projectReference(project, projectName) {
  return { projeto_id: String(project.id), projeto_nome: projectName }
}

function normalizeProgress(value) {
  const number = numberOrNull(value)
  if (number == null) return null
  return number > 1 ? number / 100 : number
}

export function normalizeProject(project, data, counts) {
  const summary = data.summary || {}
  return clean({
    id_prevision: String(project.id),
    nome_projeto: data.name || project.name || '-',
    empresa_nome: '-',
    endereco: data.address || null,
    area: data.area == null ? null : Number(data.area),
    tipologia: data.typology || null,
    fase: data.phase || null,
    tipo_entrega: data.deliveryType || null,
    tipo_cronograma: data.scheduleType || null,
    imagem_url: data.pictureUrl || null,
    secao_id: data.projectSection?.id || null,
    secao_nome: data.projectSection?.name || null,
    criado_em: data.createdAt || null,
    data_inicio: summary.startAt || null,
    data_fim: summary.endAt || data.finishProjectDate || data.activeBaselineEndDate || null,
    ultima_medicao: summary.lastMeasurement || null,
    progresso_esperado: summary.expected ?? null,
    progresso_realizado: summary.realized ?? null,
    custo_orcado: summary.cost ?? null,
    custo_realizado: summary.realizedCost ?? null,
    atraso_dias: summary.delay ?? null,
    idp: summary.idp ?? null,
    dias_desde_inicio: summary.daysSinceStart ?? null,
    dias_ate_fim: summary.daysToEnd ?? null,
    status_dashboard: data.dashboardStatus?.status || null,
    status: data.updateProcessStatus || project.updateProcessStatus || 'unknown',
    desativado: Boolean(data.archivedAt || project.archivedAt),
    total_atividades: counts.activities,
    total_medicoes: counts.measurements,
    total_microservicos: counts.microservices,
    total_pavimentos: counts.floors,
    total_servicos: counts.services,
    total_marcos: counts.milestones,
    total_linhas_base: counts.baselines,
    total_responsaveis: counts.responsibles,
    total_restricoes: counts.restrictions,
    total_orcamentos: counts.budgets,
    total_itens_cff: counts.budgetItems,
    total_pesos_orcamento: counts.budgetWeights,
    total_dashboards: counts.dashboards,
  })
}

export function buildActivityContext(projectData) {
  const baselineByActivityId = new Map()
  for (const step of projectData.baselineSteps) {
    for (const activity of step.activities || []) baselineByActivityId.set(String(activity.id), step)
  }
  return {
    baselineByActivityId,
    scheduleById: new Map(projectData.scheduleActivities.map((item) => [String(item.id), item])),
    criticalActivityIds: new Set(projectData.details.criticalPath || []),
    referenceDate: projectData.details.summary?.lastMeasurement || null,
  }
}

export function normalizeActivity(item, project, projectName, context) {
  const report = context.scheduleById.get(String(item.id)) || {}
  const baseline = context.baselineByActivityId.get(String(item.id)) || {}
  const measurements = [...(item.measuresPage?.nodes || [])].sort((a, b) =>
    String(a.measuredIn || '').localeCompare(String(b.measuredIn || '')),
  )
  const firstMeasurement = measurements[0]
  const lastMeasurement = measurements.at(-1)
  const microservices = (item.jobs || []).map((job) => ({
    id_prevision: String(job.id),
    nome: job.name || '-',
    codigo_eap: job.wbsCode || null,
    progresso_realizado: normalizeProgress(job.percentageCompleted),
    progresso_esperado: normalizeProgress(job.expectedPercentageCompleted),
    data_inicio: job.startAt || null,
    data_fim: job.endAt || null,
    duracao_dias: job.duration ?? null,
  }))
  return clean({
    ...projectReference(project, projectName),
    id_prevision: String(item.id),
    codigo_eap: item.wbsCode || null,
    posicao_servico: report.service_position ?? item.service?.position ?? null,
    pavimento_id: item.floor?.id || null,
    pavimento_nome: report.floor || item.floor?.name || null,
    grupo_repeticao: report.replication_group || item.floor?.replicationGroupName || null,
    servico_id: item.service?.id || null,
    servico_nome: report.service || item.service?.name || null,
    posicao_pavimento: report.floor_position ?? item.floor?.position ?? null,
    contador_parte: report.part_counter || (item.part ? String(item.part) : null),
    nivel_atividade: report.activity_level || null,
    categorizacao: report.categorization || null,
    caminho_critico: report.critical_path || (context.criticalActivityIds.has(Number(item.id)) ? 'Sim' : 'Nao'),
    linha_base_inicio: report.baseline_step_start || baseline.startAt || null,
    linha_base_fim: report.baseline_step_end || baseline.endAt || null,
    data_inicio: report.start_date || item.startAt || null,
    data_fim: report.end_date || item.endAt || null,
    duracao_dias: report.duration ?? item.workDuration ?? null,
    recursos_materiais: report.material_resources || null,
    responsavel: report.responsible || null,
    custo_vinculado: report.linked_cost ?? item.budgetCost ?? null,
    custo_linha_base: report.baseline_linked_cost ?? baseline.budgetCost ?? null,
    primeira_medicao_em: report.first_measured_in || firstMeasurement?.measuredIn || null,
    ultima_medicao_em: report.last_measured_in || lastMeasurement?.measuredIn || null,
    predecessoras: report.predecessors || (item.predecessorsPage?.nodes || []).map((d) => d.predecessor?.wbsCode || d.predecessor?.id).filter(Boolean).join(', ') || null,
    sucessoras: report.successors || (item.successorsPage?.nodes || []).map((d) => d.successor?.wbsCode || d.successor?.id).filter(Boolean).join(', ') || null,
    ultima_medicao_data: report.last_measurement_date || lastMeasurement?.measuredIn || null,
    ultima_medicao_base: report.last_measurement_base ?? lastMeasurement?.progress?.base ?? lastMeasurement?.basePercentageCompleted ?? null,
    ultima_medicao_esperado: normalizeProgress(report.last_measurement_expected ?? lastMeasurement?.progress?.expected ?? lastMeasurement?.expectedPercentageCompleted),
    ultima_medicao_realizado: normalizeProgress(report.last_measurement_realized ?? lastMeasurement?.progress?.realized ?? lastMeasurement?.percentageCompleted),
    data_referencia: report.reference_date || context.referenceDate || null,
    progresso_fisico_base: normalizeProgress(report.physical_progress_percentage_base ?? lastMeasurement?.progress?.base),
    progresso_esperado: normalizeProgress(report.physical_progress_percentage_expected ?? item.expectedPercentageCompleted),
    progresso_realizado: normalizeProgress(report.physical_progress_percentage_realized ?? item.percentageCompleted),
    data_referencia_unidade: report.unit_reference_date || null,
    unidade_nome: item.measurementUnit?.name || null,
    unidade_simbolo: report.unit || item.measurementUnit?.symbol || null,
    progresso_unidade_base: report.physical_progress_unit_base ?? null,
    progresso_unidade_esperado: report.physical_progress_unit_expected ?? null,
    progresso_unidade_realizado: report.physical_progress_unit_realized ?? null,
    progresso_unidade_descricao: report.physical_progress_unit_realized_description || null,
    quantidade_unidade: report.physical_progress_unit_amount ?? null,
    saldo_unidade: report.physical_progress_unit_remainder ?? null,
    ultima_medicao_progresso_unidade: report.last_measurement_unit_progress ?? null,
    data_real_inicio: report.real_date_start_at || null,
    data_real_fim: report.real_date_end_at || null,
    duracao_real: report.real_date_duration || null,
    motivos_atraso: report.delay_reasons || null,
    parte: item.part ?? null,
    possui_etapas: Boolean(item.hasJobs),
    total_microservicos: microservices.length,
    microservicos_nomes: microservices.map((job) => job.nome).join(', ') || null,
    microservicos: microservices,
    excluido_em: item.deletedAt || null,
  })
}

export function normalizeMeasurement(measure, activity, project, projectName) {
  return clean({
    ...projectReference(project, projectName),
    id_prevision: String(measure.id),
    atividade_id: String(activity.id),
    codigo_eap: activity.wbsCode || null,
    atividade_nome: activity.name || null,
    servico_id: activity.service?.id ? String(activity.service.id) : null,
    servico_nome: activity.service?.name || null,
    pavimento_id: activity.floor?.id ? String(activity.floor.id) : null,
    pavimento_nome: activity.floor?.name || null,
    unidade_simbolo: activity.measurementUnit?.symbol || activity.measurementUnit?.name || null,
    data_medicao: measure.measuredIn || null,
    progresso_base: normalizeProgress(measure.progress?.base ?? measure.basePercentageCompleted),
    progresso_esperado: normalizeProgress(measure.progress?.expected ?? measure.expectedPercentageCompleted),
    progresso_realizado: normalizeProgress(measure.progress?.realized ?? measure.percentageCompleted),
    motivos_atraso: Array.isArray(measure.delayReasons) ? measure.delayReasons.join(', ') : measure.delayReasons || null,
    observacoes: Array.isArray(measure.notes) ? measure.notes.join(', ') : measure.notes || null,
  })
}

export function normalizeFloor(item, project, projectName) {
  return clean({ ...projectReference(project, projectName), id_prevision: String(item.id), nome: item.name, posicao: item.position, area: item.area ?? null, tag: item.tag || null, grupo_repeticao: item.replicationGroupName || null, data_inicio: item.startAt || null, data_fim: item.endAt || null, excluido_em: item.deletedAt || null })
}

export function normalizeService(item, project, projectName) {
  return clean({ ...projectReference(project, projectName), id_prevision: String(item.id), nome: item.name, posicao: item.position, cor: item.color || null, unidade: item.unit || null, data_inicio: item.startAt || null, data_fim: item.endAt || null, possui_atividades: Boolean(item.hasActivities), possui_etapas: Boolean(item.hasJobs) })
}

export function normalizeMilestone(item, project, projectName) {
  return clean({ ...projectReference(project, projectName), id_prevision: String(item.id), nome: item.name, data: item.date, cor: item.color || null, atributo_base: item.baseAttribute || null, defasagem_dias: item.lag ?? null, operacao_tempo: item.timeOperation || null, visivel_na_obra: Boolean(item.visibleInConstruction), origem_incorporacao: Boolean(item.isFromIncorporation), atividade_id: item.activity?.id || null })
}

export function normalizeBaseline(item, project, projectName) {
  return clean({ ...projectReference(project, projectName), id_prevision: String(item.id), ativa: Boolean(item.active), criado_em: item.createdAt || null, versao_lob_id: item.lobVersionId || null })
}

export function normalizeResponsible(item, project, projectName) {
  return clean({ ...projectReference(project, projectName), id_prevision: String(item.id), nome: item.name })
}

export function normalizeRestriction(task) {
  const checklist = task.taskChecklists || []
  return clean({
    projeto_id: String(task.project.id), projeto_nome: task.project.name || '-', id_prevision: String(task.id),
    titulo: task.title || '-', descricao: task.description || null, criado_em: task.createdAt || null,
    vencimento_em: task.dueAt || null, concluido_em: task.doneAt || null, atraso_dias: task.delay ?? null,
    atributo_base: task.baseAttribute || null, operacao_tempo: task.timeOperation || null,
    etapa_id: task.kanbanStep?.id || null, etapa_nome: task.kanbanStep?.name || null, etapa_fase: task.kanbanStep?.phase || null, etapa_posicao: task.kanbanStep?.position ?? null,
    atividade_id: task.activity?.id || null, codigo_eap: task.activity?.wbsCode || null,
    pavimento_id: task.activity?.floor?.id || null, pavimento_nome: task.activity?.floor?.name || null,
    servico_id: task.activity?.service?.id || null, servico_nome: task.activity?.service?.name || null,
    etiquetas: (task.labels || []).map((label) => ({ id: String(label.id), nome: label.name, cor: label.color })),
    etiquetas_nomes: (task.labels || []).map((label) => label.name).join(', ') || null,
    usuarios: (task.users || []).map((user) => ({ id: String(user.id), nome: user.profile?.name || user.profile?.email || '-', email: user.profile?.email || null, departamento: user.profile?.department || null, cargo: user.profile?.job || null })),
    usuarios_nomes: (task.users || []).map((user) => user.profile?.name || user.profile?.email).filter(Boolean).join(', ') || null,
    checklist_total: checklist.length, checklist_concluido: checklist.filter((item) => item.status).length,
  })
}

function pointSeries(points, length = 0) {
  const values = Array.isArray(points) ? points : []
  return Array.from({ length: Math.max(length, values.length) }, (_, index) => ({ x: values[index]?.x || null, y: Number(values[index]?.y) || 0 }))
}

function sumPoints(points) {
  return points.reduce((total, point) => total + (Number(point.y) || 0), 0)
}

function joinUnique(values) {
  const value = [...new Set(values.filter(Boolean))].join(', ')
  return value.length > 2000 ? `${value.slice(0, 1997)}...` : value || null
}

function cffSummary(report, reference) {
  const dates = (report.data?.dates || []).map(String)
  const levels = new Map([['all', dates.map((data) => ({ data, base: 0, previsto: 0, realizado: 0 }))]])
  for (const row of report.data?.rows || []) {
    const level = String((row.budgetItem || row.budget_item || {}).level ?? '0')
    if (!levels.has(level)) levels.set(level, dates.map((data) => ({ data, base: 0, previsto: 0, realizado: 0 })))
    const series = [pointSeries(row.basePoints || row.base_points, dates.length), pointSeries(row.expectedPoints || row.expected_points, dates.length), pointSeries(row.realizedPoints || row.realized_points, dates.length)]
    for (const target of [levels.get('all'), levels.get(level)]) {
      dates.forEach((_date, index) => { target[index].base += series[0][index].y; target[index].previsto += series[1][index].y; target[index].realizado += series[2][index].y })
    }
  }
  return { ...reference, orcamento_id: String(report.budgetId), orcamento_nome: report.name || `Orcamento ${report.budgetId}`, datas: dates, niveis: [...levels].map(([nivel, meses]) => ({ nivel, meses })) }
}

function weeklyCurve(curve, reference, perspective) {
  if (!Array.isArray(curve?.dates)) return []
  const weeks = new Map()
  curve.dates.forEach((data, index) => {
    const date = new Date(data)
    if (Number.isNaN(date.getTime())) return
    const end = new Date(date)
    end.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7))
    const start = new Date(end)
    start.setUTCDate(end.getUTCDate() - 6)
    weeks.set(end.toISOString().slice(0, 10), {
      semana_inicio: start.toISOString().slice(0, 10),
      semana_fim: end.toISOString().slice(0, 10),
      base: Number(curve.base?.[index]) || 0,
      expected: Number(curve.expected?.[index]) || 0,
      realized: Number(curve.realized?.[index]) || 0,
    })
  })
  let previous = { base: 0, expected: 0, realized: 0 }
  return [...weeks.values()]
    .sort((left, right) => left.semana_fim.localeCompare(right.semana_fim))
    .map((current, index) => {
      const result = { ...reference, perspectiva: perspective, semana_indice: index + 1, semana_inicio: current.semana_inicio, semana_fim: current.semana_fim, data: current.semana_fim, base_semana: Math.max(0, current.base - previous.base), previsto_semana: Math.max(0, current.expected - previous.expected), realizado_semana: Math.max(0, current.realized - previous.realized), curva_base: current.base, curva_prevista: current.expected, curva_realizada: current.realized }
      previous = current
      return result
    })
}

export function normalizeAnalytics(project, data) {
  const reference = projectReference(project, project.name || '-')
  const released = new Set((data.contractWhitelistedBudgetReports || []).map((item) => String(item.id)))
  const orcamentos = (data.budgetReports || []).map((item) => ({ ...reference, id_prevision: String(item.id), nome: item.name || '-', custo_total: item.totalCost ?? null, custo_fisico: item.totalPhysicalCost ?? null, custo_pesos: item.weightsCost ?? null, pesos_validos: Boolean(item.validBudgetWeights), origem_erp: Boolean(item.isSourceFromErp), status_integracao: item.integrationStatus || null, ultima_integracao: item.lastIntegrationDate || null, liberado_contrato: released.has(String(item.id)), dashboard_id: item.dashboardWeight?.id || null, perspectiva: item.dashboardWeight?.perspective || null, padrao: Boolean(item.dashboardWeight?.primary) }))
  const budgetItems = []
  const budgetWeights = []
  for (const report of data.cffReports || []) {
    const dates = (report.data?.dates || []).map(String)
    for (const [rowIndex, row] of (report.data?.rows || []).entries()) {
      const item = row.budgetItem || row.budget_item || {}
      const itemId = String(item.id || `${report.budgetId}_${row.code || item.code || rowIndex}`)
      const weights = item.budgetWeights || row.activity_weights || []
      const base = pointSeries(row.basePoints || row.base_points, dates.length)
      const expected = pointSeries(row.expectedPoints || row.expected_points, dates.length)
      const realized = pointSeries(row.realizedPoints || row.realized_points, dates.length)
      const lastRealizedPoint = realized.filter((point) => point.y > 0).at(-1) || realized.at(-1) || null
      let accBase = 0; let accExpected = 0; let accRealized = 0
      const pontos_mensais = dates.map((date, index) => { accBase += base[index].y; accExpected += expected[index].y; accRealized += realized[index].y; return { data: date, base: base[index].y, previsto: expected[index].y, realizado: realized[index].y, base_acumulada: accBase, previsto_acumulado: accExpected, realizado_acumulado: accRealized } })
      budgetItems.push({ ...reference, orcamento_id: String(report.budgetId), orcamento_nome: report.name || `Orcamento ${report.budgetId}`, id_prevision: itemId, codigo: row.code || item.code || null, descricao: item.description || '-', nivel: item.level ?? null, tipo_grupo: item.groupType || item.group_type || null, data_inicio_obra: data.projectSummary?.startAt || null, data_fim_obra: data.projectSummary?.endAt || project.finishProjectDate || project.activeBaselineEndDate || null, data_inicio: row.startAt || row.start_at || null, data_fim: row.endAt || row.end_at || null, custo_mao_obra: item.laborCost ?? item.labor_cost ?? null, custo_material: item.materialCost ?? item.material_cost ?? null, custo_total: item.totalCost ?? item.total ?? item.total_cost ?? (Number(item.laborCost ?? item.labor_cost) || 0) + (Number(item.materialCost ?? item.material_cost) || 0), ignorado_erp: Boolean(item.ignoredOnErp ?? item.ignored_on_erp), peso_base: sumPoints(base), peso_previsto: sumPoints(expected), peso_realizado: sumPoints(realized), peso_vinculado: weights.reduce((total, weight) => total + (Number(weight.percentage) || 0), 0), total_pesos_atividades: weights.length, total_pesos_etapas: weights.flatMap((weight) => weight.jobBudgetWeights || []).length, atividades: joinUnique(weights.map((weight) => String(weight.activity?.id || ''))), servicos: joinUnique(weights.map((weight) => weight.activity?.service?.name)), lotes: joinUnique(weights.map((weight) => weight.activity?.floor?.name)), etapas: joinUnique(weights.flatMap((weight) => weight.jobBudgetWeights || []).map((weight) => weight.job?.name)), ultima_competencia_realizada: lastRealizedPoint?.x || null, ultimo_realizado: lastRealizedPoint?.y ?? null, pontos_mensais })
      weights.forEach((weight, weightIndex) => {
        const microservices = (weight.jobBudgetWeights || []).map((job) => ({ id_microservico: job.job?.id ? String(job.job.id) : null, nome: job.job?.name || '-', parte: job.job?.part ? String(job.job.part) : null, porcentagem: Number(job.percentage) || 0 }))
        budgetWeights.push({ ...reference, orcamento_id: String(report.budgetId), orcamento_nome: report.name || `Orcamento ${report.budgetId}`, id_prevision: String(weight.id || `${report.budgetId}_${itemId}_${weightIndex}_${weight.activity?.id || 'sem-atividade'}`), id_item_orcamento: itemId, codigo: row.code || item.code || null, descricao: item.description || '-', nivel: item.level ?? null, tipo_grupo: item.groupType || item.group_type || null, custo_material: item.materialCost ?? item.material_cost ?? null, custo_mao_obra: item.laborCost ?? item.labor_cost ?? null, custo_total: item.totalCost ?? item.total ?? item.total_cost ?? null, porcentagem: Number(weight.percentage) || 0, id_atividade: weight.activity?.id ? String(weight.activity.id) : null, servico_nome: weight.activity?.service?.name || '-', pavimento_nome: weight.activity?.floor?.name || '-', total_microservicos: microservices.length, microservicos: microservices, microservicos_resumo: microservices.map((job) => `${job.nome}${job.porcentagem ? ` (${(job.porcentagem * 100).toFixed(1)}%)` : ''}`).join('; ') || '-' })
      })
    }
  }
  const dashboard_geral = []; const dashboard_semanal = []; const dashboard_mensal = []; const dashboard_servicos = []; const dashboard_lotes = []
  for (const dashboard of data.dashboards || []) {
    const perspective = dashboard.perspective
    const details = dashboard.data.detailedDashboard || {}
    const info = details.generalInfo || {}
    dashboard_geral.push({ ...reference, perspectiva: perspective, custo: info.cost ?? null, custo_realizado: info.realized_cost ?? null, data_inicio: info.start_at || null, data_fim: info.end_at || null, ultima_medicao: info.last_measurement || null, progresso_previsto: info.expected ?? null, progresso_realizado: info.realized ?? null, atraso_dias: info.delay ?? null, idp: info.idp ?? null, dias_desde_inicio: info.days_since_start ?? null, dias_ate_fim: info.days_to_end ?? null })
    let base = 0; let expected = 0; let realized = 0
    const monthly = details.monthlyProgress || {}
    ;(monthly.dates || []).forEach((date, index) => { const b = Number(monthly.base?.[index]) || 0; const e = Number(monthly.expected?.[index]) || 0; const r = Number(monthly.realized?.[index]) || 0; base += b; expected += e; realized += r; dashboard_mensal.push({ ...reference, perspectiva: perspective, data: date, base_mes: b, previsto_mes: e, realizado_mes: r, curva_base: base, curva_prevista: expected, curva_realizada: realized }) })
    dashboard_semanal.push(...weeklyCurve(details.sCurve || dashboard.data.sCurve, reference, perspective))
    const evolution = (item) => ({ ...reference, perspectiva: perspective, id_prevision: String(item.service_id || item.floor_id), nome: item.name, cor: item.color || null, grupo_repeticao: item.replication_group || null, posicao: item.position ?? null, data_base_inicio: item.base_start_at || null, data_base_fim: item.base_end_at || null, data_prevista_inicio: item.expected_start_at || null, data_prevista_fim: item.expected_end_at || null, duracao_base: item.base_duration ?? null, duracao_prevista: item.expected_duration ?? null, base: item.base ?? null, previsto: item.expected ?? null, realizado: item.realized ?? null, atraso_dias: item.delay ?? null, delta: item.delta ?? null, idp: item.idp ?? null, custo_base: item.base_cost ?? null, custo_total: item.total_cost ?? null })
    dashboard_servicos.push(...(dashboard.data.workPackageEvolution || []).map(evolution))
    dashboard_lotes.push(...(dashboard.data.floorEvolution || []).map(evolution))
  }
  const analyticsDoc = clean({ ...reference, orcamentos, cff_resumo: (data.cffReports || []).map((report) => cffSummary(report, reference)), dashboard_estados: (data.dashboardWeights || []).map((item) => ({ ...reference, id_prevision: String(item.id), nome: item.name || null, categoria: item.category || null, perspectiva: item.perspective || null, padrao: Boolean(item.primary), possui_orcamento: Boolean(item.hasBudgetLink), status: item.dashboardStatus?.status || null, atualizado_em: item.dashboardStatus?.updatedAt || null })), dashboard_geral, dashboard_semanal, dashboard_mensal, dashboard_servicos, dashboard_lotes })
  return { analyticsDoc, budgetItems: budgetItems.map(clean), budgetWeights: budgetWeights.map(clean) }
}
