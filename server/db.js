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
  const selectFields = type === 'dashboardMonthly' ? `${field}, curvas_linhas_base` : field
  const { rows } = await query(
    projectId
      ? `SELECT ${selectFields} FROM analiticos WHERE projeto_id = $1`
      : `SELECT ${selectFields} FROM analiticos`,
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
    baselines: type === 'dashboardMonthly'
      ? [...new Map(rows.flatMap((row) => row.curvas_linhas_base || []).map((item) => [String(item.id), item])).values()]
      : [],
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

export async function getGlobalCurveConfig() {
  const { rows } = await query('SELECT config FROM curvas_config_global WHERE id = TRUE LIMIT 1')
  return rows[0]?.config || null
}

export async function saveGlobalCurveConfig(config) {
  await query(
    `INSERT INTO curvas_config_global (id, config, updated_at)
     VALUES (TRUE, $1::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [JSON.stringify(config)],
  )
  return config
}

export async function getAppPreferences() {
  const { rows } = await query('SELECT config FROM app_preferences WHERE id = TRUE LIMIT 1')
  return rows[0]?.config || null
}

export async function saveAppPreferences(config) {
  await query(
    `INSERT INTO app_preferences (id, config, updated_at)
     VALUES (TRUE, $1::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [JSON.stringify(config)],
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

// ---------------------------------------------------------------------------
// Consultas do Schema Mega (Mega ERP)
// ---------------------------------------------------------------------------

export async function getMegaObras() {
  const sql = `
    SELECT DISTINCT obra, COALESCE(NULLIF(obra_nome, ''), obra) as obra_nome
    FROM (
      SELECT obra, obra_nome FROM mega.pedidos_compra WHERE obra IS NOT NULL
      UNION
      SELECT obra, obra_nome FROM mega.visualizacao_itens WHERE obra IS NOT NULL
      UNION
      SELECT obra, obra_nome FROM mega.analise_realizado WHERE obra IS NOT NULL
      UNION
      SELECT obra, obra_nome FROM mega.itens_solicitados WHERE obra IS NOT NULL
      UNION
      SELECT obra, obra_nome FROM mega.solicitacoes_por_etapa WHERE obra IS NOT NULL
      UNION
      SELECT obra, observacao as obra_nome FROM mega.obra_projeto WHERE obra IS NOT NULL
    ) sub
    ORDER BY obra ASC;
  `
  const { rows } = await query(sql)
  return rows
}

export async function getMegaSummary(obra = '') {
  const params = obra ? [obra] : []
  const whereObra = obra ? 'WHERE obra = $1' : ''

  const queries = [
    query(`SELECT COUNT(*) as count FROM mega.pedidos_compra ${whereObra}`, params),
    query(`SELECT COUNT(*) as count FROM mega.visualizacao_itens ${whereObra}`, params),
    query(`SELECT COUNT(*) as count FROM mega.analise_pedidos_hist ${whereObra}`, params),
    query(`SELECT COUNT(*) as count FROM mega.analise_contratos_hist ${whereObra}`, params),
    query(`SELECT COUNT(*) as count FROM mega.analise_realizado ${whereObra}`, params),
    query(`SELECT COUNT(*) as count FROM mega.itens_solicitados ${whereObra}`, params),
    query(`SELECT COUNT(*) as count FROM mega.solicitacoes_por_etapa ${whereObra}`, params),
    query(`SELECT MAX(data_extracao) as ultima_data FROM mega.carga WHERE bloqueado = FALSE`),
  ]
  const [pedidos, visItens, saldoPedidos, saldoContratos, saldoRealizado, itensSolic, solicitacoesEtapa, carga] =
    await Promise.all(queries)

  return {
    totalPedidosCompra: Number(pedidos.rows[0]?.count || 0),
    totalVisualizacaoItens: Number(visItens.rows[0]?.count || 0),
    totalSaldoPedidos: Number(saldoPedidos.rows[0]?.count || 0),
    totalSaldoContratos: Number(saldoContratos.rows[0]?.count || 0),
    totalSaldoRealizado: Number(saldoRealizado.rows[0]?.count || 0),
    totalItensSolicitados: Number(itensSolic.rows[0]?.count || 0),
    totalSolicitacoesEtapa: Number(solicitacoesEtapa.rows[0]?.count || 0),
    ultimaExtracao: carga.rows[0]?.ultima_data || null,
  }
}

const MEGA_TABLE_MAP = {
  pedidos_compra: {
    table: 'mega.pedidos_compra',
    hasObra: true,
    orderBy: 'data_extracao DESC, numero_do_pedido DESC, item_pedido ASC',
    searchColumns: ['CAST(numero_do_pedido AS TEXT)', 'nome_fantasia', 'descricao_do_item', 'situacao_do_pedido'],
  },
  visualizacao_itens: {
    table: 'mega.visualizacao_itens',
    hasObra: true,
    orderBy: 'data_extracao DESC, solicitacao DESC, sequencia ASC',
    searchColumns: ['CAST(solicitacao AS TEXT)', 'fornecedor', 'descricao', 'situacao_do_item', 'CAST(cod_item AS TEXT)'],
  },
  analise_pedidos: {
    table: 'mega.analise_pedidos_hist',
    hasObra: true,
    orderBy: 'data_extracao DESC, codigo_pedido DESC',
    searchColumns: [
      'CAST(codigo_pedido AS TEXT)',
      'fornecedor',
      "COALESCE(raw_data->>'descricao_insumo', '')",
      "COALESCE(raw_data->>'cod_insumo', '')",
      "COALESCE(raw_data->>'descricao', '')",
      "COALESCE(raw_data->>'cod_item', '')",
    ],
  },
  analise_contratos: {
    table: 'mega.analise_contratos_hist',
    hasObra: true,
    orderBy: 'data_extracao DESC, codigo_contrato DESC',
    searchColumns: [
      'CAST(codigo_contrato AS TEXT)',
      'fornecedor',
      'status_pre_contrato',
      "COALESCE(raw_data->>'descricao_insumo', '')",
      "COALESCE(raw_data->>'cod_insumo', '')",
      "COALESCE(raw_data->>'descricao', '')",
      "COALESCE(raw_data->>'cod_item', '')",
    ],
  },
  analise_realizado: {
    table: 'mega.analise_realizado',
    hasObra: true,
    orderBy: 'data_extracao DESC, id DESC',
    searchColumns: [
      'CAST(documento AS TEXT)',
      'fornecedor',
      "COALESCE(raw_data->>'desc_item_compra', '')",
      "COALESCE(raw_data->>'cod_item_compra', '')",
      "COALESCE(raw_data->>'descricao', '')",
      "COALESCE(raw_data->>'cod_item', '')",
    ],
  },
  itens_solicitados: {
    table: 'mega.itens_solicitados',
    hasObra: true,
    orderBy: 'data_extracao DESC, codigo_solicitacao DESC, sequencial_item ASC',
    searchColumns: ['CAST(codigo_solicitacao AS TEXT)', 'CAST(numero_rm AS TEXT)', 'descricao_do_item', 'situacao_do_item'],
  },
  solicitacoes_por_etapa: {
    table: 'mega.solicitacoes_por_etapa',
    hasObra: true,
    orderBy: 'data_extracao DESC, codigo_solicitacao DESC, sequencial_item ASC',
    searchColumns: [
      'CAST(codigo_solicitacao AS TEXT)',
      'codigo_etapa',
      'CAST(numero_insumo AS TEXT)',
      'descricao_insumo',
      'projeto',
      'situacao_do_item',
    ],
  },
  cargas: {
    table: 'mega.carga',
    hasObra: false,
    orderBy: 'id DESC',
    searchColumns: ['relatorio', 'arquivo', 'motivo_bloqueio'],
  },
}

export async function getMegaTable(tableType, { obra = '', page = 0, pageSize = 50, search = '' } = {}) {
  const meta = MEGA_TABLE_MAP[tableType]
  if (!meta) {
    throw new Error(`Tabela Mega desconhecida: ${tableType}`)
  }

  const conditions = []
  const params = []

  if (meta.hasObra && obra) {
    params.push(obra)
    conditions.push(`obra = $${params.length}`)
  }

  if (search && meta.searchColumns.length > 0) {
    params.push(`%${search.trim().toLowerCase()}%`)
    const searchParamIdx = params.length
    const orClauses = meta.searchColumns.map((col) => `LOWER(${col}) LIKE $${searchParamIdx}`)
    conditions.push(`(${orClauses.join(' OR ')})`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Contagem total
  const countSql = `SELECT COUNT(*) as total FROM ${meta.table} ${whereClause}`
  const countRes = await query(countSql, params)
  const total = Number(countRes.rows[0]?.total || 0)

  // Consulta paginada
  const offset = page * pageSize
  params.push(pageSize)
  const limitIdx = params.length
  params.push(offset)
  const offsetIdx = params.length

  const dataSql = `
    SELECT * FROM ${meta.table}
    ${whereClause}
    ORDER BY ${meta.orderBy}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `
  const { rows } = await query(dataSql, params)

  return {
    records: rows,
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
  }
}

export default pool

