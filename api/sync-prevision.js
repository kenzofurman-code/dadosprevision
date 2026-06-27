import { isDeepStrictEqual } from 'node:util'
import { getDb } from '../lib/firebase-admin.js'
import {
  fetchAllProjectIds,
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
        : await synchronizeAll(apiKey, restToken, requestedProjectId)
    return res.status(200).json({ ok: true, imported: totals.projects, totals })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao sincronizar projetos.',
    })
  }
}
