import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import {
  initDb,
  getProjects,
  getActivities,
  getActivityJobs,
  getGenericTable,
  getCffData,
  getAnalyticsData,
  getRestrictions,
} from './db.js'
import { syncProjects } from './sync.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT) || 3000

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() })
})

// Projects
app.get('/api/projects', async (_req, res) => {
  try {
    const projects = await getProjects()
    res.json({ ok: true, projects })
  } catch (err) {
    console.error('Erro em /api/projects:', err)
    res.status(500).json({ error: err.message || 'Erro ao carregar projetos' })
  }
})

// Unified Data Query endpoint
app.get('/api/data', async (req, res) => {
  try {
    const type = String(req.query.type || '')
    const page = Math.max(0, Number(req.query.page) || 0)
    const pageSize = Math.min(200, Math.max(10, Number(req.query.limit) || 100))
    const projectId = String(req.query.projectId || '')
    const date = String(req.query.date || '')

    if (type === 'gestaoVista') {
      const data = await getActivities({ projectId, isGestaoVista: true })
      const milestones = await getGenericTable('marcos', {
        projectId,
        page: 0,
        pageSize: 5000,
      })
      return res.json({
        ok: true,
        type,
        records: data.records,
        milestones: milestones.records,
        hasMore: false,
      })
    }

    if (type === 'activities') {
      const data = await getActivities({ projectId, page, pageSize })
      return res.json({ ok: true, type, records: data.records, page, hasMore: data.hasMore })
    }

    if (type === 'activityJobs') {
      const data = await getActivityJobs({ projectId, page, pageSize })
      return res.json({ ok: true, type, records: data.records, page, hasMore: data.hasMore })
    }

    if (type === 'dashboardCff' || type === 'budgetItems') {
      const data = await getCffData({ projectId, page, pageSize })
      return res.json({ ok: true, type, records: data.records, summary: data.summary, page, hasMore: data.hasMore })
    }

    if (type === 'restrictions') {
      const data = await getRestrictions({ projectId, page, pageSize })
      return res.json({ ok: true, type, records: data.records, page, hasMore: data.hasMore })
    }

    if (
      [
        'budgets',
        'dashboard',
        'dashboardWeekly',
        'dashboardMonthly',
        'dashboardServices',
        'dashboardFloors',
        'dashboardStates',
      ].includes(type)
    ) {
      const data = await getAnalyticsData(type, { projectId, page, pageSize })
      return res.json({ ok: true, type, records: data.records, page, hasMore: data.hasMore })
    }

    const tableMap = {
      floors: 'pavimentos',
      services: 'servicos',
      milestones: 'marcos',
      baselines: 'linhas_base',
      responsibles: 'responsaveis',
      budgetWeights: 'pesos_orcamento',
      measurements: 'medicoes',
    }

    const tableName = tableMap[type]
    if (tableName) {
      const data = await getGenericTable(tableName, { projectId, page, pageSize, date })
      return res.json({ ok: true, type, records: data.records, page, hasMore: data.hasMore })
    }

    return res.status(400).json({ error: `Tipo de dado desconhecido: ${type}` })
  } catch (err) {
    console.error('Erro em /api/data:', err)
    res.status(500).json({ error: err.message || 'Erro ao consultar dados' })
  }
})

// Sync endpoint
app.post('/api/sync-prevision', async (req, res) => {
  try {
    const apiKey = process.env.PREVISION_API_KEY
    const restToken = process.env.PREVISION_REST_TOKEN || ''
    const projectId = req.body?.projectId ? String(req.body.projectId) : ''

    if (!apiKey) {
      return res.status(400).json({ error: 'PREVISION_API_KEY nao configurada no servidor.' })
    }

    const totals = await syncProjects(apiKey, restToken, projectId)
    return res.json({ ok: true, imported: totals.projects, totals })
  } catch (err) {
    console.error('Erro em /api/sync-prevision:', err)
    res.status(500).json({ error: err.message || 'Erro ao sincronizar com a Prevision' })
  }
})

// Static files (SPA React / Vite)
const distPath = path.join(__dirname, '../dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// Start server and cron
async function start() {
  try {
    await initDb()

    // Cron job for automatic sync (Default: Every day at 06:00 and 18:00)
    const schedule = process.env.CRON_SYNC_SCHEDULE || '0 6,18 * * *'
    if (cron.validate(schedule)) {
      cron.schedule(schedule, async () => {
        console.log(`[CRON] Executando sincronizacao automatica (${new Date().toISOString()})...`)
        const apiKey = process.env.PREVISION_API_KEY
        const restToken = process.env.PREVISION_REST_TOKEN || ''
        if (apiKey) {
          await syncProjects(apiKey, restToken).catch((err) =>
            console.error('[CRON] Erro na sincronizacao automatica:', err),
          )
        }
      })
      console.log(`Agendador CRON ativo com regra: ${schedule}`)
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Servidor Dados Prevision rodando em http://0.0.0.0:${PORT}`)
    })
  } catch (err) {
    console.error('Falha fatal ao iniciar servidor:', err)
    process.exit(1)
  }
}

start()
