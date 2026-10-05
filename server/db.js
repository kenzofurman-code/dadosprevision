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
  const { carregarPadraoSeVazio } = await import('./contratacoes-db.js')
  const grupos = await carregarPadraoSeVazio()
  if (grupos) console.log(`Padrão de grupos de contratação carregado: ${grupos} grupos.`)
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
      SELECT obra, obra_nome FROM mega.medicoes_contratos WHERE obra IS NOT NULL
      UNION
      SELECT obra, obra_nome FROM mega.contratos_itens WHERE obra IS NOT NULL
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
    query(`SELECT COUNT(*) as count FROM mega.contratos_itens ${whereObra}`, params),
    query(`SELECT COUNT(*) as count FROM mega.medicoes_contratos ${whereObra}`, params),
    query(
      `SELECT COUNT(*) as count FROM (
         SELECT DISTINCT obra, solicitacao, sequencia
         FROM mega.visualizacao_itens
         ${whereObra}
       ) conciliacao`,
      params,
    ),
    query(`SELECT MAX(data_extracao) as ultima_data FROM mega.carga WHERE bloqueado = FALSE`),
  ]
  const [pedidos, visItens, saldoPedidos, saldoContratos, saldoRealizado, itensSolic, solicitacoesEtapa, followItens, medicoesContratos, conciliacao, carga] =
    await Promise.all(queries)

  return {
    totalPedidosCompra: Number(pedidos.rows[0]?.count || 0),
    totalVisualizacaoItens: Number(visItens.rows[0]?.count || 0),
    totalSaldoPedidos: Number(saldoPedidos.rows[0]?.count || 0),
    totalSaldoContratos: Number(saldoContratos.rows[0]?.count || 0),
    totalSaldoRealizado: Number(saldoRealizado.rows[0]?.count || 0),
    totalItensSolicitados: Number(itensSolic.rows[0]?.count || 0),
    totalSolicitacoesEtapa: Number(solicitacoesEtapa.rows[0]?.count || 0),
    totalFollowItensContratos: Number(followItens.rows[0]?.count || 0),
    totalMedicoesContratos: Number(medicoesContratos.rows[0]?.count || 0),
    totalConciliacaoContratacoes: Number(conciliacao.rows[0]?.count || 0),
    ultimaExtracao: carga.rows[0]?.ultima_data || null,
  }
}

const ETAPA_PREVISION_PARA_MEGA = (col) =>
  `REGEXP_REPLACE(${col}, '^(\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d{2}\\.)(\\d{2})$', '\\10\\2')`

function megaConciliacaoCtes({ obraParam, projectParam }) {
  const visualObra = obraParam ? `WHERE v.obra = $${obraParam}` : ''
  const requestObra = obraParam ? `WHERE i.obra = $${obraParam}` : ''
  const stageObra = obraParam ? `WHERE s.obra = $${obraParam}` : ''
  const approvalObra = obraParam ? `WHERE a.obra = $${obraParam}` : ''
  const occurrenceObra = obraParam ? `WHERE o.obra = $${obraParam}` : ''
  const planningFilter = projectParam ? `WHERE a.projeto_id = $${projectParam}` : 'WHERE FALSE'
  const cffFilter = projectParam ? `WHERE c.projeto_id = $${projectParam}` : 'WHERE FALSE'

  return `
    WITH visual_atual AS (
      SELECT
        v.obra,
        v.solicitacao,
        v.sequencia,
        MAX(v.obra_nome) AS obra_nome,
        MAX(v.data_extracao) AS data_extracao,
        MAX(v.orcamento) AS orcamento,
        MAX(v.fornecedor) AS fornecedor,
        MAX(v.cod_item) AS cod_item,
        MAX(v.descricao) AS descricao,
        MAX(v.qtde_solicitada) AS qtde_solicitada,
        MIN(v.data_de_necessidade) AS data_de_necessidade,
        MIN(v.data_inclusao)::date AS data_inclusao,
        MAX(v.valor_total) AS valor_solicitado,
        MAX(v.situacao_do_item) AS situacao_do_item,
        MAX(v.cod_cotacao) AS cod_cotacao,
        MAX(v.cod_pedido) AS cod_pedido,
        MAX(v.cod_contrato) AS cod_contrato,
        COUNT(DISTINCT NULLIF(v.fornecedor, '')) AS fornecedores_encontrados
      FROM mega.visualizacao_itens v
      ${visualObra}
      GROUP BY v.obra, v.solicitacao, v.sequencia
    ),
    request_atual AS (
      SELECT DISTINCT ON (i.obra, COALESCE(i.numero_rm, i.codigo_solicitacao), i.sequencial_item)
        i.obra,
        i.obra_nome,
        i.codigo_solicitacao,
        i.numero_rm,
        i.sequencial_item,
        i.data_de_emissao,
        i.situacao_do_item,
        i.descricao_do_item,
        i.quantidade_solicitada,
        i.quantidade_baixada,
        i.unidade,
        i.data_extracao
      FROM mega.itens_solicitados i
      ${requestObra}
      ORDER BY i.obra, COALESCE(i.numero_rm, i.codigo_solicitacao), i.sequencial_item, i.data_extracao DESC
    ),
    stage_map AS (
      SELECT
        s.obra,
        s.codigo_solicitacao,
        s.sequencial_item,
        STRING_AGG(DISTINCT NULLIF(s.codigo_etapa, ''), ', ' ORDER BY NULLIF(s.codigo_etapa, '')) AS codigo_etapa,
        STRING_AGG(DISTINCT NULLIF(s.projeto, ''), ', ' ORDER BY NULLIF(s.projeto, '')) AS projeto_mega,
        STRING_AGG(DISTINCT NULLIF(s.descricao_insumo, ''), ' | ' ORDER BY NULLIF(s.descricao_insumo, '')) AS descricao_insumo,
        MIN(s.data_de_necessidade) AS etapa_data_necessidade
      FROM mega.solicitacoes_por_etapa s
      ${stageObra}
      GROUP BY s.obra, s.codigo_solicitacao, s.sequencial_item
    ),
    approval_docs AS (
      SELECT
        a.obra,
        a.numero,
        MIN(a.data_envio_aprovacao) AS data_envio_aprovacao,
        COUNT(*)::integer AS documentos_approvo,
        STRING_AGG(DISTINCT NULLIF(a.tipo_documento, ''), ', ' ORDER BY NULLIF(a.tipo_documento, '')) AS tipos_documento
      FROM mega.approvo_documentos a
      ${approvalObra}
      GROUP BY a.obra, a.numero
    ),
    approval_events AS (
      SELECT
        o.obra,
        o.numero_documento,
        MAX(COALESCE(o.data_hora::date, o.data_aprovacao)) AS ultima_aprovacao,
        COUNT(*)::integer AS quantidade_aprovacoes,
        STRING_AGG(DISTINCT NULLIF(o.aprovador, ''), ', ' ORDER BY NULLIF(o.aprovador, '')) AS aprovadores,
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'acao', o.acao,
            'aprovador', o.aprovador,
            'data', COALESCE(o.data_hora::date, o.data_aprovacao),
            'hora', o.hora_aprovacao,
            'tipo_documento', o.tipo_documento
          ) ORDER BY COALESCE(o.data_hora, o.data_aprovacao::timestamp), o.aprovador
        ) AS eventos
      FROM mega.approvo_ocorrencias o
      ${occurrenceObra}
      GROUP BY o.obra, o.numero_documento
    ),
    pedido_valores AS (
      SELECT
        p.obra,
        p.numero_do_pedido,
        SUM(COALESCE(p.total_pedido_compra, 0)) AS valor_pedido_documento,
        MAX(p.dt_emissao) AS data_pedido
      FROM mega.pedidos_compra p
      ${obraParam ? `WHERE p.obra = $${obraParam}` : ''}
      GROUP BY p.obra, p.numero_do_pedido
    ),
    contrato_valores AS (
      SELECT
        c.obra,
        c.cod_contrato,
        SUM(COALESCE(c.total_contratado, c.total_item, 0)) AS valor_contrato_documento,
        MAX(c.data_extracao) AS data_contrato
      FROM mega.contratos_itens c
      ${obraParam ? `WHERE c.obra = $${obraParam}` : ''}
      GROUP BY c.obra, c.cod_contrato
    ),
    -- A etapa do Mega (XX.XX.XX.XX.XXX) e o codigo do ORCAMENTO Prevision
    -- (XX.XX.XX.XX.XX) com um zero a mais no ultimo nivel. O orcamento liga
    -- as tarefas do cronograma por pesos_orcamento.id_atividade.
    atividade_plano AS (
      SELECT
        ${ETAPA_PREVISION_PARA_MEGA('p.codigo')} AS codigo_eap,
        MIN(a.data_inicio) AS atividade_inicio,
        MAX(a.data_fim) AS atividade_fim,
        STRING_AGG(DISTINCT NULLIF(a.servico_nome, ''), ' | ' ORDER BY NULLIF(a.servico_nome, '')) AS tarefas_prevision
      FROM pesos_orcamento p
      JOIN atividades a
        ON a.projeto_id = p.projeto_id
       AND a.id_prevision = p.id_atividade
      ${planningFilter.replace('a.projeto_id', 'p.projeto_id')}
      GROUP BY 1
    ),
    cff_plano AS (
      SELECT
        ${ETAPA_PREVISION_PARA_MEGA('c.codigo')} AS codigo,
        SUM(COALESCE(c.custo_total, 0)) AS valor_orcamento_prevision,
        MAX(c.orcamento_nome) AS orcamento_nome
      FROM cff_itens c
      ${cffFilter}
      GROUP BY 1
    ),
    processos_base AS (
      SELECT
        COALESCE(v.obra, r.obra) AS obra,
        COALESCE(v.obra_nome, r.obra_nome) AS obra_nome,
        COALESCE(v.solicitacao, r.numero_rm, r.codigo_solicitacao) AS solicitacao,
        COALESCE(v.sequencia, r.sequencial_item) AS sequencia,
        COALESCE(v.data_extracao, r.data_extracao) AS data_extracao,
        COALESCE(v.orcamento, 0) AS orcamento,
        COALESCE(v.cod_item, s.codigo_solicitacao) AS cod_item,
        COALESCE(v.descricao, r.descricao_do_item, s.descricao_insumo) AS descricao,
        COALESCE(v.qtde_solicitada, r.quantidade_solicitada) AS quantidade_solicitada,
        COALESCE(v.data_inclusao, r.data_de_emissao, s.etapa_data_necessidade) AS data_solicitacao,
        COALESCE(v.data_de_necessidade, s.etapa_data_necessidade) AS data_de_necessidade,
        COALESCE(v.situacao_do_item, r.situacao_do_item) AS situacao_do_item,
        v.fornecedor,
        v.fornecedores_encontrados,
        v.cod_cotacao,
        v.cod_pedido,
        v.cod_contrato,
        v.valor_solicitado,
        s.codigo_etapa,
        s.projeto_mega,
        s.descricao_insumo,
        p.valor_pedido_documento,
        p.data_pedido,
        c.valor_contrato_documento,
        c.data_contrato,
        ap.codigo_eap AS codigo_eap_prevision,
        ap.atividade_inicio,
        ap.atividade_fim,
        ap.tarefas_prevision,
        cp.valor_orcamento_prevision,
        cp.orcamento_nome
      FROM visual_atual v
      FULL OUTER JOIN request_atual r
        ON r.obra = v.obra
       AND COALESCE(r.numero_rm, r.codigo_solicitacao) = v.solicitacao
       AND r.sequencial_item = v.sequencia
      LEFT JOIN stage_map s
        ON s.obra = COALESCE(v.obra, r.obra)
       AND s.sequencial_item = COALESCE(v.sequencia, r.sequencial_item)
       AND s.codigo_solicitacao IN (v.solicitacao, r.numero_rm, r.codigo_solicitacao)
      LEFT JOIN pedido_valores p
        ON p.obra = COALESCE(v.obra, r.obra)
       AND p.numero_do_pedido = v.cod_pedido
      LEFT JOIN contrato_valores c
        ON c.obra = COALESCE(v.obra, r.obra)
       AND c.cod_contrato = v.cod_contrato
      LEFT JOIN atividade_plano ap
        ON ap.codigo_eap = s.codigo_etapa
      LEFT JOIN cff_plano cp
        ON cp.codigo = s.codigo_etapa
    )
  `
}

export async function getMegaConciliacao({ obra = '', projectId = '', page = 0, pageSize = 50, search = '' } = {}) {
  if (!projectId && obra) {
    const par = await query('SELECT id_prevision FROM mega.obra_projeto WHERE obra = $1', [obra])
    projectId = par.rows[0]?.id_prevision || ''
  }
  const params = []
  const obraParam = obra ? (params.push(obra), params.length) : null
  const projectParam = projectId ? (params.push(projectId), params.length) : null
  const searchParam = search ? (params.push(`%${search.trim().toLowerCase()}%`), params.length) : null
  const ctes = megaConciliacaoCtes({ obraParam, projectParam })
  const searchClause = searchParam
    ? `WHERE LOWER(CONCAT_WS(' ', c.obra, c.solicitacao, c.sequencia, c.codigo_etapa, c.codigo_eap_prevision, c.cod_item, c.descricao, c.fornecedor, c.cod_pedido, c.cod_contrato, c.status_processo)) LIKE $${searchParam}`
    : ''
  const base = `
    SELECT
      c.*,
      CASE
        WHEN c.atividade_inicio IS NULL THEN 'SEM VÍNCULO AO CRONOGRAMA'
        WHEN c.cod_contrato IS NOT NULL THEN 'CONTRATO DE MÃO DE OBRA'
        WHEN c.cod_pedido IS NOT NULL THEN 'PEDIDO DE COMPRA'
        WHEN c.solicitacao IS NULL THEN 'SEM SOLICITAÇÃO'
        WHEN c.atividade_inicio < CURRENT_DATE THEN 'ATENÇÃO: ATIVIDADE INICIADA'
        ELSE 'SOLICITAÇÃO EM ANDAMENTO'
      END AS status_processo,
      CASE
        WHEN c.cod_contrato IS NOT NULL THEN 'MÃO DE OBRA'
        WHEN c.cod_pedido IS NOT NULL THEN 'MATERIAL'
        ELSE 'A CLASSIFICAR'
      END AS tipo_processo,
      CASE WHEN c.atividade_inicio IS NULL THEN NULL ELSE (c.atividade_inicio - CURRENT_DATE) END AS dias_ate_inicio,
      req_doc.data_envio_aprovacao AS envio_aprovacao_solicitacao,
      req_doc.documentos_approvo AS documentos_approvo_solicitacao,
      req_doc.tipos_documento AS tipos_documento_solicitacao,
      req_event.ultima_aprovacao AS ultima_aprovacao_solicitacao,
      req_event.quantidade_aprovacoes AS quantidade_aprovacoes_solicitacao,
      req_event.aprovadores AS aprovadores_solicitacao,
      po_event.ultima_aprovacao AS ultima_aprovacao_pedido,
      contract_event.ultima_aprovacao AS ultima_aprovacao_contrato,
      NULLIF(GREATEST(
        COALESCE(req_event.ultima_aprovacao, req_doc.data_envio_aprovacao, DATE '1900-01-01'),
        COALESCE(po_event.ultima_aprovacao, pdoc.data_envio_aprovacao, DATE '1900-01-01'),
        COALESCE(contract_event.ultima_aprovacao, cdoc.data_envio_aprovacao, DATE '1900-01-01')
      ), DATE '1900-01-01') AS ultima_aprovacao,
      COALESCE(req_event.quantidade_aprovacoes, 0) + COALESCE(po_event.quantidade_aprovacoes, 0) + COALESCE(contract_event.quantidade_aprovacoes, 0) AS quantidade_aprovacoes,
      JSONB_BUILD_OBJECT(
        'solicitacao', COALESCE(req_event.eventos, '[]'::jsonb),
        'pedido', COALESCE(po_event.eventos, '[]'::jsonb),
        'contrato', COALESCE(contract_event.eventos, '[]'::jsonb)
      ) AS eventos_aprovacao,
      CASE
        WHEN c.codigo_eap_prevision IS NULL THEN 'PENDENTE VÍNCULO PREVISION'
        ELSE 'PROJEÇÃO MENSAL PENDENTE'
      END AS situacao_conciliacao
    FROM processos_base c
    LEFT JOIN approval_docs req_doc
      ON req_doc.obra = c.obra AND req_doc.numero = c.solicitacao
    LEFT JOIN approval_events req_event
      ON req_event.obra = c.obra AND req_event.numero_documento = c.solicitacao
    LEFT JOIN approval_docs pdoc
      ON pdoc.obra = c.obra AND pdoc.numero = c.cod_pedido
    LEFT JOIN approval_events po_event
      ON po_event.obra = c.obra AND po_event.numero_documento = c.cod_pedido
    LEFT JOIN approval_docs cdoc
      ON cdoc.obra = c.obra AND cdoc.numero = c.cod_contrato
    LEFT JOIN approval_events contract_event
      ON contract_event.obra = c.obra AND contract_event.numero_documento = c.cod_contrato
  `

  const countSql = `${ctes} SELECT COUNT(*) AS total FROM (${base}) c ${searchClause}`
  const countRes = await query(countSql, params)
  const total = Number(countRes.rows[0]?.total || 0)

  const offset = page * pageSize
  const dataParams = [...params, pageSize, offset]
  const limitParam = params.length + 1
  const offsetParam = params.length + 2
  const dataSql = `${ctes}
    SELECT * FROM (${base}) c
    ${searchClause}
    ORDER BY c.atividade_inicio NULLS LAST, c.obra ASC, c.solicitacao ASC NULLS LAST, c.sequencia ASC NULLS LAST
    LIMIT $${limitParam} OFFSET $${offsetParam}`
  const { rows } = await query(dataSql, dataParams)

  return {
    records: rows,
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
  }
}

const MEGA_TABLE_MAP = {
  approvo_documentos: {
    table: 'mega.approvo_documentos',
    hasObra: true,
    orderBy: 'data_documento DESC NULLS LAST, numero DESC',
    searchColumns: ['CAST(numero AS TEXT)', 'tipo_documento', 'status', 'solicitante', 'regra_aprovacao'],
  },
  approvo_ocorrencias: {
    table: 'mega.approvo_ocorrencias',
    hasObra: true,
    orderBy: 'data_hora DESC NULLS LAST, id DESC',
    searchColumns: ['CAST(numero_documento AS TEXT)', 'tipo_documento', 'aprovador', 'acao'],
  },
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
  follow_itenscontratos_itens: {
    table: 'mega.contratos_itens',
    hasObra: true,
    orderBy: 'data_extracao DESC, cod_contrato ASC, cod_item ASC, aditivo ASC',
    searchColumns: [
      'CAST(cod_contrato AS TEXT)',
      'CAST(cod_item AS TEXT)',
      'descricao',
      'unidade',
      'situacao',
      'cod_alternativo',
      'consolidador',
    ],
  },
  follow_itenscontratos_medicoes: {
    table: 'mega.medicoes_contratos',
    hasObra: true,
    orderBy: 'data_extracao DESC, numero_contrato ASC, numero_medicao ASC, item_sequencial ASC',
    searchColumns: [
      'CAST(numero_contrato AS TEXT)',
      'CAST(numero_medicao AS TEXT)',
      'CAST(item_sequencial AS TEXT)',
      'descricao_servico',
      'unidade',
      'fornecedor_nome',
      'situacao_medicao',
    ],
  },
  follow_itenscontratos_historico: {
    table: 'mega.carga',
    hasObra: false,
    fixedWhere: "relatorio IN ('contratos_itens', 'medicoes_contratos')",
    orderBy: 'executado_em DESC, id DESC',
    searchColumns: ['relatorio', 'arquivo', 'motivo_bloqueio'],
  },
}

export async function getMegaTable(tableType, { obra = '', projectId = '', page = 0, pageSize = 50, search = '' } = {}) {
  if (tableType === 'conciliacao_contratacoes') {
    return getMegaConciliacao({ obra, projectId, page, pageSize, search })
  }

  const meta = MEGA_TABLE_MAP[tableType]
  if (!meta) {
    throw new Error(`Tabela Mega desconhecida: ${tableType}`)
  }

  const conditions = []
  const params = []

  if (meta.fixedWhere) {
    conditions.push(meta.fixedWhere)
  }

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

export async function getMegaCargasStatusDiario(dataInput) {
  // 1. Data alvo (se não enviada, busca a mais recente do banco)
  let data = String(dataInput || '').trim()
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    try {
      const { rows } = await query('SELECT MAX(data_extracao)::text as latest FROM mega.carga')
      data = rows[0]?.latest || new Date().toISOString().slice(0, 10)
    } catch {
      data = new Date().toISOString().slice(0, 10)
    }
  }

  // 2. Datas disponíveis nos últimos 90 dias
  let datasDisponiveis = []
  try {
    const { rows } = await query(
      'SELECT DISTINCT data_extracao::text as data FROM mega.carga ORDER BY data_extracao DESC LIMIT 90'
    )
    datasDisponiveis = rows.map((r) => r.data)
  } catch (err) {
    console.error('Erro ao buscar datas disponíveis de carga:', err)
  }

  // 3. Obras do Mega
  let obras = []
  try {
    const obrasFromDb = await getMegaObras()
    if (Array.isArray(obrasFromDb) && obrasFromDb.length > 0) {
      obras = obrasFromDb.map((o) => ({
        obra: String(o.obra),
        nome: String(o.obra_nome || `Obra ${o.obra}`),
      }))
    }
  } catch (err) {
    console.error('Erro ao buscar obras para status diário:', err)
  }

  if (obras.length === 0) {
    obras = [
      { obra: '340', nome: 'BALNEARIO DE GUARATUBA' },
      { obra: '410', nome: 'PIEMONTE CROMA' },
      { obra: '430', nome: 'PIEMONTE 909' },
      { obra: '480', nome: 'PIEMONTE COMPORTA' },
      { obra: '490', nome: 'PIEMONTE P70 RUA BUENOS AIRES' },
      { obra: '601', nome: 'PIEMONTE P73 RUA GUARATUBA AHU' },
      { obra: '630', nome: 'PIEMONTE P74 CARMELO RANGEL' },
      { obra: '650', nome: 'PIEMONTE P78 CARNEIRO LOBO' },
    ]
  }

  // 4. Definição dos 10 Relatórios
  const relatorios = [
    { key: 'itens_solicitados', label: 'Itens Solicitados', modulo: 'Suprimentos', relatorio: 'itens_solicitados', arquivoPattern: null },
    { key: 'analise_pedidos', label: 'Análise Saldo - Pedidos', modulo: 'Suprimentos', relatorio: 'analise_saldo_solicitacao', arquivoPattern: 'Pedidos' },
    { key: 'analise_contratos', label: 'Análise Saldo - Contratos', modulo: 'Suprimentos', relatorio: 'analise_saldo_solicitacao', arquivoPattern: 'Contratos' },
    { key: 'analise_realizado', label: 'Análise Saldo - Realizado', modulo: 'Suprimentos', relatorio: 'analise_saldo_solicitacao', arquivoPattern: 'Realizado' },
    { key: 'visualizacao_itens', label: 'Visualização de Itens', modulo: 'Suprimentos', relatorio: 'visualizacao_itens', arquivoPattern: null },
    { key: 'pedidos_compra', label: 'Pedidos de Compra', modulo: 'Suprimentos', relatorio: 'pedidos_compra', arquivoPattern: null },
    { key: 'solicitacoes_por_etapa', label: 'Solicitações por Etapa', modulo: 'Suprimentos', relatorio: 'solicitacoes_por_etapa', arquivoPattern: null },
    { key: 'medicoes_contratos', label: 'Medições de Contratos', modulo: 'Contratos', relatorio: 'medicoes_contratos', arquivoPattern: null },
    { key: 'contratos_itens', label: 'Follow-up de Contratos', modulo: 'Contratos', relatorio: 'contratos_itens', arquivoPattern: null },
    { key: 'approvo_completo', label: 'Approvo (Aprovações)', modulo: 'Approvo', relatorio: 'approvo_completo', arquivoPattern: null, isGlobal: true },
  ]

  // 5. Cargas brutas do dia
  let cargas = []
  try {
    const { rows } = await query(
      `SELECT id, relatorio, arquivo, data_extracao::text as data_extracao,
              obras_ok, obras_sem_movimento, obras_falhou, bloqueado, motivo_bloqueio,
              to_char(executado_em, 'HH24:MI:SS') as horario,
              executado_em::text as executado_em
       FROM mega.carga
       WHERE data_extracao = $1
       ORDER BY executado_em ASC, id ASC`,
      [data]
    )
    cargas = rows
  } catch (err) {
    console.error('Erro ao buscar mega.carga do dia:', err)
  }

  // 6. Contagens de registros gravados por tabela e obra no dia
  const contagens = {}
  try {
    const countSql = `
      SELECT 'itens_solicitados' as relatorio_key, obra, count(*)::int as total FROM mega.itens_solicitados WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'analise_pedidos', obra, count(*)::int FROM mega.analise_pedidos_hist WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'analise_contratos', obra, count(*)::int FROM mega.analise_contratos_hist WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'analise_realizado', obra, count(*)::int FROM mega.analise_realizado WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'visualizacao_itens', obra, count(*)::int FROM mega.visualizacao_itens WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'pedidos_compra', obra, count(*)::int FROM mega.pedidos_compra WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'solicitacoes_por_etapa', obra, count(*)::int FROM mega.solicitacoes_por_etapa WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'medicoes_contratos', obra, count(*)::int FROM mega.medicoes_contratos WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'contratos_itens', obra, count(*)::int FROM mega.contratos_itens WHERE data_extracao = $1 GROUP BY obra
      UNION ALL
      SELECT 'approvo_completo', 'TODAS', count(*)::int FROM mega.approvo_documentos WHERE data_extracao = $1
    `
    const { rows } = await query(countSql, [data])
    for (const r of rows) {
      if (!contagens[r.relatorio_key]) contagens[r.relatorio_key] = {}
      contagens[r.relatorio_key][r.obra] = Number(r.total || 0)
    }
  } catch (err) {
    console.warn('Erro ao contar registros por tabela/obra:', err.message)
  }

  // 7. Montar a Matriz [relatorio_key][obra]
  const matriz = {}
  for (const rel of relatorios) {
    matriz[rel.key] = {}

    const cargasDoRelatorio = cargas.filter((c) => {
      if (c.relatorio !== rel.relatorio) return false
      if (rel.arquivoPattern) {
        return String(c.arquivo || '').toLowerCase().includes(rel.arquivoPattern.toLowerCase())
      }
      return true
    })

    for (const ob of obras) {
      const codigoObra = ob.obra
      let status = 'nao_executado'
      let motivo = null
      let horario = null
      let idCarga = null

      for (let i = cargasDoRelatorio.length - 1; i >= 0; i--) {
        const c = cargasDoRelatorio[i]
        const okList = Array.isArray(c.obras_ok) ? c.obras_ok : []
        const failList = Array.isArray(c.obras_falhou) ? c.obras_falhou : []
        const semMovList = Array.isArray(c.obras_sem_movimento) ? c.obras_sem_movimento : []
        const isGlobalOk = rel.isGlobal && okList.includes('TODAS')
        const isGlobalFail = rel.isGlobal && (failList.includes('TODAS') || c.bloqueado)

        if (isGlobalOk || okList.includes(codigoObra)) {
          status = 'ok'
          horario = c.horario
          idCarga = c.id
          break
        } else if (isGlobalFail || failList.includes(codigoObra) || (c.bloqueado && String(c.motivo_bloqueio || '').includes(codigoObra))) {
          status = 'falhou'
          motivo = c.motivo_bloqueio || 'Carga bloqueada'
          horario = c.horario
          idCarga = c.id
          break
        } else if (semMovList.includes(codigoObra)) {
          status = 'sem_movimento'
          horario = c.horario
          idCarga = c.id
          break
        }
      }

      const count = contagens[rel.key]?.[rel.isGlobal ? 'TODAS' : codigoObra] ?? (status === 'ok' ? null : 0)

      matriz[rel.key][codigoObra] = {
        status,
        count: count !== null ? Number(count) : undefined,
        motivo,
        horario,
        idCarga,
      }
    }
  }

  // 8. Resumo Geral do Dia
  let totalOk = 0
  let totalFalhou = 0
  let totalSemMovimento = 0
  let totalNaoExecutado = 0
  let obras100Porcento = 0

  for (const ob of obras) {
    let obraOk = true
    let teveExecucao = false
    for (const rel of relatorios) {
      const cell = matriz[rel.key][ob.obra]
      if (cell.status === 'ok') {
        teveExecucao = true
      } else if (cell.status === 'falhou') {
        obraOk = false
        teveExecucao = true
      }
    }
    if (obraOk && teveExecucao) obras100Porcento++
  }

  for (const rel of relatorios) {
    for (const ob of obras) {
      const cell = matriz[rel.key][ob.obra]
      if (cell.status === 'ok') totalOk++
      else if (cell.status === 'falhou') totalFalhou++
      else if (cell.status === 'sem_movimento') totalSemMovimento++
      else totalNaoExecutado++
    }
  }

  const inicio = cargas.length > 0 ? cargas[0].horario : null
  const fim = cargas.length > 0 ? cargas[cargas.length - 1].horario : null

  return {
    data,
    datasDisponiveis,
    obras,
    relatorios,
    matriz,
    resumo: {
      totalCargas: cargas.length,
      totalOk,
      totalFalhou,
      totalSemMovimento,
      totalNaoExecutado,
      obras100Porcento,
      totalObras: obras.length,
      inicio,
      fim,
    },
    cargas,
  }
}

export default pool

