// Montagem pura de SQL do Diário de Obra: consultas paginadas da aba Dados Diário e upserts da sincronização.
// Nomes de tabela e coluna vêm só das constantes abaixo; valores sempre vão por parâmetro.

const DATA_R = 'r.data::text AS data'
const JUNTA_OBRA = 'JOIN diario.obra o ON o.obra_id = r.obra_id'
const filha = (tabela, alias) =>
  `FROM diario.${tabela} ${alias} JOIN diario.relatorio r ON r.relatorio_id = ${alias}.relatorio_id ${JUNTA_OBRA}`
const ORDEM_R = 'r.data DESC, r.numero DESC'
const BASE = 'r.removido_em IS NULL'

export const TABELAS = {
  relatorios: {
    select: `r.relatorio_id, r.obra_id, o.nome AS obra_nome, ${DATA_R}, r.numero, r.dia_semana, r.status,
      r.clima_manha, r.condicao_manha, r.clima_tarde, r.condicao_tarde, r.clima_noite, r.condicao_noite,
      r.indice_pluviometrico, r.dia_parado, r.dia_chuvoso, r.dia_impraticavel, r.total_fotos,
      r.criado_por, r.criado_em::text AS criado_em, r.modificado_por, r.modificado_em::text AS modificado_em`,
    from: `FROM diario.relatorio r ${JUNTA_OBRA}`,
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: ORDEM_R,
    busca: ['o.nome', 'r.status', 'r.criado_por', 'r.modificado_por', 'CAST(r.numero AS TEXT)'],
  },
  atividades: {
    select: `a.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, a.descricao, a.observacao, a.status, a.porcentagem, a.total_fotos`,
    from: filha('atividade', 'a'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, a.id`,
    busca: ['o.nome', 'a.descricao', 'a.observacao', 'a.status'],
  },
  mao_obra: {
    select: `m.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, m.funcao, m.quantidade, m.empreiteira`,
    from: filha('mao_obra', 'm'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, m.id`,
    busca: ['o.nome', 'm.funcao', 'm.empreiteira'],
  },
  equipamentos: {
    select: `e.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, e.descricao, e.quantidade`,
    from: filha('equipamento', 'e'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, e.id`,
    busca: ['o.nome', 'e.descricao'],
  },
  ocorrencias: {
    select: `oc.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, oc.descricao,
      array_to_string(oc.tags, ', ') AS tags, oc.paralisacao`,
    from: filha('ocorrencia', 'oc'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, oc.id`,
    busca: ['o.nome', 'oc.descricao', "array_to_string(oc.tags, ', ')"],
  },
  fotos: {
    select: `f.id, r.relatorio_id, o.nome AS obra_nome, ${DATA_R}, r.numero, f.url, f.url_miniatura, f.descricao, f.origem`,
    from: filha('foto', 'f'),
    obraColuna: 'r.obra_id',
    base: BASE,
    orderBy: `${ORDEM_R}, f.id`,
    busca: ['o.nome', 'f.descricao', 'f.origem'],
  },
  cargas: {
    select: `c.id, c.iniciada_em::text AS iniciada_em, c.finalizada_em::text AS finalizada_em, c.status,
      c.obras, c.novos, c.alterados, c.removidos, jsonb_array_length(c.erros) AS erros`,
    from: 'FROM diario.carga c',
    obraColuna: null,
    base: null,
    orderBy: 'c.id DESC',
    busca: ['c.status'],
  },
}

export function montarConsulta(tabela, { obra = '', search = '', page = 0, pageSize = 50 } = {}) {
  const t = TABELAS[tabela]
  if (!t) throw Object.assign(new Error(`Tabela do Diário desconhecida: ${tabela}`), { status: 400 })

  const condicoes = []
  const params = []
  if (t.base) condicoes.push(t.base)
  if (obra && t.obraColuna) {
    params.push(obra)
    condicoes.push(`${t.obraColuna} = $${params.length}`)
  }
  const termo = String(search || '').trim().toLowerCase()
  if (termo) {
    params.push(`%${termo}%`)
    condicoes.push(`(${t.busca.map((c) => `LOWER(${c}) LIKE $${params.length}`).join(' OR ')})`)
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''

  const tamanho = Math.min(200, Math.max(1, Math.trunc(Number(pageSize)) || 50))
  const pagina = Math.max(0, Math.trunc(Number(page)) || 0)
  const deslocamento = pagina * tamanho
  const n = params.length

  return {
    contagem: { sql: `SELECT COUNT(*)::int AS total ${t.from} ${where}`, params: [...params] },
    dados: {
      sql: `SELECT ${t.select} ${t.from} ${where} ORDER BY ${t.orderBy} LIMIT $${n + 1} OFFSET $${n + 2}`,
      params: [...params, tamanho, deslocamento],
    },
    paginacao: { page: pagina, pageSize: tamanho, offset: deslocamento },
  }
}

export function validarData(valor, nome) {
  if (valor === undefined || valor === null || valor === '') return null
  const texto = String(valor)
  let valida = false
  try {
    valida = /^\d{4}-\d{2}-\d{2}$/.test(texto) && new Date(`${texto}T00:00:00Z`).toISOString().slice(0, 10) === texto
  } catch {
    valida = false
  }
  if (!valida) throw Object.assign(new Error(`${nome} deve estar no formato AAAA-MM-DD.`), { status: 400 })
  return texto
}

// extras: [[coluna, expressaoSql]] aplicadas tanto no INSERT quanto no UPDATE (ex.: atualizado_em = now()).
export function montarUpsert(tabela, colunas, chave, { jsonb = [], extras = [] } = {}) {
  const valores = colunas.map((c, i) => (jsonb.includes(c) ? `$${i + 1}::jsonb` : `$${i + 1}`))
  const colunasInsert = [...colunas, ...extras.map(([c]) => c)]
  const valoresInsert = [...valores, ...extras.map(([, e]) => e)]
  const atualizacoes = [
    ...colunas.filter((c) => c !== chave).map((c) => `${c} = EXCLUDED.${c}`),
    ...extras.map(([c, e]) => `${c} = ${e}`),
  ]
  return `INSERT INTO ${tabela} (${colunasInsert.join(', ')}) VALUES (${valoresInsert.join(', ')}) ON CONFLICT (${chave}) DO UPDATE SET ${atualizacoes.join(', ')}`
}
