import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

function getServiceAccount() {
  const rawValue = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64

  if (!rawValue) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 nao configurada.')
  }

  const encoded = rawValue
    .trim()
    .replace(/^FIREBASE_SERVICE_ACCOUNT_BASE64=/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s/g, '')

  try {
    const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))

    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error('campos obrigatorios ausentes')
    }

    return serviceAccount
  } catch {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_BASE64 invalida ou incompleta (${encoded.length} caracteres). Gere novamente a partir do JSON da conta de servico.`,
    )
  }
}

export function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(getServiceAccount()),
    })
  }

  return getFirestore()
}
