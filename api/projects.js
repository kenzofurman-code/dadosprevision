import { getDb } from '../lib/firebase-admin.js'

function decodeFirestoreValue(value) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue)
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {})
  return null
}

function decodeFirestoreFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  )
}

function sortProjects(projects) {
  return projects.sort((first, second) =>
    String(first.nome_projeto || '').localeCompare(String(second.nome_projeto || ''), 'pt-BR'),
  )
}

async function readProjectsWithAdmin() {
  const snapshot = await getDb().collection('prevision_projetos').get()

  return snapshot.docs.map((doc) => ({ ...doc.data(), firestore_id: doc.id }))
}

function getFirebaseProjectId() {
  const rawValue = process.env.VITE_FIREBASE_PROJECT_ID || 'dadosprevision'
  const projectId = rawValue
    .trim()
    .replace(/^VITE_FIREBASE_PROJECT_ID=/i, '')
    .replace(/^["']|["']$/g, '')
    .trim()

  return projectId || 'dadosprevision'
}

async function readProjectsWithFirestoreRest() {
  const projectId = getFirebaseProjectId()
  const endpoint = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/prevision_projetos`,
  )
  endpoint.searchParams.set('pageSize', '300')

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'dadosprevision/1.0',
    },
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Firestore REST retornou HTTP ${response.status}.`)
  }

  return (payload?.documents || []).map((document) => ({
    ...decodeFirestoreFields(document.fields || {}),
    firestore_id: document.name.split('/').pop(),
  }))
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Metodo nao permitido.' })
  }

  try {
    let projects

    try {
      projects = await readProjectsWithAdmin()
    } catch (adminError) {
      console.warn('Firebase Admin indisponivel; usando leitura REST publica.', adminError)
      projects = await readProjectsWithFirestoreRest()
    }

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      ok: true,
      projects: sortProjects(projects),
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao carregar projetos do Firestore.',
    })
  }
}
