function sanitizePrevisionApiKey(value) {
  return value
    .trim()
    .replace(/^PREVISION_API_KEY=/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^(token|bearer)\s+/i, '')
    .trim()
}

export default function handler(_req, res) {
  const rawPrevisionKey = process.env.PREVISION_API_KEY || ''
  const previsionKey = rawPrevisionKey ? sanitizePrevisionApiKey(rawPrevisionKey) : ''
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || ''

  return res.status(200).json({
    previsionApiMode: process.env.PREVISION_API_MODE || 'graphql-default',
    previsionApiKeyConfigured: Boolean(rawPrevisionKey),
    previsionApiKeyLength: previsionKey.length,
    previsionApiKeyPrefix: previsionKey ? `${previsionKey.slice(0, 3)}...` : null,
    previsionProjectsQueryOverride: Boolean(process.env.PREVISION_PROJECTS_QUERY),
    firebaseServiceAccountConfigured: Boolean(serviceAccount),
    firebaseServiceAccountLength: serviceAccount.length,
  })
}
