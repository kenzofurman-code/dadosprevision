import { isDeepStrictEqual } from 'node:util'
import { getDb } from '../lib/firebase-admin.js'
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
    excluido_em: item.deletedAt || null,
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
    ativa: Boolean(item.active),
    criado_em: item.createdAt,
    versao_lob_id: item.lobVersionId || null,
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
    checklist_total: checklist.length,
    checklist_concluido: checklist.filter((item) => item.status).length,
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

function normalizeAnalytics(project, data) {
  const projectReferenceData = {
    projeto_id: String(project.id),
    projeto_nome: project.name || '-',
  }
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
  const budgetItems = data.cffReports.flatMap((report) =>
    (report.data?.rows || []).map((row) => {
      const item = row.budgetItem || row.budget_item || {}
      const weights = item.budgetWeights || row.activity_weights || []
      const jobWeights = weights.flatMap((weight) => weight.jobBudgetWeights || [])
      const realizedPoints = row.realizedPoints || row.realized_points || []
      const lastRealizedPoint = Array.isArray(realizedPoints)
        ? realizedPoints.at(-1)
        : null
      return {
        ...projectReferenceData,
        orcamento_id: report.budgetId,
        id_prevision: String(item.id || `${report.budgetId}_${row.code}`),
        codigo: row.code || item.code || null,
        descricao: item.description || '-',
        nivel: item.level ?? null,
        tipo_grupo: item.groupType || item.group_type || null,
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
        peso_base: sumPoints(row.basePoints || row.base_points),
        peso_previsto: sumPoints(row.expectedPoints || row.expected_points),
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
      }
    }),
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

  return clean({
    ...projectReferenceData,
    orcamentos: budgets,
    itens_orcamento: budgetItems,
    dashboard_estados: dashboardStates,
    dashboard_geral: general,
    dashboard_mensal: monthly,
    dashboard_servicos: serviceEvolution,
    dashboard_lotes: floorEvolution,
    atualizado_em: new Date().toISOString(),
  })
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
    floors: 0,
    services: 0,
    milestones: 0,
    baselines: 0,
    responsibles: 0,
    restrictions: 0,
  }

  for (const project of projects) {
    const data = await fetchProjectData(apiKey, project, restToken)
    const projectName = data.details.name || project.name
    const baselineByActivityId = new Map()

    for (const baselineStep of data.baselineSteps) {
      for (const activity of baselineStep.activities || []) {
        baselineByActivityId.set(String(activity.id), baselineStep)
      }
    }

    const activityContext = {
      baselineByActivityId,
      scheduleById: new Map(
        data.scheduleActivities.map((activity) => [String(activity.id), activity]),
      ),
      criticalActivityIds: new Set(data.details.criticalPath || []),
      referenceDate: data.details.summary?.lastMeasurement || null,
    }
    const normalized = {
      activities: data.activities.map((item) =>
        normalizeActivity(item, project, projectName, activityContext),
      ),
      floors: data.floors.map((item) => normalizeFloor(item, project, projectName)),
      services: data.services.map((item) => normalizeService(item, project, projectName)),
      milestones: data.milestones.map((item) => normalizeMilestone(item, project, projectName)),
      baselines: data.baselines.map((item) => normalizeBaseline(item, project, projectName)),
      responsibles: data.responsibles.map((item) =>
        normalizeResponsible(item, project, projectName),
      ),
      restrictions: kanban.tasks
        .filter((task) => String(task.project?.id) === String(project.id))
        .map(normalizeRestriction),
    }

    for (const [key, collectionName] of Object.entries(COLLECTIONS)) {
      await syncCollectionForProject(db, collectionName, String(project.id), normalized[key])
      totals[key] += normalized[key].length
    }

    await db
      .collection('prevision_projetos')
      .doc(String(project.id))
      .set(
        {
          ...normalizeProject(project, data.details, {
            activities: normalized.activities.length,
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
    dashboards: 0,
    monthly: 0,
    services: 0,
    floors: 0,
  }

  for (const project of projects) {
    const data = await fetchAnalyticsData(apiKey, project)
    const normalized = normalizeAnalytics(project, data)
    const documentSize = Buffer.byteLength(JSON.stringify(normalized))

    if (documentSize > 900000) {
      throw new Error(
        `Dados analiticos do projeto ${project.name} excedem o tamanho seguro do Firestore.`,
      )
    }

    await db
      .collection('prevision_analiticos')
      .doc(String(project.id))
      .set(normalized)
    await db.collection('prevision_projetos').doc(String(project.id)).set(
      {
        total_orcamentos: normalized.orcamentos.length,
        total_dashboards: normalized.dashboard_estados.length,
      },
      { merge: true },
    )

    totals.budgets += normalized.orcamentos.length
    totals.budgetItems += normalized.itens_orcamento.length
    totals.dashboards += normalized.dashboard_estados.length
    totals.monthly += normalized.dashboard_mensal.length
    totals.services += normalized.dashboard_servicos.length
    totals.floors += normalized.dashboard_lotes.length
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
    return res.status(200).json({ ok: true, imported: totals.projects, totals })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao sincronizar projetos.',
    })
  }
}
