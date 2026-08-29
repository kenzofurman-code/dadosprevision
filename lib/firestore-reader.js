import { getDb } from './firebase-admin.js'

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

function decodeDocument(document) {
  return {
    ...decodeFirestoreFields(document.fields || {}),
    firestore_id: document.name.split('/').pop(),
  }
}

async function readWithAdmin(collectionName) {
  const snapshot = await getDb().collection(collectionName).get()
  return snapshot.docs.map((doc) => ({ ...doc.data(), firestore_id: doc.id }))
}

async function readWithFirestoreRest(collectionName) {
  const documents = []
  let pageToken = ''

  for (let page = 0; page < 100; page += 1) {
    const endpoint = new URL(
      `https://firestore.googleapis.com/v1/projects/dadosprevision/databases/(default)/documents/${collectionName}`,
    )
    endpoint.searchParams.set('pageSize', '300')
    if (pageToken) endpoint.searchParams.set('pageToken', pageToken)

    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'dadosprevision/2.0',
      },
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(payload?.error?.message || `Firestore REST retornou HTTP ${response.status}.`)
    }

    documents.push(
      ...(payload?.documents || []).map(decodeDocument),
    )

    if (!payload?.nextPageToken) break
    pageToken = payload.nextPageToken
  }

  return documents
}

async function readPageWithAdmin(collectionName, { page = 0, pageSize = 100, projectId = '', date = '' } = {}) {
  let query = getDb().collection(collectionName)
  if (projectId) {
    query = query.where('projeto_id', '==', projectId)
  }
  if (date) {
    query = query.where('data_medicao', '==', date)
  }
  const snapshot = await query
    .orderBy('__name__')
    .offset(page * pageSize)
    .limit(pageSize + 1)
    .get()

  const docs = snapshot.docs.map((doc) => ({ ...doc.data(), firestore_id: doc.id }))
  return {
    records: docs.slice(0, pageSize),
    hasMore: docs.length > pageSize,
  }
}

async function readPageWithFirestoreRest(
  collectionName,
  { page = 0, pageSize = 100, projectId = '', date = '' } = {},
) {
  const endpoint =
    'https://firestore.googleapis.com/v1/projects/dadosprevision/databases/(default)/documents:runQuery'
  const filters = []
  if (projectId) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'projeto_id' },
        op: 'EQUAL',
        value: { stringValue: projectId },
      },
    })
  }
  if (date) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'data_medicao' },
        op: 'EQUAL',
        value: { stringValue: date },
      },
    })
  }

  const where =
    filters.length === 1
      ? filters[0]
      : filters.length > 1
      ? { compositeFilter: { op: 'AND', filters } }
      : undefined
  const structuredQuery = {
    from: [{ collectionId: collectionName }],
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    offset: page * pageSize,
    limit: pageSize + 1,
  }

  if (where) structuredQuery.where = where

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'dadosprevision/2.0',
    },
    body: JSON.stringify({ structuredQuery }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Firestore REST retornou HTTP ${response.status}.`)
  }

  const records = (payload || []).filter((item) => item.document).map((item) => decodeDocument(item.document))

  return {
    records: records.slice(0, pageSize),
    hasMore: records.length > pageSize,
  }
}

// In-memory cache for Firestore queries to drastically reduce read quota usage
const memoryCache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function clearFirestoreCache() {
  memoryCache.clear()
}

function getCache(key) {
  const item = memoryCache.get(key)
  if (!item) return null
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key)
    return null
  }
  return item.data
}

function setCache(key, data, ttlMs = CACHE_TTL_MS) {
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  })
}

export async function readCollection(collectionName) {
  const cacheKey = `coll:${collectionName}`
  const cached = getCache(cacheKey)
  if (cached) return cached

  try {
    const result = await readWithAdmin(collectionName)
    setCache(cacheKey, result)
    return result
  } catch (adminError) {
    console.warn(`Firebase Admin indisponivel para ${collectionName}; usando REST.`, adminError)
    const result = await readWithFirestoreRest(collectionName)
    setCache(cacheKey, result)
    return result
  }
}

export async function readCollectionPage(
  collectionName,
  { page = 0, pageSize = 100, projectId = '', date = '' } = {},
) {
  const cacheKey = `page:${collectionName}:${page}:${pageSize}:${projectId}:${date}`
  const cached = getCache(cacheKey)
  if (cached) return cached

  try {
    const result = await readPageWithAdmin(collectionName, { page, pageSize, projectId, date })
    setCache(cacheKey, result)
    return result
  } catch (adminError) {
    console.warn(`Firebase Admin indisponivel para ${collectionName}; usando REST.`, adminError)
    const result = await readPageWithFirestoreRest(collectionName, { page, pageSize, projectId, date })
    setCache(cacheKey, result)
    return result
  }
}

