import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')

async function loadBackendEnvironment() {
  const environmentFile = await readFile(resolve(projectRoot, 'vercel-env-backend.txt'), 'utf8')

  for (const line of environmentFile.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim()
    }
  }

  const serviceAccountJson = await readFile(
    resolve(projectRoot, 'service-account-dadosprevision.json'),
  )
  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = serviceAccountJson.toString('base64')
  process.env.PREVISION_API_MODE = 'graphql'
}

function createResponse() {
  return {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      if (this.statusCode >= 400) {
        throw new Error(payload.error || `Erro HTTP ${this.statusCode}.`)
      }

      return payload
    },
  }
}

await loadBackendEnvironment()

const [{ default: syncHandler }, { getDb }] = await Promise.all([
  import('../api/sync-prevision.js'),
  import('../lib/firebase-admin.js'),
])

const result = await syncHandler({ method: 'POST' }, createResponse())
const snapshot = await getDb().collection('prevision_projetos').get()

console.log(`${result.imported} projeto(s) recebidos da Prevision.`)
console.log(`${snapshot.size} documento(s) salvos no Firestore.`)

if (result.totals) {
  console.log(`${result.totals.activities} atividade(s).`)
  console.log(`${result.totals.floors} pavimento(s).`)
  console.log(`${result.totals.services} servico(s).`)
  console.log(`${result.totals.milestones} marco(s).`)
  console.log(`${result.totals.baselines} linha(s) de base.`)
  console.log(`${result.totals.responsibles} responsavel(is).`)
}
