// Acesso ao banco do Diário de Obra (schema `diario`): repositório da sincronização, consultas da aba e indicadores.
import { query, withTransaction } from './db.js'
import { COLUNAS_OBRA, COLUNAS_RELATORIO } from './diario-map.js'
import { montarConsulta, montarUpsert } from './diario-consulta.js'
import { montarIndicadores } from './diario-indicadores.js'

const UPSERT_OBRA = montarUpsert('diario.obra', COLUNAS_OBRA, 'obra_id', {
  jsonb: ['raw'],
  extras: [['atualizado_em', 'now()']],
})
const UPSERT_RELATORIO = montarUpsert('diario.relatorio', COLUNAS_RELATORIO, 'relatorio_id', {
  jsonb: ['raw'],
  extras: [['removido_em', 'NULL'], ['sincronizado_em', 'now()']],
})

const valores = (colunas, linha) => colunas.map((c) => (c === 'raw' ? JSON.stringify(linha.raw) : linha[c]))

// tabela → { chave no objeto mapeado, coluna → tipo SQL }. Só constantes entram no SQL.
const FILHAS = {
  mao_obra: { chave: 'maoObra', colunas: { funcao: 'text', quantidade: 'int', empreiteira: 'text', empreiteira_norm: 'text' } },
  equipamento: { chave: 'equipamentos', colunas: { descricao: 'text', quantidade: 'int' } },
  ocorrencia: { chave: 'ocorrencias', colunas: { descricao: 'text', tags: 'text[]', paralisacao: 'boolean' } },
  atividade: { chave: 'atividades', colunas: { descricao: 'text', observacao: 'text', status: 'text', porcentagem: 'numeric', total_fotos: 'int' } },
  foto: { chave: 'fotos', colunas: { url: 'text', url_miniatura: 'text', descricao: 'text', origem: 'text' } },
}

async function gravarFilhas(q, relatorioId, mapeado) {
  for (const [tabela, def] of Object.entries(FILHAS)) {
    await q(`DELETE FROM diario.${tabela} WHERE relatorio_id = $1`, [relatorioId])
    const linhas = mapeado[def.chave]
    if (!linhas.length) continue
    const colunas = Object.keys(def.colunas)
    const tipos = colunas.map((c) => `${c} ${def.colunas[c]}`).join(', ')
    await q(
      `INSERT INTO diario.${tabela} (relatorio_id, ${colunas.join(', ')})
       SELECT $1, ${colunas.map((c) => `x.${c}`).join(', ')}
       FROM jsonb_to_recordset($2::jsonb) AS x(${tipos})`,
      [relatorioId, JSON.stringify(linhas)],
    )
  }
}

export const repoDiario = {
  async iniciarCarga() {
    const { rows } = await query('INSERT INTO diario.carga DEFAULT VALUES RETURNING id')
    return rows[0].id
  },

  async finalizarCarga(id, r) {
    await query(
      `UPDATE diario.carga
          SET finalizada_em = now(), status = $2, obras = $3, novos = $4, alterados = $5, removidos = $6, erros = $7::jsonb
        WHERE id = $1`,
      [id, r.status, r.obras, r.novos, r.alterados, r.removidos, JSON.stringify(r.erros)],
    )
  },

  async salvarObra(obra) {
    await query(UPSERT_OBRA, valores(COLUNAS_OBRA, obra))
  },

  async modifiedPorRelatorio(obraId) {
    const { rows } = await query('SELECT relatorio_id, modified_api FROM diario.relatorio WHERE obra_id = $1', [obraId])
    return new Map(rows.map((r) => [r.relatorio_id, r.modified_api]))
  },

  async salvarRelatorio(mapeado) {
    await withTransaction(async (q) => {
      await q(UPSERT_RELATORIO, valores(COLUNAS_RELATORIO, mapeado.relatorio))
      await gravarFilhas(q, mapeado.relatorio.relatorio_id, mapeado)
    })
  },

  // Quem voltou a aparecer na API é restaurado; quem sumiu é marcado (nunca apagado). Devolve quantos sumiram agora.
  async marcarRemovidos(obraId, ids) {
    await query(
      `UPDATE diario.relatorio SET removido_em = NULL
        WHERE obra_id = $1 AND removido_em IS NOT NULL AND relatorio_id = ANY($2::text[])`,
      [obraId, ids],
    )
    const { rowCount } = await query(
      `UPDATE diario.relatorio SET removido_em = now()
        WHERE obra_id = $1 AND removido_em IS NULL AND NOT (relatorio_id = ANY($2::text[]))`,
      [obraId, ids],
    )
    return rowCount
  },
}

export async function consultarDiario(tabela, opcoes = {}) {
  const { contagem, dados, paginacao } = montarConsulta(tabela, opcoes)
  const [cont, lista] = await Promise.all([
    query(contagem.sql, contagem.params),
    query(dados.sql, dados.params),
  ])
  const total = cont.rows[0].total
  return {
    records: lista.rows,
    total,
    page: paginacao.page,
    pageSize: paginacao.pageSize,
    hasMore: paginacao.offset + paginacao.pageSize < total,
  }
}

export async function obrasDiario() {
  const { rows } = await query(`
    SELECT o.obra_id, o.nome, o.status,
           COUNT(r.relatorio_id) FILTER (WHERE r.removido_em IS NULL)::int AS relatorios,
           (MIN(r.data) FILTER (WHERE r.removido_em IS NULL))::text AS primeira_data,
           (MAX(r.data) FILTER (WHERE r.removido_em IS NULL))::text AS ultima_data
      FROM diario.obra o
      LEFT JOIN diario.relatorio r ON r.obra_id = o.obra_id
     GROUP BY o.obra_id, o.nome, o.status
     ORDER BY o.nome`)
  return rows
}

export async function resumoDiario(obra = '') {
  const params = obra ? [obra] : []
  const filtro = obra ? 'AND r.obra_id = $1' : ''
  const contar = (tabela) =>
    `(SELECT COUNT(*)::int FROM diario.${tabela} x JOIN diario.relatorio r ON r.relatorio_id = x.relatorio_id WHERE r.removido_em IS NULL ${filtro})`
  const [{ rows: [totais] }, { rows: [ultimaCarga] }] = await Promise.all([
    query(
      `SELECT (SELECT COUNT(*)::int FROM diario.relatorio r WHERE r.removido_em IS NULL ${filtro}) AS relatorios,
              ${contar('atividade')} AS atividades, ${contar('mao_obra')} AS "maoObra",
              ${contar('equipamento')} AS equipamentos, ${contar('ocorrencia')} AS ocorrencias, ${contar('foto')} AS fotos`,
      params,
    ),
    query(`SELECT id, iniciada_em::text AS iniciada_em, finalizada_em::text AS finalizada_em, status, novos, alterados, removidos
             FROM diario.carga ORDER BY id DESC LIMIT 1`),
  ])
  return { ...totais, ultimaCarga: ultimaCarga ?? null }
}

export async function obterRelatorioDiario(id) {
  const { rows } = await query(
    `SELECT to_jsonb(r) || jsonb_build_object('obra_nome', o.nome) AS relatorio
       FROM diario.relatorio r JOIN diario.obra o ON o.obra_id = r.obra_id
      WHERE r.relatorio_id = $1`,
    [id],
  )
  if (!rows.length) return null
  const filha = (sql) => query(sql, [id]).then((r) => r.rows)
  const [maoObra, equipamentos, ocorrencias, atividades, fotos] = await Promise.all([
    filha('SELECT funcao, quantidade, empreiteira, empreiteira_norm FROM diario.mao_obra WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT descricao, quantidade FROM diario.equipamento WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT descricao, tags, paralisacao FROM diario.ocorrencia WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT descricao, observacao, status, porcentagem, total_fotos FROM diario.atividade WHERE relatorio_id = $1 ORDER BY id'),
    filha('SELECT url, url_miniatura, descricao, origem FROM diario.foto WHERE relatorio_id = $1 ORDER BY id'),
  ])
  return { relatorio: rows[0].relatorio, maoObra, equipamentos, ocorrencias, atividades, fotos }
}

export async function indicadoresDiario({ obra = '', dataInicio = null, dataFim = null } = {}) {
  const params = [obra || null, dataInicio, dataFim]
  const onde = `r.removido_em IS NULL
    AND ($1::text IS NULL OR r.obra_id = $1)
    AND ($2::date IS NULL OR r.data >= $2::date)
    AND ($3::date IS NULL OR r.data <= $3::date)`
  const ler = (sql) => query(sql, params).then((r) => r.rows)
  const [efetivoDia, efetivoEmpreiteira, efetivoFuncao, climaObra, tags, ocorrenciaTotais, preenchimentoObra] = await Promise.all([
    ler(`SELECT r.data::text AS data, SUM(m.quantidade)::int AS total
           FROM diario.relatorio r JOIN diario.mao_obra m ON m.relatorio_id = r.relatorio_id
          WHERE ${onde} GROUP BY r.data ORDER BY r.data`),
    ler(`SELECT COALESCE(m.empreiteira_norm, 'SEM EMPREITEIRA') AS chave,
                COALESCE(MIN(m.empreiteira), 'Sem empreiteira') AS rotulo,
                SUM(m.quantidade)::int AS total
           FROM diario.relatorio r JOIN diario.mao_obra m ON m.relatorio_id = r.relatorio_id
          WHERE ${onde} GROUP BY 1 ORDER BY total DESC, chave LIMIT 15`),
    ler(`SELECT COALESCE(NULLIF(TRIM(m.funcao), ''), 'Sem função') AS rotulo, SUM(m.quantidade)::int AS total
           FROM diario.relatorio r JOIN diario.mao_obra m ON m.relatorio_id = r.relatorio_id
          WHERE ${onde} GROUP BY 1 ORDER BY total DESC, rotulo LIMIT 15`),
    ler(`SELECT o.obra_id, o.nome AS obra_nome, COUNT(*)::int AS relatorios,
                COUNT(*) FILTER (WHERE r.dia_chuvoso)::int AS chuvosos,
                COUNT(*) FILTER (WHERE r.dia_impraticavel)::int AS impraticaveis,
                COUNT(*) FILTER (WHERE r.dia_parado)::int AS parados,
                COALESCE(SUM(r.indice_pluviometrico), 0)::float AS chuva_mm
           FROM diario.relatorio r JOIN diario.obra o ON o.obra_id = r.obra_id
          WHERE ${onde} GROUP BY o.obra_id, o.nome ORDER BY o.nome`),
    ler(`SELECT t AS tag, COUNT(*)::int AS total
           FROM diario.relatorio r JOIN diario.ocorrencia oc ON oc.relatorio_id = r.relatorio_id, unnest(oc.tags) AS t
          WHERE ${onde} GROUP BY t ORDER BY total DESC, t LIMIT 15`),
    ler(`SELECT COUNT(oc.id)::int AS ocorrencias, COUNT(DISTINCT r.relatorio_id)::int AS relatorios
           FROM diario.relatorio r JOIN diario.ocorrencia oc ON oc.relatorio_id = r.relatorio_id
          WHERE ${onde}`),
    ler(`SELECT o.obra_id, o.nome AS obra_nome, COUNT(*)::int AS relatorios,
                COUNT(*) FILTER (WHERE r.status_id = 4)::int AS aprovados,
                COUNT(*) FILTER (WHERE r.status_id = 3)::int AS em_revisao,
                COUNT(*) FILTER (WHERE r.status_id = 1)::int AS preenchendo,
                COUNT(*) FILTER (WHERE r.status_id IS DISTINCT FROM 4
                                   AND r.data < ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 7))::int AS pendentes_antigos,
                array_agg(DISTINCT r.data::text) AS datas
           FROM diario.relatorio r JOIN diario.obra o ON o.obra_id = r.obra_id
          WHERE ${onde} GROUP BY o.obra_id, o.nome ORDER BY o.nome`),
  ])
  return montarIndicadores(
    { efetivoDia, efetivoEmpreiteira, efetivoFuncao, climaObra, tags, ocorrenciaTotais: ocorrenciaTotais[0], preenchimentoObra },
    { dataInicio, dataFim },
  )
}
