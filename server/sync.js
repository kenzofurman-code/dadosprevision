import { query, withTransaction } from './db.js'
import {
  fetchAllProjectIds, fetchAnalyticsData, fetchKanbanData, fetchProjectData,
  sanitizePrevisionApiKey, sanitizeRestToken,
} from '../lib/prevision-client.js'
import {
  buildActivityContext, normalizeActivity, normalizeAnalytics, normalizeBaseline,
  normalizeFloor, normalizeMeasurement, normalizeMilestone, normalizeProject,
  normalizeResponsible, normalizeRestriction, normalizeService, dateOrNull, numberOrNull,
  timestampOrNull,
} from './normalizers.js'

const TABLE_FIELDS = {
  atividades: [
    'projeto_nome', 'codigo_eap', 'servico_id', 'servico_nome', 'pavimento_id', 'pavimento_nome',
    'grupo_repeticao', 'posicao_servico', 'posicao_pavimento', 'contador_parte', 'nivel_atividade', 'categorizacao',
    'caminho_critico', 'linha_base_inicio', 'linha_base_fim', 'data_inicio', 'data_fim', 'duracao_dias',
    'recursos_materiais', 'responsavel', 'custo_vinculado', 'custo_linha_base', 'primeira_medicao_em',
    'ultima_medicao_em', 'predecessoras', 'sucessoras', 'ultima_medicao_data', 'ultima_medicao_base',
    'ultima_medicao_esperado', 'ultima_medicao_realizado', 'data_referencia', 'progresso_fisico_base',
    'progresso_esperado', 'progresso_realizado', 'data_referencia_unidade', 'unidade_nome',
    'unidade_simbolo', 'progresso_unidade_base', 'progresso_unidade_esperado',
    'progresso_unidade_realizado', 'progresso_unidade_descricao', 'quantidade_unidade', 'saldo_unidade',
    'ultima_medicao_progresso_unidade', 'data_real_inicio', 'data_real_fim', 'duracao_real',
    'motivos_atraso', 'parte', 'possui_etapas', 'total_microservicos', 'microservicos_nomes',
    'microservicos', 'excluido_em',
  ],
  medicoes: [
    'projeto_nome', 'atividade_id', 'codigo_eap', 'atividade_nome', 'servico_id', 'servico_nome',
    'pavimento_id', 'pavimento_nome', 'unidade_simbolo', 'data_medicao', 'progresso_base',
    'progresso_esperado', 'progresso_realizado', 'motivos_atraso', 'observacoes',
  ],
  pavimentos: ['projeto_nome', 'nome', 'posicao', 'area', 'tag', 'grupo_repeticao', 'data_inicio', 'data_fim', 'excluido_em'],
  servicos: ['projeto_nome', 'nome', 'posicao', 'cor', 'unidade', 'data_inicio', 'data_fim', 'possui_atividades', 'possui_etapas'],
  marcos: ['projeto_nome', 'nome', 'data', 'cor', 'atributo_base', 'defasagem_dias', 'operacao_tempo', 'visivel_na_obra', 'origem_incorporacao', 'atividade_id'],
  linhas_base: ['projeto_nome', 'ativa', 'criado_em', 'versao_lob_id'],
  responsaveis: ['projeto_nome', 'nome'],
  cff_itens: [
    'projeto_nome', 'orcamento_id', 'orcamento_nome', 'codigo', 'descricao', 'nivel', 'tipo_grupo',
    'data_inicio_obra', 'data_fim_obra', 'data_inicio', 'data_fim', 'custo_mao_obra', 'custo_material',
    'custo_total', 'ignorado_erp', 'peso_base', 'peso_previsto', 'peso_realizado', 'peso_vinculado',
    'total_pesos_atividades', 'total_pesos_etapas', 'atividades', 'servicos', 'lotes', 'pontos_mensais',
  ],
  pesos_orcamento: [
    'projeto_nome', 'orcamento_id', 'orcamento_nome', 'id_item_orcamento', 'codigo', 'descricao',
    'nivel', 'porcentagem', 'id_atividade', 'servico_nome', 'pavimento_nome', 'microservicos',
  ],
}

const PROJECT_FIELDS = [
  'nome_projeto', 'empresa_nome', 'endereco', 'area', 'tipologia', 'fase', 'tipo_entrega',
  'tipo_cronograma', 'imagem_url', 'secao_id', 'secao_nome', 'criado_em', 'data_inicio', 'data_fim',
  'ultima_medicao', 'progresso_esperado', 'progresso_realizado', 'custo_orcado', 'custo_realizado',
  'atraso_dias', 'idp', 'dias_desde_inicio', 'dias_ate_fim', 'status_dashboard', 'status', 'desativado',
  'total_atividades', 'total_medicoes', 'total_microservicos', 'total_pavimentos', 'total_servicos',
  'total_marcos', 'total_linhas_base', 'total_responsaveis', 'total_restricoes', 'total_orcamentos',
  'total_itens_cff', 'total_pesos_orcamento', 'total_dashboards', 'restricoes',
]

const NUMERIC_FIELDS = {
  projetos: new Set([
    'area', 'progresso_esperado', 'progresso_realizado', 'custo_orcado', 'custo_realizado',
    'atraso_dias', 'idp', 'dias_desde_inicio', 'dias_ate_fim', 'total_atividades',
    'total_medicoes', 'total_microservicos', 'total_pavimentos', 'total_servicos', 'total_marcos',
    'total_linhas_base', 'total_responsaveis', 'total_restricoes', 'total_orcamentos',
    'total_itens_cff', 'total_pesos_orcamento', 'total_dashboards',
  ]),
  atividades: new Set([
    'posicao_servico', 'posicao_pavimento', 'duracao_dias', 'custo_vinculado', 'custo_linha_base',
    'ultima_medicao_base', 'ultima_medicao_esperado', 'ultima_medicao_realizado',
    'progresso_fisico_base', 'progresso_esperado', 'progresso_realizado', 'progresso_unidade_base',
    'progresso_unidade_esperado', 'progresso_unidade_realizado', 'quantidade_unidade', 'saldo_unidade',
    'ultima_medicao_progresso_unidade', 'parte', 'total_microservicos',
  ]),
  medicoes: new Set(['progresso_base', 'progresso_esperado', 'progresso_realizado']),
  pavimentos: new Set(['posicao', 'area']),
  servicos: new Set(['posicao']),
  marcos: new Set(['defasagem_dias']),
  cff_itens: new Set([
    'nivel', 'custo_mao_obra', 'custo_material', 'custo_total', 'peso_base', 'peso_previsto',
    'peso_realizado', 'peso_vinculado', 'total_pesos_atividades', 'total_pesos_etapas',
  ]),
  pesos_orcamento: new Set(['nivel', 'porcentagem']),
}

const DATE_FIELDS = {
  projetos: new Set(['data_inicio', 'data_fim', 'ultima_medicao']),
  atividades: new Set([
    'linha_base_inicio', 'linha_base_fim', 'data_inicio', 'data_fim', 'primeira_medicao_em',
    'ultima_medicao_em', 'ultima_medicao_data', 'data_referencia', 'data_referencia_unidade',
    'data_real_inicio', 'data_real_fim',
  ]),
  medicoes: new Set(['data_medicao']),
  pavimentos: new Set(['data_inicio', 'data_fim']),
  servicos: new Set(['data_inicio', 'data_fim']),
  marcos: new Set(['data']),
  cff_itens: new Set(['data_inicio_obra', 'data_fim_obra', 'data_inicio', 'data_fim']),
}

const TIMESTAMP_FIELDS = {
  projetos: new Set(['criado_em']),
  atividades: new Set(['excluido_em']),
  pavimentos: new Set(['excluido_em']),
  linhas_base: new Set(['criado_em']),
}

const JSON_FIELDS = {
  projetos: new Set(['restricoes']),
  atividades: new Set(['microservicos']),
  cff_itens: new Set(['pontos_mensais']),
  pesos_orcamento: new Set(['microservicos']),
}

function jsonb(value) {
  if (typeof value !== 'string') return JSON.stringify(value ?? null)
  try {
    JSON.parse(value)
    return value
  } catch {
    return JSON.stringify(value)
  }
}

function coerceField(table, field, value, serializeJson = true) {
  if (JSON_FIELDS[table]?.has(field)) return serializeJson ? jsonb(value) : value
  if (NUMERIC_FIELDS[table]?.has(field)) return numberOrNull(value)
  if (DATE_FIELDS[table]?.has(field)) return dateOrNull(value)
  if (TIMESTAMP_FIELDS[table]?.has(field)) return timestampOrNull(value)
  return value ?? null
}

function coerceRecord(table, record, serializeJson = true) {
  return Object.fromEntries(
    Object.entries(record).map(([field, value]) => [
      field,
      coerceField(table, field, value, serializeJson),
    ]),
  )
}

async function upsertProject(project, rawData, execute = query) {
  const normalized = coerceRecord('projetos', project)
  const columns = ['id_prevision', ...PROJECT_FIELDS, 'raw_data']
  const values = [
    normalized.id_prevision,
    ...PROJECT_FIELDS.map((field) => normalized[field] ?? null),
    jsonb(rawData),
  ]
  const updates = PROJECT_FIELDS.concat('raw_data').map((field) => `${field} = EXCLUDED.${field}`).join(', ')
  const placeholders = values.map((_value, index) => `$${index + 1}`).join(', ')
  await execute(
    `INSERT INTO projetos (${columns.join(', ')}, updated_at) VALUES (${placeholders}, NOW())
     ON CONFLICT (id_prevision) DO UPDATE SET ${updates}, updated_at = NOW()`, values,
  )
}

async function syncRows(table, projectId, rows, execute = query) {
  const fields = TABLE_FIELDS[table]
  if (!fields) throw new Error(`Tabela de sincronizacao nao permitida: ${table}`)
  for (const row of rows) {
    const normalized = coerceRecord(table, row)
    const columns = ['projeto_id', 'id_prevision', ...fields, 'raw_data']
    const values = [
      projectId,
      normalized.id_prevision,
      ...fields.map((field) => normalized[field] ?? null),
      jsonb(coerceRecord(table, row, false)),
    ]
    const placeholders = values.map((_value, index) => `$${index + 1}`).join(', ')
    const updates = fields.concat('raw_data').map((field) => `${field} = EXCLUDED.${field}`).join(', ')
    await execute(
      `INSERT INTO ${table} (${columns.join(', ')}, updated_at) VALUES (${placeholders}, NOW())
       ON CONFLICT (projeto_id, id_prevision) DO UPDATE SET ${updates}, updated_at = NOW()`, values,
    )
  }
  const ids = rows.map((row) => String(row.id_prevision))
  if (ids.length) {
    await execute(`DELETE FROM ${table} WHERE projeto_id = $1 AND NOT (id_prevision = ANY($2::text[]))`, [projectId, ids])
  } else {
    await execute(`DELETE FROM ${table} WHERE projeto_id = $1`, [projectId])
  }
}

async function upsertAnalytics(projectId, projectName, analytics, execute = query) {
  const fields = ['orcamentos', 'cff_resumo', 'dashboard_geral', 'dashboard_semanal', 'dashboard_mensal', 'dashboard_servicos', 'dashboard_lotes', 'dashboard_estados']
  const values = [
    projectId,
    projectId,
    projectName,
    ...fields.map((field) => jsonb(analytics[field] || [])),
    jsonb(analytics),
  ]
  const placeholders = values.map((_value, index) => `$${index + 1}`).join(', ')
  const updates = ['projeto_nome', ...fields, 'raw_data'].map((field) => `${field} = EXCLUDED.${field}`).join(', ')
  await execute(
    `INSERT INTO analiticos (projeto_id, id_prevision, projeto_nome, ${fields.join(', ')}, raw_data, updated_at)
     VALUES (${placeholders}, NOW())
     ON CONFLICT (projeto_id, id_prevision) DO UPDATE SET ${updates}, updated_at = NOW()`, values,
  )
}

export async function syncProjects(apiKeyValue, restTokenValue = '', requestedProjectId = '') {
  const apiKey = sanitizePrevisionApiKey(apiKeyValue)
  const restToken = sanitizeRestToken(restTokenValue)
  if (!apiKey || apiKey === '...') throw new Error('PREVISION_API_KEY nao configurada com o valor real.')
  const allProjects = await fetchAllProjectIds(apiKey)
  const projects = requestedProjectId
    ? allProjects.filter((project) => String(project.id) === String(requestedProjectId))
    : allProjects
  if (!projects.length) throw new Error('Projeto nao encontrado na Prevision.')

  const kanban = await fetchKanbanData(apiKey)
  const totals = {
    projects: 0, activities: 0, measurements: 0, floors: 0, services: 0, milestones: 0,
    baselines: 0, responsibles: 0, restrictions: 0, microservices: 0, budgets: 0,
    cffItems: 0, budgetWeights: 0, dashboards: 0, analytics: 0, failures: [],
  }

  for (const project of projects) {
    try {
      console.log(`Sincronizando projeto ${project.id}...`)
      const data = await fetchProjectData(apiKey, project, restToken)
      const projectName = data.details.name || project.name || `Projeto ${project.id}`
      const context = buildActivityContext(data)
      const normalized = {
        atividades: data.activities.map((item) => normalizeActivity(item, project, projectName, context)),
        medicoes: data.activities.flatMap((activity) => (activity.measuresPage?.nodes || []).map((measure) => normalizeMeasurement(measure, activity, project, projectName))),
        pavimentos: data.floors.map((item) => normalizeFloor(item, project, projectName)),
        servicos: data.services.map((item) => normalizeService(item, project, projectName)),
        marcos: data.milestones.map((item) => normalizeMilestone(item, project, projectName)),
        linhas_base: data.baselines.map((item) => normalizeBaseline(item, project, projectName)),
        responsaveis: data.responsibles.map((item) => normalizeResponsible(item, project, projectName)),
      }
      const restrictions = kanban.tasks
        .filter((task) => String(task.project?.id) === String(project.id)).map(normalizeRestriction)
      const analyticsData = await fetchAnalyticsData(apiKey, project, data.details)
      const analytics = normalizeAnalytics(project, analyticsData)
      const microservices = normalized.atividades.reduce((total, item) => total + item.total_microservicos, 0)
      const counts = {
        activities: normalized.atividades.length, measurements: normalized.medicoes.length,
        microservices, floors: normalized.pavimentos.length, services: normalized.servicos.length,
        milestones: normalized.marcos.length, baselines: normalized.linhas_base.length,
        responsibles: normalized.responsaveis.length, restrictions: restrictions.length,
        budgets: analytics.analyticsDoc?.orcamentos.length || 0, budgetItems: analytics.budgetItems.length,
        budgetWeights: analytics.budgetWeights.length,
        dashboards: analytics.analyticsDoc?.dashboard_estados.length || 0,
      }
      const normalizedProject = { ...normalizeProject(project, data.details, counts), restricoes: restrictions }
      await withTransaction(async (execute) => {
        await upsertProject(normalizedProject, data.details, execute)
        for (const [table, rows] of Object.entries(normalized)) {
          await syncRows(table, String(project.id), rows, execute)
        }
        await syncRows('cff_itens', String(project.id), analytics.budgetItems, execute)
        await syncRows('pesos_orcamento', String(project.id), analytics.budgetWeights, execute)
        await upsertAnalytics(String(project.id), projectName, analytics.analyticsDoc, execute)
      })
      totals.analytics += 1

      totals.projects += 1
      totals.activities += counts.activities; totals.measurements += counts.measurements
      totals.microservices += counts.microservices; totals.floors += counts.floors
      totals.services += counts.services; totals.milestones += counts.milestones
      totals.baselines += counts.baselines; totals.responsibles += counts.responsibles
      totals.restrictions += counts.restrictions; totals.budgets += counts.budgets
      totals.cffItems += counts.budgetItems; totals.budgetWeights += counts.budgetWeights
      totals.dashboards += counts.dashboards
      console.log(`Projeto ${projectName} (${project.id}) sincronizado com sucesso.`)
    } catch (error) {
      console.error(`Erro ao sincronizar projeto ${project.id}:`, error)
      totals.failures.push({ projectId: String(project.id), error: error.message || String(error) })
    }
  }

  if (!totals.projects) throw new Error(totals.failures[0]?.error || 'Nenhum projeto foi sincronizado.')
  return totals
}
