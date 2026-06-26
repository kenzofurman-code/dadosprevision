import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

function getServiceAccount() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64

  if (!encoded) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 nao configurada.')
  }

  return JSON.parse(Buffer.from(encoded.trim(), 'base64').toString('utf8'))
}

export function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(getServiceAccount()),
    })
  }

  return getFirestore()
}
