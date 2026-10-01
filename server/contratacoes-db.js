// Acesso a banco da Gestão de Contratações. Regras puras em ./contratacoes.js.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { query, withTransaction } from './db.js'
import {
  etapaParaMega, nivelDoCodigo, resolverEtapasPadrao, expandirParaNivel5,
  sugestoesPorNome, lerCustoProjetado, calcularMacro, hojeNoBrasil,
  calcularTrilha, REGRAS_PADRAO, resumirMedicoes, classificador, lerClassificacaoInsumos, origemParaCanal, normalizarNome,
} from './contratacoes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PADRAO = JSON.parse(fs.readFileSync(path.join(__dirname, 'contratacoes-padrao.json'), 'utf8'))

export async function carregarPadraoSeVazio() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM contratacao_grupos WHERE projeto_id IS NULL')
  if (rows[0].n > 0) return 0
  await withTransaction(async (q) => {
    for (const g of PADRAO.grupos) {
      const { rows: [novo] } = await q(
        `INSERT INTO contratacao_grupos (projeto_id, tipo, item, insumos, pacote_servicos, ordem,
           prazo_levantamento, prazo_solicitacao, prazo_negociacao, prazo_emissao, prazo_entrega)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [g.tipo, g.item, g.insumos, g.pacote_servicos, g.ordem, g.prazos.levantamento,
          g.prazos.solicitacao, g.prazos.negociacao, g.prazos.emissao, g.prazos.entrega],
      )
      for (const e of g.etapas) {
        await q(
          `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, nome_padrao)
           VALUES ($1, NULL, $2, $3, $4)`,
          [novo.id, e.codigo, e.nivel, e.nome],
        )
      }
    }
  })
  // O UPDATE do schema.sql roda antes da carga; aqui o padrão recém-carregado ganha o lead time.
  await query(`UPDATE contratacao_grupos SET
      lead_time = CASE WHEN tipo = 'MATERIAL' THEN prazo_solicitacao + prazo_negociacao + prazo_emissao + prazo_entrega
                       ELSE prazo_entrega + prazo_negociacao + prazo_emissao END,
      levantamento = prazo_levantamento
    WHERE lead_time IS NULL`)
  return PADRAO.grupos.length
}

const COD_ORCAMENTO = String.raw`^\d{2}(\.\d{2}){3}(\.\d{2,3})?$`

// Orçamento da obra (níveis 4 e 5) no formato Mega: Map<codigo, nome>.
export async function orcamentoDaObra(projetoId) {
  const { rows } = await query(
    `SELECT codigo, MAX(descricao) AS descricao FROM (
       SELECT codigo, descricao FROM pesos_orcamento WHERE projeto_id = $1 AND codigo ~ '${COD_ORCAMENTO}'
       UNION ALL
       SELECT codigo, descricao FROM cff_itens WHERE projeto_id = $1 AND codigo ~ '${COD_ORCAMENTO}'
     ) o GROUP BY codigo`,
    [projetoId],
  )
  const mapa = new Map()
  for (const r of rows) {
    const c = etapaParaMega(r.codigo)
    if (c && !mapa.has(c)) mapa.set(c, r.descricao || '')
  }
  return mapa
}

async function ultimaImportacao(projetoId) {
  const { rows } = await query(
    `SELECT id, referencia, total, importado_em, arquivo FROM custo_projetado_importacoes
     WHERE projeto_id = $1 ORDER BY importado_em DESC LIMIT 1`, [projetoId])
  return rows[0] || null
}

async function custosDaImportacao(importacaoId) {
  if (!importacaoId) return new Map()
  const { rows } = await query('SELECT codigo_etapa, custo_projetado FROM custo_projetado_itens WHERE importacao_id = $1', [importacaoId])
  return new Map(rows.map((r) => [r.codigo_etapa, Number(r.custo_projetado)]))
}

// Classificação de insumos da empresa + ajustes da obra.
async function classificadorDaObra(projetoId) {
  const { rows } = await query(
    'SELECT projeto_id, cod_insumo, descricao, tipo FROM insumo_classificacao WHERE projeto_id IS NULL OR projeto_id = $1', [projetoId])
  const empresa = rows.filter((r) => r.projeto_id === null)
  const obra = rows.filter((r) => r.projeto_id !== null)
  return {
    tipoDe: classificador({ empresa, obra }),
    empresa: empresa.length,
    obra: obra.map((r) => ({ descricao: r.descricao, tipo: r.tipo })),
  }
}

// Projetado por 'etapa|TIPO'. Importação antiga (sem linhas por insumo) entra
// toda como material, com aviso para reimportar.
async function projetadoPorTipo(importacaoId, tipoDe) {
  const mapa = new Map()
  const somar = (c, t, v) => mapa.set(`${c}|${t}`, (mapa.get(`${c}|${t}`) || 0) + v)
  if (!importacaoId) return { mapa, semDescricao: false, semClassificacao: [] }
  const { rows } = await query('SELECT codigo_etapa, descricao, custo_projetado FROM custo_projetado_insumos WHERE importacao_id = $1', [importacaoId])
  if (!rows.length) {
    for (const [c, v] of await custosDaImportacao(importacaoId)) somar(c, 'MATERIAL', v)
    return { mapa, semDescricao: true, semClassificacao: [] }
  }
  const semClassificacao = new Map()
  for (const r of rows) {
    const v = Number(r.custo_projetado) || 0
    const { tipo, fonte } = tipoDe(r.descricao)
    somar(r.codigo_etapa, tipo, v)
    if (fonte === 'HEURISTICA') {
      const d = normalizarNome(r.descricao)
      const atual = semClassificacao.get(d) || { descricao: d, tipo, projetado: 0 }
      atual.projetado += v
      semClassificacao.set(d, atual)
    }
  }
  return { mapa, semDescricao: false, semClassificacao: [...semClassificacao.values()].sort((a, b) => b.projetado - a.projetado) }
}

export async function obterConfig(projetoId) {
  const [orcamento, importacao, gruposRes, etapasRes, padraoRes] = await Promise.all([
    orcamentoDaObra(projetoId),
    ultimaImportacao(projetoId),
    query('SELECT * FROM contratacao_grupos WHERE projeto_id = $1 ORDER BY ordem, id', [projetoId]),
    query('SELECT * FROM contratacao_grupo_etapas WHERE projeto_id = $1 ORDER BY codigo_etapa', [projetoId]),
    query(`SELECT e.codigo_etapa, e.nome_padrao, g.ordem, g.id AS padrao_id FROM contratacao_grupo_etapas e
           JOIN contratacao_grupos g ON g.id = e.grupo_id WHERE e.projeto_id IS NULL`),
  ])
  const classif = await classificadorDaObra(projetoId)
  const proj = await projetadoPorTipo(importacao?.id, classif.tipoDe)
  const custo = (c, t) => proj.mapa.get(`${c}|${t}`) ?? null
  const tipoDoGrupo = new Map(gruposRes.rows.map((g) => [g.id, g.tipo]))
  const porGrupo = new Map()
  const usadas = { MATERIAL: new Set(), MAO_DE_OBRA: new Set() }
  for (const e of etapasRes.rows) {
    const t = tipoDoGrupo.get(e.grupo_id)
    usadas[t]?.add(e.codigo_etapa)
    if (!porGrupo.has(e.grupo_id)) porGrupo.set(e.grupo_id, [])
    porGrupo.get(e.grupo_id).push({ ...e, custo_projetado: custo(e.codigo_etapa, t) })
  }
  const grupos = gruposRes.rows.map((g) => ({ ...g, etapas: porGrupo.get(g.id) || [] }))
  const nivel5 = [...orcamento.entries()].filter(([c]) => nivelDoCodigo(c) === 5)
  const sugestoes = sugestoesPorNome(nivel5.map(([codigo, nome]) => ({ codigo, nome })),
    padraoRes.rows.map((r) => ({ codigo: r.codigo_etapa, nome: r.nome_padrao, ordem: r.ordem })))
  const grupoPorPadraoOrdem = new Map()
  const ordemPorPadraoId = new Map(padraoRes.rows.map((r) => [r.padrao_id, r.ordem]))
  for (const g of grupos) {
    const ordemPadrao = ordemPorPadraoId.get(g.padrao_grupo_id)
    if (ordemPadrao !== undefined) grupoPorPadraoOrdem.set(ordemPadrao, g)
  }
  // Pendências por tipo: etapa sem grupo daquele tipo. Com a projeção por
  // insumo, só entram etapas com custo daquele tipo.
  const pendenciasDo = (t) => nivel5
    .filter(([c]) => !usadas[t].has(c) && (proj.semDescricao || !importacao || (custo(c, t) ?? 0) > 0))
    .map(([codigo, nome]) => {
      const s = sugestoes.get(codigo)
      const g = s ? grupoPorPadraoOrdem.get(s.ordem) : null
      return {
        codigo_etapa: codigo, nome, custo_projetado: custo(codigo, t),
        sugestao: g && g.tipo === t ? { grupo_id: g.id, item: g.item, codigo_padrao: s.codigo_padrao } : null,
      }
    }).sort((a, b) => (b.custo_projetado ?? -1) - (a.custo_projetado ?? -1) || a.codigo_etapa.localeCompare(b.codigo_etapa))
  const orcamentoTotal = [...proj.mapa.values()].reduce((s, v) => s + v, 0)
  return {
    aplicado: grupos.length > 0, grupos, importacao, orcamentoTotal, projecaoSemInsumo: proj.semDescricao,
    pendencias: { MATERIAL: pendenciasDo('MATERIAL'), MAO_DE_OBRA: pendenciasDo('MAO_DE_OBRA') },
    classificacao: { empresa: classif.empresa, obra: classif.obra, sem_classificacao: proj.semClassificacao },
  }
}

export async function aplicarPadrao(projetoId, { restaurar = false } = {}) {
  const orcamento = await orcamentoDaObra(projetoId)
  const { rows: padrao } = await query('SELECT * FROM contratacao_grupos WHERE projeto_id IS NULL ORDER BY ordem')
  const { rows: etapasPadrao } = await query('SELECT * FROM contratacao_grupo_etapas WHERE projeto_id IS NULL')
  const gruposPadrao = padrao.map((g) => ({
    ordem: g.ordem,
    etapas: etapasPadrao.filter((e) => e.grupo_id === g.id)
      .map((e) => ({ codigo: e.codigo_etapa, nivel: e.nivel, nome: e.nome_padrao })),
  }))
  const { vinculos, conflitos } = resolverEtapasPadrao(gruposPadrao, orcamento)
  return withTransaction(async (q) => {
    const { rows: [{ n }] } = await q('SELECT COUNT(*)::int AS n FROM contratacao_grupos WHERE projeto_id = $1', [projetoId])
    if (n > 0 && !restaurar) throw Object.assign(new Error('A obra já tem grupos. Use "Restaurar padrão" para substituir.'), { status: 409 })
    await q('DELETE FROM contratacao_grupos WHERE projeto_id = $1', [projetoId])
    const idPorOrdem = new Map()
    for (const g of padrao) {
      const { rows: [novo] } = await q(
        `INSERT INTO contratacao_grupos (projeto_id, padrao_grupo_id, tipo, item, insumos, pacote_servicos, ordem,
           prazo_levantamento, prazo_solicitacao, prazo_negociacao, prazo_emissao, prazo_entrega, lead_time, levantamento)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [projetoId, g.id, g.tipo, g.item, g.insumos, g.pacote_servicos, g.ordem, g.prazo_levantamento,
          g.prazo_solicitacao, g.prazo_negociacao, g.prazo_emissao, g.prazo_entrega, g.lead_time, g.levantamento],
      )
      idPorOrdem.set(g.ordem, novo.id)
    }
    const tipoPorOrdem = new Map(padrao.map((g) => [g.ordem, g.tipo]))
    for (const v of vinculos) {
      await q(
        `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, situacao, nome_padrao, nome_obra, origem_nivel4, tipo)
         VALUES ($1,$2,$3,5,$4,$5,$6,$7,$8)`,
        [idPorOrdem.get(v.ordem), projetoId, v.codigo_etapa, v.situacao, v.nome_padrao, v.nome_obra, v.origem_nivel4, tipoPorOrdem.get(v.ordem)],
      )
    }
    return { grupos: padrao.length, vinculos: vinculos.length,
      sugeridos: vinculos.filter((v) => v.situacao === 'SUGERIDO').length, conflitos: conflitos.length }
  })
}

const CAMPOS_GRUPO = ['tipo', 'item', 'insumos', 'pacote_servicos', 'ordem', 'lead_time', 'levantamento']
const CAMPOS_NUMERICOS = new Set(['ordem', 'lead_time', 'levantamento'])

export async function salvarGrupo(projetoId, grupo) {
  if (!grupo.item || !String(grupo.item).trim()) throw Object.assign(new Error('Informe o nome do grupo.'), { status: 400 })
  if (!['MATERIAL', 'MAO_DE_OBRA'].includes(grupo.tipo)) throw Object.assign(new Error('Tipo deve ser MATERIAL ou MAO_DE_OBRA.'), { status: 400 })
  const valores = CAMPOS_GRUPO.map((c) => (CAMPOS_NUMERICOS.has(c) ?Math.max(0, Number(grupo[c]) || 0) : grupo[c] ?? null))
  if (grupo.id) {
    const sets = CAMPOS_GRUPO.map((c, i) => `${c} = $${i + 3}`).join(', ')
    const { rowCount } = await query(
      `UPDATE contratacao_grupos SET ${sets}, atualizado_em = NOW() WHERE id = $1 AND projeto_id = $2`,
      [grupo.id, projetoId, ...valores])
    if (!rowCount) throw Object.assign(new Error('Grupo não encontrado nesta obra.'), { status: 404 })
    return { id: grupo.id }
  }
  const { rows: [novo] } = await query(
    `INSERT INTO contratacao_grupos (projeto_id, ${CAMPOS_GRUPO.join(', ')})
     VALUES ($1, ${CAMPOS_GRUPO.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`,
    [projetoId, ...valores])
  return { id: novo.id }
}

export async function excluirGrupo(projetoId, grupoId) {
  await query('DELETE FROM contratacao_grupos WHERE id = $1 AND projeto_id = $2', [grupoId, projetoId])
}

export async function atrelarEtapas(projetoId, grupoId, codigos, { mover = false } = {}) {
  const orcamento = await orcamentoDaObra(projetoId)
  const alvo = expandirParaNivel5(codigos, orcamento)
  if (!alvo.length) return { inseridas: 0, conflitos: [] }
  return withTransaction(async (q) => {
    const { rows: [grupo] } = await q('SELECT id, tipo FROM contratacao_grupos WHERE id = $1 AND projeto_id = $2', [grupoId, projetoId])
    if (!grupo) throw Object.assign(new Error('Grupo não encontrado nesta obra.'), { status: 404 })
    // Conflito só com grupo do mesmo tipo: a etapa pode ter um grupo de material e um de mão de obra.
    const { rows: existentes } = await q(
      `SELECT e.codigo_etapa, e.grupo_id, g.item FROM contratacao_grupo_etapas e JOIN contratacao_grupos g ON g.id = e.grupo_id
       WHERE e.projeto_id = $1 AND e.codigo_etapa = ANY($2) AND e.grupo_id <> $3 AND e.tipo = $4`,
      [projetoId, alvo.map((a) => a.codigo_etapa), grupoId, grupo.tipo])
    if (existentes.length && !mover) return { inseridas: 0, conflitos: existentes }
    await q('DELETE FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND codigo_etapa = ANY($2) AND tipo = $3',
      [projetoId, alvo.map((a) => a.codigo_etapa), grupo.tipo])
    for (const a of alvo) {
      await q(
        `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, situacao, nome_obra, origem_nivel4, tipo)
         VALUES ($1,$2,$3,5,'CONFIRMADO',$4,$5,$6)`,
        [grupoId, projetoId, a.codigo_etapa, orcamento.get(a.codigo_etapa) || '', a.origem_nivel4, grupo.tipo])
    }
    return { inseridas: alvo.length, conflitos: [] }
  })
}

// grupoId: a mesma etapa pode estar num grupo de material e num de mão de obra.
export async function soltarEtapa(projetoId, codigo, grupoId = null) {
  await query('DELETE FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND codigo_etapa = $2 AND ($3::int IS NULL OR grupo_id = $3)',
    [projetoId, codigo, grupoId])
}

export async function confirmarEtapa(projetoId, codigo, grupoId = null) {
  await query(`UPDATE contratacao_grupo_etapas SET situacao = 'CONFIRMADO'
               WHERE projeto_id = $1 AND codigo_etapa = $2 AND ($3::int IS NULL OR grupo_id = $3)`, [projetoId, codigo, grupoId])
}

// Planilha de insumos da empresa: substitui a classificação da empresa inteira.
export async function importarClassificacao(matriz) {
  const lido = lerClassificacaoInsumos(matriz)
  if (lido.erros.length) throw Object.assign(new Error(lido.erros[0]), { status: 400 })
  if (!lido.itens.length) throw Object.assign(new Error('Nenhum insumo com definição MT, SE, EQ ou OU encontrado.'), { status: 400 })
  const unicos = [...new Map(lido.itens.map((i) => [i.descricao, i])).values()]
  return withTransaction(async (q) => {
    await q('DELETE FROM insumo_classificacao WHERE projeto_id IS NULL')
    await q(
      `INSERT INTO insumo_classificacao (projeto_id, cod_insumo, descricao, definicao, tipo)
       SELECT NULL, c, d, f, t FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[]) AS x(c, d, f, t)`,
      [unicos.map((i) => i.cod_insumo), unicos.map((i) => i.descricao), unicos.map((i) => i.definicao), unicos.map((i) => i.tipo)])
    return { insumos: unicos.length, ignoradas: lido.ignoradas }
  })
}

// Ajuste da obra para um insumo (por descrição); tipo null remove o ajuste.
export async function classificarInsumoObra(projetoId, descricao, tipo) {
  const d = normalizarNome(descricao)
  if (!d) throw Object.assign(new Error('Informe a descrição do insumo.'), { status: 400 })
  if (tipo != null && !['MATERIAL', 'MAO_DE_OBRA'].includes(tipo)) throw Object.assign(new Error('Tipo deve ser MATERIAL ou MAO_DE_OBRA.'), { status: 400 })
  await query('DELETE FROM insumo_classificacao WHERE projeto_id = $1 AND descricao = $2', [projetoId, d])
  if (tipo != null) await query('INSERT INTO insumo_classificacao (projeto_id, descricao, tipo) VALUES ($1, $2, $3)', [projetoId, d, tipo])
  return {}
}

export async function previaCusto(projetoId, matriz) {
  const lido = lerCustoProjetado(matriz)
  const orcamento = await orcamentoDaObra(projetoId)
  const anterior = await ultimaImportacao(projetoId)
  return {
    ...lido,
    foraDoOrcamento: lido.itens.map((i) => i.codigo_etapa).filter((c) => !orcamento.has(c)),
    totalAnterior: anterior ? Number(anterior.total) : null,
  }
}

export async function importarCusto(projetoId, { referencia, arquivo, matriz }) {
  if (!/^\d{4}-\d{2}$/.test(String(referencia || ''))) throw Object.assign(new Error('Informe o mês de referência (AAAA-MM).'), { status: 400 })
  const lido = lerCustoProjetado(matriz)
  if (lido.erros.length) throw Object.assign(new Error(`A planilha tem ${lido.erros.length} erro(s); corrija e envie de novo.`), { status: 400 })
  if (!lido.itens.length) throw Object.assign(new Error('Nenhuma etapa de nível 5 com custo projetado encontrada.'), { status: 400 })
  return withTransaction(async (q) => {
    const { rows: [imp] } = await q(
      `INSERT INTO custo_projetado_importacoes (projeto_id, referencia, arquivo, total) VALUES ($1, $2, $3, $4) RETURNING id`,
      [projetoId, `${referencia}-01`, arquivo || null, lido.total])
    for (const i of lido.itens) {
      await q('INSERT INTO custo_projetado_itens (importacao_id, codigo_etapa, custo_projetado) VALUES ($1,$2,$3)',
        [imp.id, i.codigo_etapa, i.custo_projetado])
    }
    await q(
      `INSERT INTO custo_projetado_insumos (importacao_id, codigo_etapa, descricao, custo_projetado)
       SELECT $1, c, d, v FROM unnest($2::text[], $3::text[], $4::numeric[]) AS x(c, d, v)`,
      [imp.id, lido.linhas.map((l) => l.codigo_etapa), lido.linhas.map((l) => l.descricao), lido.linhas.map((l) => l.custo_projetado)])
    return { id: imp.id, total: lido.total, itens: lido.itens.length }
  })
}

async function obraDoProjeto(projetoId) {
  const { rows } = await query('SELECT obra FROM mega.obra_projeto WHERE id_prevision = $1 LIMIT 1', [projetoId])
  return rows[0]?.obra || null
}

// Valores por etapa (formato Mega). Solicitado = valor do item da solicitação;
// em_pedido / em_contrato = saldo aberto da Análise de Saldo (abas Pedidos e
// Contratos, última extração da obra); realizado = apropriação por cod_estruturado.
// Comprometido = realizado + saldos, como na planilha de projeção de custo.
// Saldo da última carga bem-sucedida da obra (mega.carga): se a obra zerou o
// saldo, essa carga não traz linhas e o saldo é zero, não o de um dia antigo.
// Sem registro em mega.carga, cai na última data da tabela. Rodar a carga duas
// vezes no mesmo dia duplica as linhas (INSERT simples), por isso o DISTINCT.
const saldoSql = (tabela, arquivo, campo, colunas) => `
  WITH dia AS (
    SELECT COALESCE(
      (SELECT MAX(data_extracao) FROM mega.carga
       WHERE relatorio = 'analise_saldo_solicitacao' AND arquivo = '${arquivo}' AND NOT bloqueado
         AND ($1 = ANY(obras_ok) OR $1 = ANY(obras_sem_movimento))),
      (SELECT MAX(data_extracao) FROM mega.${tabela} WHERE obra = $1)) AS d
  ), linhas AS (
    SELECT DISTINCT ${colunas}, raw_data FROM mega.${tabela}
    WHERE obra = $1 AND data_extracao = (SELECT d FROM dia)
  )
  SELECT raw_data->>'cod_estruturado' AS codigo_etapa, raw_data->>'cod_insumo' AS cod, raw_data->>'descricao_insumo' AS descricao,
         SUM(COALESCE(${campo}, 0)) AS valor
  FROM linhas GROUP BY 1, 2, 3`

// Valores por 'etapa|TIPO' (tipo do insumo pela classificação). Realizado é
// dividido em vindo de pedido / de contrato pela origem da apropriação.
async function valoresPorEtapa(obra, tipoDe) {
  const [itens, pedidos, contratos, realizado] = await Promise.all([
    query(
      `WITH etapa_distinta AS (
         SELECT DISTINCT codigo_solicitacao, sequencial_item, codigo_etapa, numero_insumo, descricao_insumo
         FROM mega.solicitacoes_por_etapa WHERE obra = $1 AND codigo_etapa IS NOT NULL
       ), etapa_item AS (
         -- Item ligado a várias etapas: o Mega não diz quanto vai para cada uma,
         -- então o valor é dividido igualmente (senão conta mais de uma vez).
         SELECT *, COUNT(*) OVER (PARTITION BY codigo_solicitacao, sequencial_item) AS n_etapas FROM etapa_distinta
       ), item AS (
         SELECT solicitacao, sequencia, MAX(valor_total) AS valor,
                BOOL_OR(cod_cotacao IS NOT NULL OR cod_pedido IS NOT NULL OR cod_contrato IS NOT NULL) AS cotado
         FROM mega.visualizacao_itens WHERE obra = $1 GROUP BY solicitacao, sequencia
       )
       SELECT e.codigo_etapa, e.numero_insumo::text AS cod, e.descricao_insumo AS descricao,
              SUM(COALESCE(i.valor, 0) / e.n_etapas) AS solicitado,
              COALESCE(SUM(COALESCE(i.valor, 0) / e.n_etapas) FILTER (WHERE i.cotado), 0) AS cotado
       FROM etapa_item e
       JOIN item i ON i.solicitacao::text = e.codigo_solicitacao::text AND i.sequencia::text = e.sequencial_item::text
       GROUP BY 1, 2, 3`, [obra]),
    query(saldoSql('analise_pedidos_hist', 'Analise_Pedidos', 'valor_apropriacao',
      'codigo_pedido, fornecedor, qtde_pedido, valor_unitario, qtde_apropriada, valor_apropriacao'), [obra]),
    query(saldoSql('analise_contratos_hist', 'Analise_Contratos', 'total',
      'codigo_contrato, fornecedor, status_pre_contrato, saldo_qtde_contrato, valor_unitario, total'), [obra]),
    query(
      `SELECT raw_data->>'cod_estruturado' AS codigo_etapa, raw_data->>'cod_item' AS cod, raw_data->>'descricao_1' AS descricao,
              raw_data->>'origem' AS origem, SUM(COALESCE(valor_apropriacao, 0)) AS valor
       FROM mega.analise_realizado WHERE obra = $1 AND raw_data ? 'cod_estruturado' GROUP BY 1, 2, 3, 4`, [obra]),
  ])
  const mapa = new Map()
  const pega = (r) => {
    const c = etapaParaMega(r.codigo_etapa)
    if (!c) return null
    const { tipo } = tipoDe(r.descricao, r.cod)
    const chave = `${c}|${tipo}`
    if (!mapa.has(chave)) mapa.set(chave, { solicitado: 0, cotado: 0, em_pedido: 0, em_contrato: 0, realizado_pedido: 0, realizado_contrato: 0 })
    return { v: mapa.get(chave), tipo }
  }
  for (const r of itens.rows) {
    const p = pega(r)
    if (p) { p.v.solicitado += Number(r.solicitado) || 0; p.v.cotado += Number(r.cotado) || 0 }
  }
  for (const r of pedidos.rows) { const p = pega(r); if (p) p.v.em_pedido += Number(r.valor) || 0 }
  for (const r of contratos.rows) { const p = pega(r); if (p) p.v.em_contrato += Number(r.valor) || 0 }
  for (const r of realizado.rows) {
    const p = pega(r)
    if (p) p.v[`realizado_${origemParaCanal(r.origem, p.tipo)}`] += Number(r.valor) || 0
  }
  return mapa
}

// Menor início no cronograma por etapa, via orçamento (pesos_orcamento.id_atividade).
async function inicioPorEtapa(projetoId) {
  const { rows } = await query(
    `SELECT p.codigo, TO_CHAR(MIN(a.data_inicio), 'YYYY-MM-DD') AS inicio
     FROM pesos_orcamento p JOIN atividades a ON a.projeto_id = p.projeto_id AND a.id_prevision = p.id_atividade
     WHERE p.projeto_id = $1 AND a.data_inicio IS NOT NULL GROUP BY p.codigo`, [projetoId])
  const mapa = new Map()
  for (const r of rows) {
    const c = etapaParaMega(r.codigo)
    if (c && (!mapa.has(c) || r.inicio < mapa.get(c))) mapa.set(c, r.inicio)
  }
  return mapa
}

export async function obterMacro(projetoId, hoje = hojeNoBrasil()) {
  const obra = await obraDoProjeto(projetoId)
  if (!obra) return { obra: null, motivo: 'Este projeto não tem obra do Mega vinculada.' }
  const [importacao, classif] = await Promise.all([ultimaImportacao(projetoId), classificadorDaObra(projetoId)])
  const [proj, valores, inicio, gruposRes, etapasRes] = await Promise.all([
    projetadoPorTipo(importacao?.id, classif.tipoDe),
    valoresPorEtapa(obra, classif.tipoDe),
    inicioPorEtapa(projetoId),
    query(`SELECT id, tipo, item, insumos, lead_time, levantamento, prazo_solicitacao, prazo_emissao, prazo_entrega
           FROM contratacao_grupos WHERE projeto_id = $1 ORDER BY ordem, id`, [projetoId]),
    query('SELECT grupo_id, codigo_etapa FROM contratacao_grupo_etapas WHERE projeto_id = $1', [projetoId]),
  ])
  const etapasDo = new Map()
  for (const e of etapasRes.rows) {
    if (!etapasDo.has(e.grupo_id)) etapasDo.set(e.grupo_id, [])
    etapasDo.get(e.grupo_id).push(e.codigo_etapa)
  }
  const grupos = gruposRes.rows.map((g) => ({ ...g, lead_time: Number(g.lead_time) || 0, etapas: etapasDo.get(g.id) || [] }))
  return { obra, importacao, projecaoSemInsumo: proj.semDescricao, classificacaoEmpresa: classif.empresa,
    ...calcularMacro({ grupos, projetado: proj.mapa, valores, inicio, hoje }) }
}

const CAMPOS_REGRA = Object.keys(REGRAS_PADRAO)

export async function obterRegras(projetoId) {
  const { rows } = await query('SELECT regras FROM contratacao_aprovacao_regras WHERE projeto_id = $1', [projetoId])
  return { ...REGRAS_PADRAO, ...(rows[0]?.regras || {}) }
}

export async function salvarRegras(projetoId, regras) {
  const limpo = {}
  for (const c of CAMPOS_REGRA) {
    const n = Number(regras?.[c])
    if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error(`Valor inválido em ${c}`), { status: 400 })
    limpo[c] = n
  }
  await query(
    `INSERT INTO contratacao_aprovacao_regras (projeto_id, regras) VALUES ($1, $2)
     ON CONFLICT (projeto_id) DO UPDATE SET regras = EXCLUDED.regras, atualizado_em = NOW()`, [projetoId, limpo])
  return limpo
}

const TIPO_APPROVO = {
  'Solicitação de Obra': 'SOLICITACAO', 'Estouro de Orçamento': 'ESTOURO', 'Mapa de Cotação': 'MAPA',
  'Pedido de Compra': 'PEDIDO', 'Contrato de Cotação e Materiais': 'CONTRATO', 'Contrato Livre': 'CONTRATO',
  'Aditivo de Contrato de Cotação e Materiais': 'ADITIVO', 'Medição de Contrato': 'MEDICAO',
}

// Micro de um grupo: só os itens das etapas do grupo e do tipo do grupo; do
// Approvo e das medições, só os documentos desses itens (antes carregava a obra
// inteira a cada grupo aberto).
export async function obterMicro(projetoId, grupoId, hoje = hojeNoBrasil()) {
  const obra = await obraDoProjeto(projetoId)
  if (!obra) return { obra: null, itens: [] }
  const [etapasRes, grupoRes, classif] = await Promise.all([
    query(`SELECT codigo_etapa, COALESCE(nome_obra, nome_padrao) AS nome FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND grupo_id = $2`,
      [projetoId, grupoId]),
    query('SELECT tipo FROM contratacao_grupos WHERE id = $1 AND projeto_id = $2', [grupoId, projetoId]),
    classificadorDaObra(projetoId),
  ])
  const nomeEtapa = new Map(etapasRes.rows.map((e) => [e.codigo_etapa, e.nome]))
  const tipoGrupo = grupoRes.rows[0]?.tipo
  if (!nomeEtapa.size || !tipoGrupo) return { obra, itens: [] }
  const itensRes = await query(
    `SELECT v.solicitacao, v.sequencia, MAX(v.descricao) AS descricao, MAX(v.fornecedor) AS fornecedor, MAX(v.valor_total) AS valor,
            MAX(v.cod_cotacao)::bigint AS cotacao, MAX(v.cod_pedido)::bigint AS pedido, MAX(v.cod_contrato)::bigint AS contrato,
            MAX(s.numero_insumo)::text AS cod_insumo, MAX(s.descricao_insumo) AS insumo, ARRAY_AGG(DISTINCT s.codigo_etapa) AS etapas
     FROM mega.solicitacoes_por_etapa s
     JOIN mega.visualizacao_itens v ON v.obra = s.obra AND v.solicitacao = s.codigo_solicitacao AND v.sequencia = s.sequencial_item
     WHERE s.obra = $1 AND s.codigo_etapa = ANY($2)
     GROUP BY v.solicitacao, v.sequencia`, [obra, [...nomeEtapa.keys()]])
  const linhas = itensRes.rows.filter((r) => classif.tipoDe(r.insumo, r.cod_insumo).tipo === tipoGrupo)
  const contratos = [...new Set(linhas.map((r) => r.contrato).filter(Boolean).map(String))]
  const medRes = contratos.length
    ? await query(`SELECT DISTINCT numero_contrato, numero_medicao FROM mega.medicoes_contratos
                   WHERE obra = $1 AND numero_contrato = ANY($2::bigint[]) ORDER BY 2`, [obra, contratos])
    : { rows: [] }
  const numeros = [...new Set([
    ...linhas.flatMap((r) => [r.solicitacao, r.cotacao, r.pedido, r.contrato]),
    ...medRes.rows.map((m) => m.numero_medicao),
  ].filter((x) => x !== null && x !== undefined).map(String))]
  const [docsRes, evRes, regras] = await Promise.all([
    query(`SELECT tipo_documento, numero, valor, TO_CHAR(data_envio_aprovacao, 'YYYY-MM-DD') AS data_envio
           FROM mega.approvo_documentos WHERE obra = $1 AND numero = ANY($2::bigint[])`, [obra, numeros]),
    query(
      `SELECT tipo_documento, numero_documento, acao, aprovador, TO_CHAR(COALESCE(data_hora, data_aprovacao::timestamp), 'YYYY-MM-DD"T"HH24:MI') AS data_hora
       FROM mega.approvo_ocorrencias WHERE obra = $1 AND numero_documento = ANY($2::bigint[]) ORDER BY 5, id`, [obra, numeros]),
    obterRegras(projetoId),
  ])
  const docs = new Map()
  for (const d of docsRes.rows) {
    const t = TIPO_APPROVO[d.tipo_documento]
    if (t) docs.set(`${t}|${d.numero}`, { valor: Number(d.valor), data_envio: d.data_envio })
  }
  const eventos = new Map()
  for (const e of evRes.rows) {
    const t = TIPO_APPROVO[e.tipo_documento]
    if (!t) continue
    const k = `${t}|${e.numero_documento}`
    if (!eventos.has(k)) eventos.set(k, [])
    eventos.get(k).push({ acao: e.acao, aprovador: e.aprovador, data_hora: e.data_hora })
  }
  const medicoesDo = new Map()
  for (const m of medRes.rows) {
    const k = String(m.numero_contrato)
    if (!medicoesDo.has(k)) medicoesDo.set(k, [])
    medicoesDo.get(k).push(Number(m.numero_medicao))
  }
  const itens = []
  for (const r of linhas) {
    const etapas = [...new Set(r.etapas.map(etapaParaMega))].filter((c) => nomeEtapa.has(c))
    if (!etapas.length) continue
    const item = { solicitacao: Number(r.solicitacao), cotacao: r.cotacao && Number(r.cotacao), pedido: r.pedido && Number(r.pedido), contrato: r.contrato && Number(r.contrato) }
    const { passos, parado_em } = calcularTrilha({ item, docs, eventos, medicoes: medicoesDo.get(String(r.contrato)) || [], regras })
    const desde = parado_em?.ultimo?.slice(0, 10) ?? null
    const medicoes = passos.filter((p) => p.passo === 'MEDICAO')
    itens.push({
      ...item, sequencia: r.sequencia, descricao: r.descricao, insumo: r.insumo, fornecedor: r.fornecedor, valor: Number(r.valor) || 0,
      etapas: etapas.map((c) => ({ codigo: c, nome: nomeEtapa.get(c) })),
      passos: passos.filter((p) => p.passo !== 'MEDICAO'), medicoes, resumo_medicoes: resumirMedicoes(medicoes, hoje), parado_em,
      dias_parado: desde ? Math.round((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) : null,
      alerta: tipoGrupo === 'MAO_DE_OBRA' && item.pedido ? 'Insumo de mão de obra comprado por pedido' : null,
    })
  }
  // Agrupado por solicitação: as solicitações paradas há mais tempo primeiro.
  const pior = new Map()
  for (const i of itens) pior.set(i.solicitacao, Math.max(pior.get(i.solicitacao) ?? -1, i.parado_em ? (i.dias_parado ?? 0) : -1))
  itens.sort((a, b) => pior.get(b.solicitacao) - pior.get(a.solicitacao) || a.solicitacao - b.solicitacao || a.sequencia - b.sequencia)
  return { obra, tipo: tipoGrupo, itens }
}
