import { isDeepStrictEqual } from 'node:util'
import { getDb } from '../lib/firebase-admin.js'
import { clearFirestoreCache } from '../lib/firestore-reader.js'
import {
  fetchAllProjectIds,
  fetchAnalyticsData,
  fetchKanbanData,
  fetchProjectData,
  sanitizePrevisionApiKey,
  sanitizeRestToken,
} from '../lib/prevision-client.js'

const COLLECTIONS = {
  activities: 'prevision_atividades',
  measurements: 'prevision_medicoes',
  floors: 'prevision_pavimentos',
  services: 'prevision_servicos',
  milestones: 'prevision_marcos',
  baselines: 'prevision_linhas_base',
  responsibles: 'prevision_responsaveis',
}

function clean(value) {
  return JSON.parse(JSON.stringify(value))
}

function projectReference(project, projectName) {
  return {
    projeto_id: String(project.id),
    projeto_nome: projectName,
  }
}

function normalizeProject(project, data, counts) {
  const summary = data.summary || {}

  return clean({
    id_prevision: String(project.id),
    nome_projeto: data.name || project.name || '-',
    empresa_nome: '-',
    endereco: data.address || null,
    area: data.area ? Number(data.area) : null,
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
    total_medicoes: counts.measurements ?? 0,
    total_microservicos: counts.microservices ?? 0,
    total_pavimentos: counts.floors,
    total_servicos: counts.services,
    total_marcos: counts.milestones,
    total_linhas_base: counts.baselines,
    total_responsaveis: counts.responsibles,
    total_restricoes: counts.restrictions ?? 0,
    atualizado_em: new Date().toISOString(),
  })
}

function normalizeProgress(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return number > 1 ? number / 100 : number
}

function normalizeActivity(item, project, projectName, context) {
  const report = context.scheduleById.get(String(item.id)) || {}
  const baseline = context.baselineByActivityId.get(String(item.id)) || {}
  const measurements = [...(item.measuresPage?.nodes || [])].sort((first, second) =>
    String(first.measuredIn || '').localeCompare(String(second.measuredIn || '')),
  )
  const firstMeasurement = measurements[0]
  const lastMeasurement = measurements.at(-1)
  const predecessors = item.predecessorsPage?.nodes || []
  const successors = item.successorsPage?.nodes || []
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
    contador_parte: report.part_counter || (item.part ? String(item.part) : null),
    nivel_atividade: report.activity_level || null,
    categorizacao: report.categorization || null,
    caminho_critico:
      report.critical_path ||
      (context.criticalActivityIds.has(Number(item.id)) ? 'Sim' : 'Não'),
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
    predecessoras:
      report.predecessors ||
      predecessors
        .map((dependency) => dependency.predecessor?.wbsCode || dependency.predecessor?.id)
        .join(', ') ||
      null,
    sucessoras:
      report.successors ||
      successors
        .map((dependency) => dependency.successor?.wbsCode || dependency.successor?.id)
        .join(', ') ||
      null,
    ultima_medicao_data: report.last_measurement_date || lastMeasurement?.measuredIn || null,
    ultima_medicao_base:
      report.last_measurement_base ??
      lastMeasurement?.progress?.base ??
      lastMeasurement?.basePercentageCompleted ??
      null,
    ultima_medicao_esperado: normalizeProgress(
      report.last_measurement_expected ??
        lastMeasurement?.progress?.expected ??
        lastMeasurement?.expectedPercentageCompleted,
    ),
    ultima_medicao_realizado: normalizeProgress(
      report.last_measurement_realized ??
        lastMeasurement?.progress?.realized ??
        lastMeasurement?.percentageCompleted,
    ),
    data_referencia: report.reference_date || context.referenceDate || null,
    progresso_fisico_base: normalizeProgress(
      report.physical_progress_percentage_base ?? lastMeasurement?.progress?.base,
    ),
    progresso_esperado: normalizeProgress(
      report.physical_progress_percentage_expected ?? item.expectedPercentageCompleted,
    ),
    progresso_realizado: normalizeProgress(
      report.physical_progress_percentage_realized ?? item.percentageCompleted,
    ),
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
    custo_orcado: report.linked_cost ?? item.budgetCost ?? null,
    parte: item.part ?? null,
    possui_etapas: Boolean(item.hasJobs),
    total_microservicos: microservices.length,
    microservicos_nomes: microservices.map((job) => job.nome).join(', ') || null,
    microservicos: microservices,
    excluido_em: item.deletedAt || null,
  })
}

function normalizeMeasurement(measure, activity, project, projectName) {
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
    progresso_esperado: normalizeProgress(
      measure.progress?.expected ?? measure.expectedPercentageCompleted,
    ),
    progresso_realizado: normalizeProgress(
      measure.progress?.realized ?? measure.percentageCompleted,
    ),
    motivos_atraso: Array.isArray(measure.delayReasons)
      ? measure.delayReasons.join(', ')
      : measure.delayReasons || null,
    observacoes: Array.isArray(measure.notes)
      ? measure.notes.join(', ')
      : measure.notes || null,
  })
}

function normalizeFloor(item, project, projectName) {
  return clean({
    ...projectReference(project, projectName),
    id_prevision: String(item.id),
    nome: item.name,
    posicao: item.position,
    area: item.area ?? null,
    tag: item.tag || null,
    grupo_repeticao: item.replicationGroupName || null,
    data_inicio: item.startAt || null,
    data_fim: item.endAt || null,
    excluido_em: item.deletedAt || null,
  })
}

function normalizeService(item, project, projectName) {
  return clean({
    ...projectReference(project, projectName),
    id_prevision: String(item.id),
    nome: item.name,
    posicao: item.position,
    cor: item.color || null,
    unidade: item.unit || null,
    data_inicio: item.startAt || null,
    data_fim: item.endAt || null,
    possui_atividades: Boolean(item.hasActivities),
    possui_etapas: Boolean(item.hasJobs),
  })
}

function normalizeMilestone(item, project, projectName) {
  return clean({
    ...projectReference(project, projectName),
    id_prevision: String(item.id),
    nome: item.name,
    data: item.date,
    cor: item.color || null,
    atributo_base: item.baseAttribute || null,
    defasagem_dias: item.lag ?? null,
    operacao_tempo: item.timeOperation || null,
    visivel_na_obra: Boolean(item.visibleInConstruction),
    origem_incorporacao: Boolean(item.isFromIncorporation),
    atividade_id: item.activity?.id || null,
  })
}

function normalizeBaseline(item, project, projectName) {
  return clean({
    ...projectReference(project, projectName),
    id_prevision: String(item.id),
    nome: item.lobVersion?.name || item.name || null,
    descricao: item.lobVersion?.description || item.description || null,
    ativa: Boolean(item.active),
    criado_em: item.createdAt,
    restaurada_em: item.lobVersion?.restoredAt || null,
    versao_lob_id: item.lobVersionId || item.lobVersion?.id || null,
    origem_versao: item.lobVersion?.source || null,
  })
}

function normalizeResponsible(item, project, projectName) {
  return clean({
    ...projectReference(project, projectName),
    id_prevision: String(item.id),
    nome: item.name,
  })
}

function normalizeRestriction(task) {
  const checklist = task.taskChecklists || []
  const checklistItems = checklist
    .map((item) => ({
      id_prevision: String(item.id),
      descricao: item.description || '-',
      status: Boolean(item.status),
      vencimento_em: item.dueAt || null,
      concluido_em: item.doneAt || null,
      posicao: item.position ?? null,
      antecedencia_dias: item.time ?? null,
      responsavel_id: item.user?.id ? String(item.user.id) : null,
      responsavel_nome: item.user?.profile?.name || item.user?.profile?.email || null,
      responsavel_email: item.user?.profile?.email || null,
      responsavel_departamento: item.user?.profile?.department || null,
      responsavel_cargo: item.user?.profile?.job || null,
    }))
    .sort((left, right) => (left.posicao ?? Number.MAX_SAFE_INTEGER) - (right.posicao ?? Number.MAX_SAFE_INTEGER))

  return clean({
    projeto_id: String(task.project.id),
    projeto_nome: task.project.name || '-',
    id_prevision: String(task.id),
    titulo: task.title || '-',
    descricao: task.description || null,
    criado_em: task.createdAt || null,
    vencimento_em: task.dueAt || null,
    concluido_em: task.doneAt || null,
    atraso_dias: task.delay ?? null,
    atributo_base: task.baseAttribute || null,
    operacao_tempo: task.timeOperation || null,
    etapa_id: task.kanbanStep?.id || null,
    etapa_nome: task.kanbanStep?.name || null,
    etapa_fase: task.kanbanStep?.phase || null,
    etapa_posicao: task.kanbanStep?.position ?? null,
    atividade_id: task.activity?.id || null,
    codigo_eap: task.activity?.wbsCode || null,
    pavimento_id: task.activity?.floor?.id || null,
    pavimento_nome: task.activity?.floor?.name || null,
    servico_id: task.activity?.service?.id || null,
    servico_nome: task.activity?.service?.name || null,
    etiquetas: (task.labels || []).map((label) => ({
      id: String(label.id),
      nome: label.name,
      cor: label.color,
    })),
    etiquetas_nomes: (task.labels || []).map((label) => label.name).join(', ') || null,
    usuarios: (task.users || []).map((user) => ({
      id: String(user.id),
      nome: user.profile?.name || user.profile?.email || '-',
      email: user.profile?.email || null,
      departamento: user.profile?.department || null,
      cargo: user.profile?.job || null,
    })),
    usuarios_nomes:
      (task.users || [])
        .map((user) => user.profile?.name || user.profile?.email)
        .filter(Boolean)
        .join(', ') || null,
    checklist_total: checklistItems.length,
    checklist_concluido: checklistItems.filter((item) => item.status).length,
    checklist_pendente: checklistItems.filter((item) => !item.status).length,
    checklist_itens: checklistItems,
    checklist_texto: checklistItems
      .flatMap((item) => [item.descricao, item.responsavel_nome, item.responsavel_email])
      .filter(Boolean)
      .join(' '),
  })
}

function sumPoints(points) {
  if (Array.isArray(points)) {
    return points.reduce((total, point) => total + (Number(point?.y) || 0), 0)
  }
  return Object.values(points || {}).reduce((total, value) => total + (Number(value) || 0), 0)
}

function joinUnique(values, maxLength = 2000) {
  const joined = [...new Set(values.filter(Boolean))].join(', ')
  return joined.length > maxLength ? `${joined.slice(0, maxLength - 3)}...` : joined || null
}

function normalizeCffPointSeries(points, fallbackLength = 0) {
  const series = Array.isArray(points) ? points : []
  const length = Math.max(series.length, fallbackLength)
  return Array.from({ length }, (_, index) => ({
    x: series[index]?.x || null,
    y: Number(series[index]?.y) || 0,
  }))
}

function buildCffMonthlySummary(report, projectReferenceData) {
  const dates = Array.isArray(report.data?.dates) ? report.data.dates.map((date) => String(date)) : []
  const rows = Array.isArray(report.data?.rows) ? report.data.rows : []
  const summaries = new Map()

  function ensureLevel(levelKey) {
    if (!summaries.has(levelKey)) {
      summaries.set(
        levelKey,
        dates.map((date) => ({
          data: date || null,
          base: 0,
          previsto: 0,
          realizado: 0,
        })),
      )
    }
    return summaries.get(levelKey)
  }

  function addSeries(target, source, field) {
    source.forEach((point, index) => {
      if (!target[index]) return
      target[index][field] += Number(point?.y) || 0
    })
  }

  const overall = ensureLevel('all')

  for (const row of rows) {
    const item = row.budgetItem || row.budget_item || {}
    const levelKey = String(item.level ?? '0')
    const levelSeries = ensureLevel(levelKey)
    const basePoints = normalizeCffPointSeries(row.basePoints || row.base_points, dates.length)
    const expectedPoints = normalizeCffPointSeries(row.expectedPoints || row.expected_points, dates.length)
    const realizedPoints = normalizeCffPointSeries(row.realizedPoints || row.realized_points, dates.length)

    addSeries(overall, basePoints, 'base')
    addSeries(overall, expectedPoints, 'previsto')
    addSeries(overall, realizedPoints, 'realizado')
    addSeries(levelSeries, basePoints, 'base')
    addSeries(levelSeries, expectedPoints, 'previsto')
    addSeries(levelSeries, realizedPoints, 'realizado')
  }

  return {
    ...projectReferenceData,
    orcamento_id: report.budgetId,
    orcamento_nome: report.name || `Orçamento ${report.budgetId}`,
    datas: dates,
    niveis: [...summaries.entries()]
      .map(([nivel, meses]) => ({
        nivel,
        meses,
      }))
      .sort((left, right) => {
        if (left.nivel === 'all') return -1
        if (right.nivel === 'all') return 1
        return Number(left.nivel) - Number(right.nivel)
      }),
  }
}

function aggregateSCurveToWeekly(sCurveData, projectReferenceData, perspective) {
  if (!sCurveData || !Array.isArray(sCurveData.dates) || sCurveData.dates.length === 0) return []
  const { dates, base = [], expected = [], realized = [] } = sCurveData

  const weeklyMap = new Map()

  for (let i = 0; i < dates.length; i += 1) {
    const dateStr = dates[i]
    const dateObj = new Date(dateStr)
    if (Number.isNaN(dateObj.getTime())) continue
    const dayOfWeek = dateObj.getUTCDay()
    const daysToSunday = (7 - dayOfWeek) % 7
    const endOfWeek = new Date(dateObj)
    endOfWeek.setUTCDate(dateObj.getUTCDate() + daysToSunday)
    const weekEndStr = endOfWeek.toISOString().slice(0, 10)

    const startOfWeek = new Date(endOfWeek)
    startOfWeek.setUTCDate(endOfWeek.getUTCDate() - 6)
    const weekStartStr = startOfWeek.toISOString().slice(0, 10)

    weeklyMap.set(weekEndStr, {
      semana_inicio: weekStartStr,
      semana_fim: weekEndStr,
      base: Number(base[i]) || 0,
      expected: Number(expected[i]) || 0,
      realized: Number(realized[i]) || 0,
    })
  }

  const weeklyEntries = [...weeklyMap.values()].sort((left, right) =>
    left.semana_fim.localeCompare(right.semana_fim),
  )

  let prevBase = 0
  let prevExpected = 0
  let prevRealized = 0

  return weeklyEntries.map((week, idx) => {
    const basePeriod = Math.max(0, week.base - prevBase)
    const expectedPeriod = Math.max(0, week.expected - prevExpected)
    const realizedPeriod = Math.max(0, week.realized - prevRealized)

    prevBase = week.base
    prevExpected = week.expected
    prevRealized = week.realized

    return {
      ...projectReferenceData,
      perspectiva: perspective,
      semana_indice: idx + 1,
      semana_inicio: week.semana_inicio,
      semana_fim: week.semana_fim,
      data: week.semana_fim,
      base_semana: basePeriod,
      previsto_semana: expectedPeriod,
      realizado_semana: realizedPeriod,
      curva_base: week.base,
      curva_prevista: week.expected,
      curva_realizada: week.realized,
    }
  })
}

function normalizeAnalytics(project, data) {
  const projectReferenceData = {
    projeto_id: String(project.id),
    projeto_nome: project.name || '-',
  }
  const projectSummary = data.projectSummary || {}
  const releasedBudgetIds = new Set(
    data.contractWhitelistedBudgetReports.map((budget) => String(budget.id)),
  )
  const budgets = data.budgetReports.map((budget) => ({
    ...projectReferenceData,
    id_prevision: String(budget.id),
    nome: budget.name || '-',
    custo_total: budget.totalCost ?? null,
    custo_fisico: budget.totalPhysicalCost ?? null,
    custo_pesos: budget.weightsCost ?? null,
    pesos_validos: Boolean(budget.validBudgetWeights),
    origem_erp: Boolean(budget.isSourceFromErp),
    status_integracao: budget.integrationStatus || null,
    ultima_integracao: budget.lastIntegrationDate || null,
    liberado_contrato: releasedBudgetIds.has(String(budget.id)),
    dashboard_id: budget.dashboardWeight?.id || null,
    perspectiva: budget.dashboardWeight?.perspective || null,
    padrao: Boolean(budget.dashboardWeight?.primary),
  }))
  const budgetItems = data.cffReports.flatMap((report) => {
    const dates = Array.isArray(report.data?.dates) ? report.data.dates.map(String) : []
    return (report.data?.rows || []).map((row) => {
      const item = row.budgetItem || row.budget_item || {}
      const weights = item.budgetWeights || row.activity_weights || []
      const jobWeights = weights.flatMap((weight) => weight.jobBudgetWeights || [])
      const basePoints = normalizeCffPointSeries(row.basePoints || row.base_points, dates.length)
      const expectedPoints = normalizeCffPointSeries(row.expectedPoints || row.expected_points, dates.length)
      const realizedPoints = normalizeCffPointSeries(row.realizedPoints || row.realized_points, dates.length)

      let cumBase = 0
      let cumPrevisto = 0
      let cumRealizado = 0
      const pontosMensais = dates.map((date, idx) => {
        const b = Number(basePoints[idx]?.y) || 0
        const p = Number(expectedPoints[idx]?.y) || 0
        const r = Number(realizedPoints[idx]?.y) || 0
        cumBase += b
        cumPrevisto += p
        cumRealizado += r
        return {
          data: date,
          base: b,
          previsto: p,
          realizado: r,
          base_acumulada: cumBase,
          previsto_acumulado: cumPrevisto,
          realizado_acumulado: cumRealizado,
        }
      })

      const lastRealizedPoint =
        realizedPoints.filter((pt) => Number(pt.y) > 0).at(-1) || realizedPoints.at(-1) || null
      const uniqueId = String(item.id || `${report.budgetId}_${row.code || item.code || Math.random()}`)

      return {
        ...projectReferenceData,
        orcamento_id: String(report.budgetId),
        orcamento_nome: report.name || `Orçamento ${report.budgetId}`,
        id_prevision: uniqueId,
        codigo: row.code || item.code || null,
        descricao: item.description || '-',
        nivel: item.level ?? null,
        tipo_grupo: item.groupType || item.group_type || null,
        data_inicio_obra: projectSummary.startAt || null,
        data_fim_obra: projectSummary.endAt || project.finishProjectDate || project.activeBaselineEndDate || null,
        data_inicio: row.startAt || row.start_at || null,
        data_fim: row.endAt || row.end_at || null,
        custo_mao_obra: item.laborCost ?? item.labor_cost ?? null,
        custo_material: item.materialCost ?? item.material_cost ?? null,
        custo_total:
          item.totalCost ??
          item.total ??
          item.total_cost ??
          (Number(item.laborCost ?? item.labor_cost) || 0) +
            (Number(item.materialCost ?? item.material_cost) || 0),
        ignorado_erp: Boolean(item.ignoredOnErp ?? item.ignored_on_erp),
        peso_base: sumPoints(basePoints),
        peso_previsto: sumPoints(expectedPoints),
        peso_realizado: sumPoints(realizedPoints),
        peso_vinculado: weights.reduce(
          (total, weight) => total + (Number(weight.percentage) || 0),
          0,
        ),
        total_pesos_atividades: weights.length,
        total_pesos_etapas: jobWeights.length,
        atividades: joinUnique(weights.map((weight) => String(weight.activity?.id || ''))),
        servicos: joinUnique(weights.map((weight) => weight.activity?.service?.name)),
        lotes: joinUnique(weights.map((weight) => weight.activity?.floor?.name)),
        etapas: joinUnique(jobWeights.map((weight) => weight.job?.name)),
        ultima_competencia_realizada: lastRealizedPoint?.x || null,
        ultimo_realizado: lastRealizedPoint?.y ?? null,
        pontos_mensais: pontosMensais,
      }
    })
  })
  const budgetWeights = data.cffReports.flatMap((report) => {
    return (report.data?.rows || []).flatMap((row) => {
      const item = row.budgetItem || row.budget_item || {}
      const weights = item.budgetWeights || row.activity_weights || []
      const uniqueItemId = String(item.id || `${report.budgetId}_${row.code || item.code || Math.random()}`)

      return weights.map((weight, weightIdx) => {
        const jobWeights = weight.jobBudgetWeights || []
        const uniqueWeightId = String(
          weight.id || `${report.budgetId}_${uniqueItemId}_${weightIdx}_${weight.activity?.id || Math.random()}`,
        )
        return {
          ...projectReferenceData,
          orcamento_id: String(report.budgetId),
          orcamento_nome: report.name || `Orçamento ${report.budgetId}`,
          id_prevision: uniqueWeightId,
          id_item_orcamento: uniqueItemId,
          codigo: row.code || item.code || null,
          descricao: item.description || '-',
          nivel: item.level ?? null,
          tipo_grupo: item.groupType || item.group_type || null,
          custo_material: item.materialCost ?? item.material_cost ?? null,
          custo_mao_obra: item.laborCost ?? item.labor_cost ?? null,
          custo_total:
            item.totalCost ??
            item.total ??
            item.total_cost ??
            (Number(item.laborCost ?? item.labor_cost) || 0) +
              (Number(item.materialCost ?? item.material_cost) || 0),
          id_peso: uniqueWeightId,
          porcentagem: Number(weight.percentage) || 0,
          id_atividade: weight.activity?.id ? String(weight.activity.id) : null,
          servico_nome: weight.activity?.service?.name || '-',
          pavimento_nome: weight.activity?.floor?.name || '-',
          total_microservicos: jobWeights.length,
          microservicos: jobWeights.map((jw) => ({
            id_microservico: jw.job?.id ? String(jw.job.id) : null,
            nome: jw.job?.name || '-',
            parte: jw.job?.part ? String(jw.job.part) : null,
            porcentagem: Number(jw.percentage) || 0,
          })),
          microservicos_resumo:
            jobWeights
              .map(
                (jw) =>
                  `${jw.job?.name || '-'}${
                    jw.percentage != null ? ` (${(Number(jw.percentage) * 100).toFixed(1)}%)` : ''
                  }`,
              )
              .join('; ') || '-',
        }
      })
    })
  })
  const cffSummaries = data.cffReports.map((report) =>
    buildCffMonthlySummary(report, projectReferenceData),
  )
  const dashboardStates = data.dashboardWeights.map((dashboard) => ({
    ...projectReferenceData,
    id_prevision: String(dashboard.id),
    nome: dashboard.name || null,
    categoria: dashboard.category || null,
    perspectiva: dashboard.perspective || null,
    padrao: Boolean(dashboard.primary),
    possui_orcamento: Boolean(dashboard.hasBudgetLink),
    status: dashboard.dashboardStatus?.status || null,
    atualizado_em: dashboard.dashboardStatus?.updatedAt || null,
  }))
  const general = []
  const monthly = []
  const weekly = []
  const serviceEvolution = []
  const floorEvolution = []

  for (const dashboard of data.dashboards) {
    const perspective = dashboard.perspective
    const details = dashboard.data.detailedDashboard || {}
    const info = details.generalInfo || {}
    general.push({
      ...projectReferenceData,
      perspectiva: perspective,
      custo: info.cost ?? null,
      custo_realizado: info.realized_cost ?? null,
      data_inicio: info.start_at || null,
      data_fim: info.end_at || null,
      ultima_medicao: info.last_measurement || null,
      progresso_previsto: info.expected ?? null,
      progresso_realizado: info.realized ?? null,
      atraso_dias: info.delay ?? null,
      idp: info.idp ?? null,
      dias_desde_inicio: info.days_since_start ?? null,
      dias_ate_fim: info.days_to_end ?? null,
    })

    const progression = details.monthlyProgress || {}
    let accumulatedBase = 0
    let accumulatedExpected = 0
    let accumulatedRealized = 0
    for (let index = 0; index < (progression.dates || []).length; index += 1) {
      const base = Number(progression.base?.[index]) || 0
      const expected = Number(progression.expected?.[index]) || 0
      const realized = Number(progression.realized?.[index]) || 0
      accumulatedBase += base
      accumulatedExpected += expected
      accumulatedRealized += realized
      monthly.push({
        ...projectReferenceData,
        perspectiva: perspective,
        data: progression.dates[index],
        base_mes: base,
        previsto_mes: expected,
        realizado_mes: realized,
        curva_base: accumulatedBase,
        curva_prevista: accumulatedExpected,
        curva_realizada: accumulatedRealized,
      })
    }

    const sCurveData = details.sCurve || dashboard.data.sCurve || {}
    weekly.push(...aggregateSCurveToWeekly(sCurveData, projectReferenceData, perspective))

    serviceEvolution.push(
      ...(dashboard.data.workPackageEvolution || []).map((item) => ({
        ...projectReferenceData,
        perspectiva: perspective,
        id_prevision: String(item.service_id),
        nome: item.name,
        cor: item.color || null,
        posicao: item.position ?? null,
        data_base_inicio: item.base_start_at || null,
        data_base_fim: item.base_end_at || null,
        data_prevista_inicio: item.expected_start_at || null,
        data_prevista_fim: item.expected_end_at || null,
        duracao_base: item.base_duration ?? null,
        duracao_prevista: item.expected_duration ?? null,
        base: item.base ?? null,
        previsto: item.expected ?? null,
        realizado: item.realized ?? null,
        atraso_dias: item.delay ?? null,
        delta: item.delta ?? null,
        idp: item.idp ?? null,
        custo_base: item.base_cost ?? null,
        custo_total: item.total_cost ?? null,
      })),
    )
    floorEvolution.push(
      ...(dashboard.data.floorEvolution || []).map((item) => ({
        ...projectReferenceData,
        perspectiva: perspective,
        id_prevision: String(item.floor_id),
        nome: item.name,
        grupo_repeticao: item.replication_group || null,
        posicao: item.position ?? null,
        data_base_inicio: item.base_start_at || null,
        data_base_fim: item.base_end_at || null,
        data_prevista_inicio: item.expected_start_at || null,
        data_prevista_fim: item.expected_end_at || null,
        duracao_base: item.base_duration ?? null,
        duracao_prevista: item.expected_duration ?? null,
        base: item.base ?? null,
        previsto: item.expected ?? null,
        realizado: item.realized ?? null,
        atraso_dias: item.delay ?? null,
        delta: item.delta ?? null,
        idp: item.idp ?? null,
        custo_base: item.base_cost ?? null,
        custo_total: item.total_cost ?? null,
      })),
    )
  }

  const activeBaseline = (data.baselineCurves || []).find((curve) => curve.ativa)
  const activeBaselineByMonth = new Map()
  monthly.forEach((row) => {
    const month = String(row.data || '').slice(0, 7)
    if (!month) return
    const point = activeBaselineByMonth.get(month) || { data: month, fisico: null, financeiro: null }
    if (String(row.perspectiva || '').toLowerCase() === 'physical') point.fisico = Number(row.curva_base) || 0
    if (String(row.perspectiva || '').toLowerCase() === 'monetary') point.financeiro = Number(row.curva_base) || 0
    activeBaselineByMonth.set(month, point)
  })
  const baselineCurves = (data.baselineCurves || []).map((curve) => {
    if (!activeBaseline || String(curve.id) !== String(activeBaseline.id) || !activeBaselineByMonth.size) return clean(curve)
    const points = new Map((curve.pontos || []).map((point) => [String(point.data || '').slice(0, 7), point]))
    activeBaselineByMonth.forEach((point, month) => points.set(month, { ...(points.get(month) || { data: month }), data: month, fisico: point.fisico, financeiro: point.financeiro }))
    return clean({ ...curve, pontos: [...points.values()].filter((point) => point.data).sort((left, right) => String(left.data).localeCompare(String(right.data))) })
  })

  return {
    analyticsDoc: clean({
      ...projectReferenceData,
      orcamentos: budgets,
      cff_resumo: cffSummaries,
      dashboard_estados: dashboardStates,
      dashboard_geral: general,
      dashboard_semanal: weekly,
      dashboard_mensal: monthly,
      dashboard_servicos: serviceEvolution,
      dashboard_lotes: floorEvolution,
      curvas_linhas_base: baselineCurves,
      atualizado_em: new Date().toISOString(),
    }),
    budgetItems: budgetItems.map(clean),
    budgetWeights: budgetWeights.map(clean),
  }
}

async function syncCollectionForProject(db, collectionName, projectId, items) {
  const collection = db.collection(collectionName)
  const existing = await collection.where('projeto_id', '==', projectId).get()
  const existingById = new Map(existing.docs.map((doc) => [doc.id, doc]))
  const incomingIds = new Set(items.map((item) => `${projectId}_${item.id_prevision}`))
  const writes = []

  for (const doc of existing.docs) {
    if (!incomingIds.has(doc.id)) writes.push({ type: 'delete', ref: doc.ref })
  }
  for (const item of items) {
    const documentId = `${projectId}_${item.id_prevision}`
    const existingDocument = existingById.get(documentId)
    if (existingDocument && isDeepStrictEqual(existingDocument.data(), item)) continue

    writes.push({
      type: 'set',
      ref: collection.doc(documentId),
      data: item,
    })
  }

  for (let index = 0; index < writes.length; index += 450) {
    const batch = db.batch()
    for (const write of writes.slice(index, index + 450)) {
      if (write.type === 'delete') batch.delete(write.ref)
      else batch.set(write.ref, write.data, { merge: true })
    }
    await batch.commit()
  }
}

async function synchronizeAll(apiKey, restToken = '', requestedProjectId = '') {
  const db = getDb()
  const allProjects = await fetchAllProjectIds(apiKey)
  const kanban = await fetchKanbanData(apiKey)
  const projects = requestedProjectId
    ? allProjects.filter((project) => String(project.id) === requestedProjectId)
    : allProjects

  if (!projects.length) {
    throw new Error('Projeto nao encontrado na Prevision.')
  }

  const totals = {
    projects: projects.length,
    activities: 0,
    measurements: 0,
    floors: 0,
    services: 0,
    milestones: 0,
    baselines: 0,
    responsibles: 0,
    restrictions: 0,
    microservices: 0,
  }

  for (const project of projects) {
    const projectData = await fetchProjectData(apiKey, project, restToken)
    const projectName = projectData.details.name || project.name
    const baselineByActivityId = new Map()

    for (const baselineStep of projectData.baselineSteps) {
      for (const activity of baselineStep.activities || []) {
        baselineByActivityId.set(String(activity.id), baselineStep)
      }
    }

    const activityContext = {
      baselineByActivityId,
      scheduleById: new Map(
        projectData.scheduleActivities.map((activity) => [String(activity.id), activity]),
      ),
      criticalActivityIds: new Set(projectData.details.criticalPath || []),
      referenceDate: projectData.details.summary?.lastMeasurement || null,
    }
    const measurements = projectData.activities.flatMap((item) =>
      (item.measuresPage?.nodes || []).map((m) =>
        normalizeMeasurement(m, item, project, projectName),
      ),
    )
    const normalized = {
      activities: projectData.activities.map((item) =>
        normalizeActivity(item, project, projectName, activityContext),
      ),
      measurements,
      floors: projectData.floors.map((item) => normalizeFloor(item, project, projectName)),
      services: projectData.services.map((item) => normalizeService(item, project, projectName)),
      milestones: projectData.milestones.map((item) => normalizeMilestone(item, project, projectName)),
      baselines: projectData.baselines.map((item) => normalizeBaseline(item, project, projectName)),
      responsibles: projectData.responsibles.map((item) =>
        normalizeResponsible(item, project, projectName),
      ),
      restrictions: kanban.tasks
        .filter((task) => String(task.project?.id) === String(project.id))
        .map(normalizeRestriction),
    }
    const microservicesCount = normalized.activities.reduce(
      (total, activity) => total + (activity.total_microservicos || 0),
      0,
    )

    for (const [key, collectionName] of Object.entries(COLLECTIONS)) {
      if (normalized[key]) {
        await syncCollectionForProject(db, collectionName, String(project.id), normalized[key])
        totals[key] += normalized[key].length
      }
    }
    totals.microservices += microservicesCount

    await db
      .collection('prevision_projetos')
      .doc(String(project.id))
      .set(
        {
          ...normalizeProject(project, projectData.details, {
            activities: normalized.activities.length,
            measurements: normalized.measurements.length,
            microservices: microservicesCount,
            floors: normalized.floors.length,
            services: normalized.services.length,
            milestones: normalized.milestones.length,
            baselines: normalized.baselines.length,
            responsibles: normalized.responsibles.length,
            restrictions: normalized.restrictions.length,
          }),
          restricoes: normalized.restrictions,
        },
        { merge: true },
      )
  }

  return totals
}

async function synchronizeRestrictions(apiKey, requestedProjectId = '') {
  const db = getDb()
  const [projects, kanban] = await Promise.all([
    fetchAllProjectIds(apiKey),
    fetchKanbanData(apiKey),
  ])
  const selectedProjects = requestedProjectId
    ? projects.filter((project) => String(project.id) === requestedProjectId)
    : projects

  if (!selectedProjects.length) {
    throw new Error('Projeto nao encontrado na Prevision.')
  }

  let restrictions = 0

  for (const project of selectedProjects) {
    const normalized = kanban.tasks
      .filter((task) => String(task.project?.id) === String(project.id))
      .map(normalizeRestriction)

    await db.collection('prevision_projetos').doc(String(project.id)).set(
      {
        total_restricoes: normalized.length,
        restricoes: normalized,
      },
      { merge: true },
    )
    restrictions += normalized.length
  }

  return {
    projects: selectedProjects.length,
    restrictions,
    summary: kanban.summary,
    steps: kanban.steps.length,
  }
}

async function synchronizeAnalytics(apiKey, requestedProjectId = '') {
  const db = getDb()
  const allProjects = await fetchAllProjectIds(apiKey)
  const projects = requestedProjectId
    ? allProjects.filter((project) => String(project.id) === requestedProjectId)
    : allProjects

  if (!projects.length) {
    throw new Error('Projeto nao encontrado na Prevision.')
  }

  const totals = {
    projects: projects.length,
    budgets: 0,
    budgetItems: 0,
    budgetWeights: 0,
    dashboards: 0,
    weekly: 0,
    monthly: 0,
    services: 0,
    floors: 0,
  }

  for (const project of projects) {
    const data = await fetchAnalyticsData(apiKey, project)
    const { analyticsDoc, budgetItems, budgetWeights } = normalizeAnalytics(project, data)
    const documentSize = Buffer.byteLength(JSON.stringify(analyticsDoc))

    if (documentSize > 900000) {
      throw new Error(
        `Dados analiticos do projeto ${project.name} excedem o tamanho seguro do Firestore.`,
      )
    }

    await db
      .collection('prevision_analiticos')
      .doc(String(project.id))
      .set(analyticsDoc)

    await syncCollectionForProject(db, 'prevision_cff_itens', String(project.id), budgetItems)
    await syncCollectionForProject(db, 'prevision_pesos_orcamento', String(project.id), budgetWeights)

    await db.collection('prevision_projetos').doc(String(project.id)).set(
      {
        total_orcamentos: analyticsDoc.orcamentos.length,
        total_itens_cff: budgetItems.length,
        total_pesos_orcamento: budgetWeights.length,
        total_dashboards: analyticsDoc.dashboard_estados.length,
      },
      { merge: true },
    )

    totals.budgets += analyticsDoc.orcamentos.length
    totals.budgetItems += budgetItems.length
    totals.budgetWeights += budgetWeights.length
    totals.dashboards += analyticsDoc.dashboard_estados.length
    totals.weekly += analyticsDoc.dashboard_semanal.length
    totals.monthly += analyticsDoc.dashboard_mensal.length
    totals.services += analyticsDoc.dashboard_servicos.length
    totals.floors += analyticsDoc.dashboard_lotes.length
  }

  return totals
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Metodo nao permitido.' })
  }

  try {
    const apiKey = process.env.PREVISION_API_KEY
      ? sanitizePrevisionApiKey(process.env.PREVISION_API_KEY)
      : ''

    if (!apiKey || apiKey === '...') {
      throw new Error('PREVISION_API_KEY nao configurada com o valor real.')
    }

    const restToken = process.env.PREVISION_REST_TOKEN
      ? sanitizeRestToken(process.env.PREVISION_REST_TOKEN)
      : ''
    const requestedProjectId = req.body?.projectId ? String(req.body.projectId) : ''
    const totals =
      req.body?.scope === 'restrictions'
        ? await synchronizeRestrictions(apiKey, requestedProjectId)
        : req.body?.scope === 'analytics'
          ? await synchronizeAnalytics(apiKey, requestedProjectId)
        : await synchronizeAll(apiKey, restToken, requestedProjectId)
    clearFirestoreCache()
    return res.status(200).json({ ok: true, imported: totals.projects, totals })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao sincronizar projetos.',
    })
  }
}
