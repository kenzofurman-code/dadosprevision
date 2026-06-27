import { readCollection, readCollectionPage } from '../lib/firestore-reader.js'

const COLLECTIONS = {
  activities: 'prevision_atividades',
  floors: 'prevision_pavimentos',
  services: 'prevision_servicos',
  milestones: 'prevision_marcos',
  baselines: 'prevision_linhas_base',
  responsibles: 'prevision_responsaveis',
}

const ANALYTICS_FIELDS = {
  budgets: 'orcamentos',
  budgetItems: 'itens_orcamento',
  dashboard: 'dashboard_geral',
  dashboardMonthly: 'dashboard_mensal',
  dashboardServices: 'dashboard_servicos',
  dashboardFloors: 'dashboard_lotes',
  dashboardStates: 'dashboard_estados',
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Metodo nao permitido.' })
  }

  const type = String(req.query?.type || '')
  const collectionName = COLLECTIONS[type]

  if (
    !collectionName &&
    type !== 'restrictions' &&
    type !== 'activityJobs' &&
    !ANALYTICS_FIELDS[type]
  ) {
    return res.status(400).json({ error: 'Tipo de dado invalido.' })
  }

  try {
    const page = Math.max(0, Number(req.query?.page) || 0)
    const pageSize = Math.min(200, Math.max(10, Number(req.query?.limit) || 100))
    const projectId = String(req.query?.projectId || '')

    if (type === 'restrictions') {
      const projects = await readCollection('prevision_projetos')
      const allRecords = projects
        .filter((project) => !projectId || String(project.id_prevision) === projectId)
        .flatMap((project) => project.restricoes || [])
      const start = page * pageSize
      const records = allRecords.slice(start, start + pageSize)

      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        ok: true,
        type,
        records,
        page,
        hasMore: start + pageSize < allRecords.length,
      })
    }

    if (type === 'activityJobs') {
      const activityPage = await readCollectionPage('prevision_atividades', {
        page,
        pageSize,
        projectId,
      })
      const records = activityPage.records.flatMap((activity) =>
        (activity.microservicos || []).map((job) => ({
          ...job,
          firestore_id: `${activity.id_prevision}_${job.id_prevision}`,
          projeto_id: activity.projeto_id,
          projeto_nome: activity.projeto_nome,
          atividade_id: activity.id_prevision,
          atividade_eap: activity.codigo_eap,
          servico_nome: activity.servico_nome,
          pavimento_nome: activity.pavimento_nome,
        })),
      )

      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        ok: true,
        type,
        records,
        page,
        hasMore: activityPage.hasMore,
      })
    }

    if (type === 'dashboardCff') {
      const documents = await readCollection('prevision_analiticos')
      const scopedDocuments = documents.filter(
        (document) => !projectId || String(document.projeto_id) === projectId,
      )
      const allItems = scopedDocuments.flatMap((document) => document.itens_orcamento || [])
      const allSummaries = scopedDocuments.flatMap((document) => document.cff_resumo || [])
      const start = page * pageSize
      const records = allItems.slice(start, start + pageSize)

      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        ok: true,
        type,
        records,
        summary: allSummaries,
        page,
        hasMore: start + pageSize < allItems.length,
      })
    }

    if (ANALYTICS_FIELDS[type]) {
      const documents = await readCollection('prevision_analiticos')
      const field = ANALYTICS_FIELDS[type]
      const scopedDocuments = documents.filter(
        (document) => !projectId || String(document.projeto_id) === projectId,
      )
      const allRecords = scopedDocuments.flatMap((document) => document[field] || [])
      const start = page * pageSize
      const records = allRecords.slice(start, start + pageSize)

      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        ok: true,
        type,
        records,
        page,
        hasMore: start + pageSize < allRecords.length,
      })
    }

    const { records, hasMore } = await readCollectionPage(collectionName, {
      page,
      pageSize,
      projectId,
    })

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ ok: true, type, records, page, hasMore })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao carregar dados do Firestore.',
    })
  }
}
