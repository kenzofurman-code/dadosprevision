import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PREVISION_ENDPOINT = 'https://api.prevision.com.br/graphql'

const DEFAULT_PROJECTS_QUERY = `
  query Projects($first: Int!, $after: String) {
    projects(first: $first, after: $after) {
      nodes {
        id
        name
        status
        startDate
        endDate
        disabled
        company {
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

function getServiceAccount() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64

  if (!encoded) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 nao configurada.')
  }

  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
}

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(getServiceAccount()),
    })
  }

  return getFirestore()
}

function getProjectConnection(data) {
  if (!data || typeof data !== 'object') return null

  return data.projects ?? data.projectList ?? data.allProjects ?? null
}

function getProjects(connection) {
  if (Array.isArray(connection)) return connection
  if (Array.isArray(connection?.nodes)) return connection.nodes
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge.node)
  if (Array.isArray(connection?.items)) return connection.items

  return []
}

function normalizeProject(project) {
  const id = project.id ?? project.uuid ?? project.code ?? project.identifier
  const company = project.company ?? project.companyData ?? project.enterprise ?? {}

  return {
    id_prevision: String(id),
    nome_projeto: project.name ?? project.title ?? project.description ?? '-',
    empresa_nome: company.name ?? project.companyName ?? project.enterpriseName ?? '-',
    data_inicio: project.startDate ?? project.start_date ?? project.startsAt ?? null,
    data_fim: project.endDate ?? project.end_date ?? project.endsAt ?? null,
    status: project.status ?? 'Ativo',
    desativado: Boolean(project.disabled ?? project.archived ?? project.inactive ?? false),
    atualizado_em: new Date().toISOString(),
  }
}

async function saveProjects(db, projects) {
  const chunkSize = 450

  for (let index = 0; index < projects.length; index += chunkSize) {
    const batch = db.batch()
    const chunk = projects.slice(index, index + chunkSize)

    for (const project of chunk) {
      const ref = db.collection('prevision_projetos').doc(project.id_prevision)
      batch.set(ref, project, { merge: true })
    }

    await batch.commit()
  }
}

async function fetchPrevisionProjects() {
  const apiKey = process.env.PREVISION_API_KEY

  if (!apiKey) {
    throw new Error('PREVISION_API_KEY nao configurada.')
  }

  const query = process.env.PREVISION_PROJECTS_QUERY || DEFAULT_PROJECTS_QUERY
  const projects = []
  let after = null
  let hasNextPage = true
  let page = 0

  while (hasNextPage && page < 20) {
    page += 1

    const response = await fetch(PREVISION_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          first: 100,
          after,
        },
      }),
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(`Prevision retornou HTTP ${response.status}.`)
    }

    if (payload?.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join(' | '))
    }

    const connection = getProjectConnection(payload?.data)
    const currentProjects = getProjects(connection)
    projects.push(...currentProjects)

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage)
    after = connection?.pageInfo?.endCursor ?? null
  }

  return projects
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Metodo nao permitido.' })
  }

  try {
    const rawProjects = await fetchPrevisionProjects()
    const normalizedProjects = rawProjects.map(normalizeProject).filter((project) => project.id_prevision)
    const db = getDb()
    await saveProjects(db, normalizedProjects)

    return res.status(200).json({
      ok: true,
      imported: normalizedProjects.length,
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao sincronizar projetos.',
    })
  }
}
