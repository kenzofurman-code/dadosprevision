// Acesso a banco da Gestão de Contratações. Regras puras em ./contratacoes.js.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { query, withTransaction } from './db.js'
import {
  etapaParaMega, nivelDoCodigo, resolverEtapasPadrao, expandirParaNivel5,
  sugestoesPorNome, lerCustoProjetado,
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

export async function obterConfig(projetoId) {
  const [orcamento, importacao, gruposRes, etapasRes, padraoRes] = await Promise.all([
    orcamentoDaObra(projetoId),
    ultimaImportacao(projetoId),
    query('SELECT * FROM contratacao_grupos WHERE projeto_id = $1 ORDER BY ordem, id', [projetoId]),
    query('SELECT * FROM contratacao_grupo_etapas WHERE projeto_id = $1 ORDER BY codigo_etapa', [projetoId]),
    query(`SELECT e.codigo_etapa, e.nome_padrao, g.ordem, g.id AS padrao_id FROM contratacao_grupo_etapas e
           JOIN contratacao_grupos g ON g.id = e.grupo_id WHERE e.projeto_id IS NULL`),
  ])
  const custos = await custosDaImportacao(importacao?.id)
  const porGrupo = new Map()
  const usadas = new Set()
  for (const e of etapasRes.rows) {
    usadas.add(e.codigo_etapa)
    if (!porGrupo.has(e.grupo_id)) porGrupo.set(e.grupo_id, [])
    porGrupo.get(e.grupo_id).push({ ...e, custo_projetado: custos.get(e.codigo_etapa) ?? null })
  }
  const grupos = gruposRes.rows.map((g) => ({ ...g, etapas: porGrupo.get(g.id) || [] }))
  const pendBase = [...orcamento.entries()]
    .filter(([c]) => nivelDoCodigo(c) === 5 && !usadas.has(c))
    .map(([codigo, nome]) => ({ codigo, nome }))
  const sugestoes = sugestoesPorNome(pendBase,
    padraoRes.rows.map((r) => ({ codigo: r.codigo_etapa, nome: r.nome_padrao, ordem: r.ordem })))
  const grupoPorPadraoOrdem = new Map()
  const ordemPorPadraoId = new Map(padraoRes.rows.map((r) => [r.padrao_id, r.ordem]))
  for (const g of grupos) {
    const ordemPadrao = ordemPorPadraoId.get(g.padrao_grupo_id)
    if (ordemPadrao !== undefined) grupoPorPadraoOrdem.set(ordemPadrao, g)
  }
  const pendencias = pendBase.map((p) => {
    const s = sugestoes.get(p.codigo)
    const g = s ? grupoPorPadraoOrdem.get(s.ordem) : null
    return {
      codigo_etapa: p.codigo, nome: p.nome, custo_projetado: custos.get(p.codigo) ?? null,
      sugestao: g ? { grupo_id: g.id, item: g.item, codigo_padrao: s.codigo_padrao } : null,
    }
  }).sort((a, b) => (b.custo_projetado ?? -1) - (a.custo_projetado ?? -1) || a.codigo_etapa.localeCompare(b.codigo_etapa))
  const orcamentoTotal = [...custos.values()].reduce((s, v) => s + v, 0)
  return { aplicado: grupos.length > 0, grupos, pendencias, importacao, orcamentoTotal }
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
    for (const v of vinculos) {
      await q(
        `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, situacao, nome_padrao, nome_obra, origem_nivel4)
         VALUES ($1,$2,$3,5,$4,$5,$6,$7)`,
        [idPorOrdem.get(v.ordem), projetoId, v.codigo_etapa, v.situacao, v.nome_padrao, v.nome_obra, v.origem_nivel4],
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
    const { rows: [grupo] } = await q('SELECT id FROM contratacao_grupos WHERE id = $1 AND projeto_id = $2', [grupoId, projetoId])
    if (!grupo) throw Object.assign(new Error('Grupo não encontrado nesta obra.'), { status: 404 })
    const { rows: existentes } = await q(
      `SELECT e.codigo_etapa, e.grupo_id, g.item FROM contratacao_grupo_etapas e JOIN contratacao_grupos g ON g.id = e.grupo_id
       WHERE e.projeto_id = $1 AND e.codigo_etapa = ANY($2) AND e.grupo_id <> $3`,
      [projetoId, alvo.map((a) => a.codigo_etapa), grupoId])
    if (existentes.length && !mover) return { inseridas: 0, conflitos: existentes }
    await q('DELETE FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND codigo_etapa = ANY($2)',
      [projetoId, alvo.map((a) => a.codigo_etapa)])
    for (const a of alvo) {
      await q(
        `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, situacao, nome_obra, origem_nivel4)
         VALUES ($1,$2,$3,5,'CONFIRMADO',$4,$5)`,
        [grupoId, projetoId, a.codigo_etapa, orcamento.get(a.codigo_etapa) || '', a.origem_nivel4])
    }
    return { inseridas: alvo.length, conflitos: [] }
  })
}

export async function soltarEtapa(projetoId, codigo) {
  await query('DELETE FROM contratacao_grupo_etapas WHERE projeto_id = $1 AND codigo_etapa = $2', [projetoId, codigo])
}

export async function confirmarEtapa(projetoId, codigo) {
  await query(`UPDATE contratacao_grupo_etapas SET situacao = 'CONFIRMADO' WHERE projeto_id = $1 AND codigo_etapa = $2`, [projetoId, codigo])
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
    return { id: imp.id, total: lido.total, itens: lido.itens.length }
  })
}
