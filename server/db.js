import pg from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const { Pool } = pg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function projectScopedId(record) {
  return `${record.projeto_id}_${record.id_prevision}`
}

const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE || 'dadosprevision',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
    }

const pool = new Pool({
  ...connection,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('Erro inesperado no pool PostgreSQL:', err)
})

export async function query(text, params) {
  const start = Date.now()
  const res = await pool.query(text, params)
  const duration = Date.now() - start
  if (duration > 500) {
    console.warn(`Query lenta (${duration}ms): ${text.slice(0, 100)}...`)
  }
  return res
}

export async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback((text, params) => client.query(text, params))
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function initDb() {
  console.log('Inicializando esquema PostgreSQL...')
  const schemaPath = path.join(__dirname, 'schema.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
  await query(schemaSql)
  console.log('Esquema PostgreSQL verificado e pronto com sucesso.')
}

export async function getProjects() {
  const { rows } = await query(
    'SELECT * FROM projetos ORDER BY nome_projeto ASC',
  )
  return rows.map((r) => ({
    ...r,
    firestore_id: r.id_prevision,
  }))
}

export async function getProject(projectId) {
  const { rows } = await query(
    'SELECT * FROM projetos WHERE id_prevision = $1 LIMIT 1',
    [projectId],
  )
  return rows[0] || null
}

export async function getActivities({ projectId = '', page = 0, pageSize = 100, isGestaoVista = false } = {}) {
  let where = ''
  const params = []

  if (projectId) {
    params.push(projectId)
    where = 'WHERE projeto_id = $1'
  }

  if (isGestaoVista) {
    const { rows } = await query(
      `SELECT
         a.*,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'data_medicao', m.data_medicao,
                 'progresso_realizado', m.progresso_realizado
               )
               ORDER BY m.data_medicao ASC, m.id_prevision ASC
             )
             FROM medicoes m
             WHERE m.projeto_id = a.projeto_id
               AND m.atividade_id = a.id_prevision
               AND m.data_medicao IS NOT NULL
           ),
           '[]'::jsonb
         ) AS medicoes
       FROM atividades a
       ${projectId ? 'WHERE a.projeto_id = $1' : ''}
       ORDER BY a.posicao_servico ASC, a.posicao_pavimento ASC, a.servico_nome ASC, a.pavimento_nome ASC
       LIMIT 5000`,
      params,
    )
    return {
      records: rows.map((r) => ({ ...r.raw_data, ...r, firestore_id: projectScopedId(r) })),
      hasMore: false,
    }
  }

  const offset = page * pageSize
  params.push(pageSize + 1)
  params.push(offset)

  const limitParamIdx = params.length - 1
  const offsetParamIdx = params.length

  const sql = `SELECT * FROM atividades ${where} ORDER BY posicao_servico ASC, posicao_pavimento ASC, servico_nome ASC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`
  const { rows } = await query(sql, params)

  const hasMore = rows.length > pageSize
  const records = rows
    .slice(0, pageSize)
    .map((r) => ({ ...r.raw_data, ...r, firestore_id: projectScopedId(r) }))

  return { records, hasMore }
}

export async function getActivityJobs({ projectId = '', page = 0, pageSize = 100 } = {}) {
  const { records: activities, hasMore } = await getActivities({ projectId, page, pageSize })
  const records = activities.flatMap((activity) =>
    (activity.microservicos || []).map((job) => ({
      ...job,
      firestore_id: `${activity.projeto_id}_${activity.id_prevision}_${job.id_prevision}`,
      projeto_id: activity.projeto_id,
      projeto_nome: activity.projeto_nome,
      atividade_id: activity.id_prevision,
      atividade_eap: activity.codigo_eap,
      servico_nome: activity.servico_nome,
      pavimento_nome: activity.pavimento_nome,
    })),
  )
  return { records, hasMore }
}

export async function getGenericTable(tableName, { projectId = '', page = 0, pageSize = 100, date = '' } = {}) {
  const conditions = []
  const params = []

  if (projectId) {
    params.push(projectId)
    conditions.push(`projeto_id = $${params.length}`)
  }

  if (date) {
    params.push(date)
    conditions.push(`data_medicao = $${params.length}`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = page * pageSize
  params.push(pageSize + 1)
  params.push(offset)

  const sql = `SELECT * FROM ${tableName} ${where} ORDER BY id_prevision ASC LIMIT $${params.length - 1} OFFSET $${params.length}`
  const { rows } = await query(sql, params)

  const hasMore = rows.length > pageSize
  const records = rows
    .slice(0, pageSize)
    .map((r) => ({ ...r.raw_data, ...r, firestore_id: projectScopedId(r) }))

  return { records, hasMore }
}

export async function getCffData({ projectId = '', page = 0, pageSize = 100 } = {}) {
  const { records: cffRecords, hasMore } = await getGenericTable('cff_itens', { projectId, page, pageSize })

  let summaries = []
  const { rows: analiticoRows } = await query(
    projectId
      ? 'SELECT cff_resumo FROM analiticos WHERE projeto_id = $1'
      : 'SELECT cff_resumo FROM analiticos',
    projectId ? [projectId] : [],
  )

  summaries = analiticoRows.flatMap((r) => r.cff_resumo || [])

  return {
    records: cffRecords,
    summary: summaries,
    hasMore,
  }
}

export async function getAnalyticsData(type, { projectId = '', page = 0, pageSize = 100 } = {}) {
  const fieldMap = {
    budgets: 'orcamentos',
    dashboard: 'dashboard_geral',
    dashboardWeekly: 'dashboard_semanal',
    dashboardMonthly: 'dashboard_mensal',
    dashboardServices: 'dashboard_servicos',
    dashboardFloors: 'dashboard_lotes',
    dashboardStates: 'dashboard_estados',
  }

  const field = fieldMap[type] || 'dashboard_geral'
  const { rows } = await query(
    projectId
      ? `SELECT ${field} FROM analiticos WHERE projeto_id = $1`
      : `SELECT ${field} FROM analiticos`,
    projectId ? [projectId] : [],
  )

  const allRecords = rows.flatMap((r) => r[field] || [])
  const start = page * pageSize
  const records = allRecords.slice(start, start + pageSize).map((item, idx) => ({
    ...item,
    firestore_id: item.id_prevision
      ? `${item.projeto_id || projectId}_${item.id_prevision}`
      : `${item.projeto_id || projectId}_${type}_${start + idx}`,
  }))

  return {
    records,
    hasMore: start + pageSize < allRecords.length,
  }
}

export async function getCurveConfig(projectId) {
  const { rows } = await query(
    'SELECT config FROM curvas_config WHERE projeto_id = $1 LIMIT 1',
    [projectId],
  )
  return rows[0]?.config || null
}

export async function saveCurveConfig(projectId, config) {
  await query(
    `INSERT INTO curvas_config (projeto_id, config, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (projeto_id)
     DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [projectId, JSON.stringify(config)],
  )
  return config
}

export async function getRestrictions({ projectId = '', page = 0, pageSize = 100 } = {}) {
  const { rows } = await query(
    projectId
      ? 'SELECT restricoes FROM projetos WHERE id_prevision = $1'
      : 'SELECT restricoes FROM projetos',
    projectId ? [projectId] : [],
  )

  const allRecords = rows.flatMap((r) => r.restricoes || [])
  const start = page * pageSize
  const records = allRecords.slice(start, start + pageSize).map((item, idx) => ({
    ...item,
    firestore_id: item.id_prevision
      ? `${item.projeto_id || projectId}_${item.id_prevision}`
      : `${item.projeto_id || projectId}_restricao_${start + idx}`,
  }))

  return {
    records,
    hasMore: start + pageSize < allRecords.length,
  }
}

export default pool
