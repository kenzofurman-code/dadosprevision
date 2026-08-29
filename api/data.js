import { readCollection, readCollectionPage } from '../lib/firestore-reader.js'

const COLLECTIONS = {
  activities: 'prevision_atividades',
  floors: 'prevision_pavimentos',
  services: 'prevision_servicos',
  milestones: 'prevision_marcos',
  baselines: 'prevision_linhas_base',
  responsibles: 'prevision_responsaveis',
  cffItems: 'prevision_cff_itens',
  measurements: 'prevision_medicoes',
  budgetWeights: 'prevision_pesos_orcamento',
}

const ANALYTICS_FIELDS = {
  budgets: 'orcamentos',
  dashboard: 'dashboard_geral',
  dashboardWeekly: 'dashboard_semanal',
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
    type !== 'dashboardCff' &&
    type !== 'budgetItems' &&
    type !== 'gestaoVista' &&
    !ANALYTICS_FIELDS[type]
  ) {
    return res.status(400).json({ error: 'Tipo de dado invalido.' })
  }

  try {
    const page = Math.max(0, Number(req.query?.page) || 0)
    const pageSize = Math.min(200, Math.max(10, Number(req.query?.limit) || 100))
    const projectId = String(req.query?.projectId || '')
    const date = String(req.query?.date || '')

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

    if (type === 'gestaoVista') {
      const activityPage = await readCollectionPage('prevision_atividades', {
        page: 0,
        pageSize: 3000,
        projectId,
      })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        ok: true,
        type,
        records: activityPage.records,
        hasMore: false,
      })
    }

    if (type === 'dashboardCff' || type === 'budgetItems') {
      const { records: cffRecords, hasMore } = await readCollectionPage('prevision_cff_itens', {
        page,
        pageSize,
        projectId,
      })

      const documents = await readCollection('prevision_analiticos')
      const scopedDocuments = documents.filter(
        (document) => !projectId || String(document.projeto_id) === projectId,
      )
      const allSummaries = scopedDocuments.flatMap((document) => document.cff_resumo || [])

      // Fallback to legacy document.itens_orcamento if prevision_cff_itens not yet synced
      let records = cffRecords
      let paginationHasMore = hasMore
      if (records.length === 0) {
        const legacyItems = scopedDocuments.flatMap((document) => document.itens_orcamento || [])
        const start = page * pageSize
        records = legacyItems.slice(start, start + pageSize)
        paginationHasMore = start + pageSize < legacyItems.length
      }

      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({
        ok: true,
        type,
        records,
        summary: allSummaries,
        page,
        hasMore: paginationHasMore,
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
      date,
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
