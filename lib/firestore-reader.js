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

export async function readCollection(collectionName) {
  try {
    return await readWithAdmin(collectionName)
  } catch (adminError) {
    console.warn(`Firebase Admin indisponivel para ${collectionName}; usando REST.`, adminError)
    return readWithFirestoreRest(collectionName)
  }
}

export async function readCollectionPage(
  collectionName,
  { page = 0, pageSize = 100, projectId = '' } = {},
) {
  const endpoint =
    'https://firestore.googleapis.com/v1/projects/dadosprevision/databases/(default)/documents:runQuery'
  const where = projectId
    ? {
        fieldFilter: {
          field: { fieldPath: 'projeto_id' },
          op: 'EQUAL',
          value: { stringValue: projectId },
        },
      }
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
