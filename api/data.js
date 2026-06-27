import { readCollection, readCollectionPage } from '../lib/firestore-reader.js'

const COLLECTIONS = {
  activities: 'prevision_atividades',
  floors: 'prevision_pavimentos',
  services: 'prevision_servicos',
  milestones: 'prevision_marcos',
  baselines: 'prevision_linhas_base',
  responsibles: 'prevision_responsaveis',
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Metodo nao permitido.' })
  }

  const type = String(req.query?.type || '')
  const collectionName = COLLECTIONS[type]

  if (!collectionName && type !== 'restrictions') {
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
