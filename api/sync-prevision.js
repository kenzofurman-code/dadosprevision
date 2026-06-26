import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PREVISION_ENDPOINT = 'https://api.prevision.com.br/graphql'
const PREVISION_REST_ENDPOINTS = {
  construction: 'https://api.prevision.com.br/construction/api/v1/projects',
  incorporation: 'https://api.prevision.com.br/incorporation/api/v1/projects',
}

const DEFAULT_PROJECTS_QUERY = `
  query Projects($first: Int!, $after: String) {
    me {
      projectsPage(first: $first, after: $after, archivedLast: true) {
        nodes {
          id
          name
          archivedAt
          finishProjectDate
          activeBaselineEndDate
          updateProcessStatus
        }
        pageInfo {
          hasNextPage
          endCursor
        }
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

  return data.me?.projectsPage ?? data.projectsPage ?? data.projects ?? data.projectList ?? data.allProjects ?? null
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
    data_fim:
      project.endDate ??
      project.end_date ??
      project.endsAt ??
      project.finishProjectDate ??
      project.activeBaselineEndDate ??
      null,
    status: project.status ?? project.updateProcessStatus ?? 'Ativo',
    desativado: Boolean(project.disabled ?? project.archived ?? project.inactive ?? project.archivedAt ?? false),
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

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function sanitizePrevisionApiKey(value) {
  return value
    .trim()
    .replace(/^PREVISION_API_KEY=/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^(token|bearer)\s+/i, '')
    .trim()
}

async function fetchJsonWithRetry(url, options, attempts = 3) {
  let lastPayload = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options)
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    const payload = await response.json().catch(() => null)
    lastPayload = payload

    if (response.ok) return payload

    if (response.status === 429 && attempt < attempts) {
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : attempt * 12000
      await wait(delayMs)
      continue
    }

    if (response.status === 429) {
      throw new Error(
        'Prevision retornou HTTP 429. Aguarde 1 minuto e tente novamente; a API limita a quantidade de requisicoes por minuto.',
      )
    }

    const details = payload?.error?.message || payload?.message || payload?.error || ''
    throw new Error(
      `Prevision retornou HTTP ${response.status}${details ? `: ${details}` : ''}.`,
    )
  }

  return lastPayload
}

async function fetchPrevisionProjectsFromRest(apiKey) {
  const resource = process.env.PREVISION_REST_RESOURCE || 'construction'
  const endpoint = PREVISION_REST_ENDPOINTS[resource] || PREVISION_REST_ENDPOINTS.construction
  const payload = await fetchJsonWithRetry(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'dadosprevision/1.0',
    },
  })

  return payload?.projects ?? []
}

async function fetchPrevisionProjectsFromGraphql(apiKey) {
  const token = `token ${apiKey}`
  const query = process.env.PREVISION_PROJECTS_QUERY || DEFAULT_PROJECTS_QUERY
  const projects = []
  let after = null
  let hasNextPage = true
  let page = 0

  while (hasNextPage && page < 20) {
    page += 1

    const payload = await fetchJsonWithRetry(PREVISION_ENDPOINT, {
      method: 'POST',
      headers: {
        UserAuthorization: token,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'dadosprevision/1.0',
      },
      body: JSON.stringify({
        query,
        variables: {
          first: 100,
          after,
        },
      }),
    })

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

async function fetchPrevisionProjects() {
  const apiKey = process.env.PREVISION_API_KEY
    ? sanitizePrevisionApiKey(process.env.PREVISION_API_KEY)
    : ''

  if (!apiKey) {
    throw new Error('PREVISION_API_KEY nao configurada.')
  }

  if (process.env.PREVISION_API_MODE === 'rest') {
    if (apiKey === '93YZKy2JESYspFa9XNAHia59') {
      throw new Error(
        'PREVISION_API_MODE esta como rest, mas essa chave funcionou apenas no GraphQL. Configure PREVISION_API_MODE=graphql na Vercel.',
      )
    }

    return fetchPrevisionProjectsFromRest(apiKey)
  }

  return fetchPrevisionProjectsFromGraphql(apiKey)
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
