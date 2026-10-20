// Painel 9 — Teórico x Físico: junta Prevision (orçamento e % físico), Mega (apropriado e saldos),
// custo projetado importado e INCC-DI. Só lê o schema mega.
import { query } from './db.js'
import { etapaParaMega } from './contratacoes.js'
import {
  classificadorDaObra, custosDaImportacao, obraDoProjeto, ultimaImportacao, valoresPorEtapa,
} from './contratacoes-db.js'
import { listarIncc } from './incc.js'
import { criarFatorPosterior, montarLinhas, rankingNivel5 } from './painel-teorico.js'

async function mesBaseDaObra(projetoId) {
  const { rows } = await query(
    `SELECT TO_CHAR(mes_base, 'YYYY-MM') AS mes_base FROM orcamento_reajuste_obra WHERE projeto_id = $1`, [projetoId])
  return rows[0]?.mes_base || null
}

export async function salvarMesBase(projetoId, mesBase) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mesBase || ''))) {
    throw Object.assign(new Error('Informe o mês-base do orçamento (AAAA-MM).'), { status: 400 })
  }
  await query(
    `INSERT INTO orcamento_reajuste_obra (projeto_id, mes_base, atualizado_em) VALUES ($1, $2, NOW())
     ON CONFLICT (projeto_id) DO UPDATE SET mes_base = EXCLUDED.mes_base, atualizado_em = NOW()`,
    [projetoId, `${mesBase}-01`])
  return { mes_base: mesBase }
}

// EAP da Prevision (níveis 1 a 5). Com mais de um orçamento, fica a linha atualizada mais recentemente.
async function itensDaEap(projetoId) {
  const { rows } = await query(
    `SELECT DISTINCT ON (codigo) codigo, descricao, nivel, custo_total::float AS custo_total, peso_realizado::float AS peso_realizado
     FROM cff_itens WHERE projeto_id = $1 AND codigo IS NOT NULL AND nivel BETWEEN 1 AND 5
     ORDER BY codigo, updated_at DESC`, [projetoId])
  return rows
}

// Apropriado por etapa (código Mega) e mês do documento — mesmo filtro do realizado em valoresPorEtapa.
async function apropriadoPorEtapaMes(obra) {
  const { rows } = await query(
    `SELECT raw_data->>'cod_estruturado' AS codigo_etapa, TO_CHAR(data_documento, 'YYYY-MM') AS mes,
            SUM(COALESCE(valor_apropriacao, 0))::float AS valor
     FROM mega.analise_realizado WHERE obra = $1 AND raw_data ? 'cod_estruturado' GROUP BY 1, 2`, [obra])
  return rows
}

export async function obterPainelTeorico(projetoId) {
  const [itens, mesBase, indices, obra, importacao] = await Promise.all([
    itensDaEap(projetoId), mesBaseDaObra(projetoId), listarIncc(), obraDoProjeto(projetoId), ultimaImportacao(projetoId),
  ])
  const { fatorPosterior, ultimoMes } = criarFatorPosterior(indices)

  const porEtapa = new Map()
  const doCodigo = (c) => {
    if (!porEtapa.has(c)) porEtapa.set(c, { apropriado_nominal: 0, apropriado_reajustado: 0, saldo_contratos: 0, saldo_pedidos: 0 })
    return porEtapa.get(c)
  }
  let apropriadoSemEtapa = 0
  if (obra) {
    const classif = await classificadorDaObra(projetoId)
    const [apropriado, valores] = await Promise.all([apropriadoPorEtapaMes(obra), valoresPorEtapa(obra, classif.tipoDe)])
    for (const r of apropriado) {
      const c = etapaParaMega(r.codigo_etapa)
      if (!c) { apropriadoSemEtapa += r.valor; continue }
      const v = doCodigo(c)
      v.apropriado_nominal += r.valor
      v.apropriado_reajustado += r.valor * fatorPosterior(r.mes)
    }
    // valoresPorEtapa vem por 'etapa|TIPO': soma material e mão de obra
    for (const [chave, v] of valores) {
      const s = doCodigo(chave.split('|')[0])
      s.saldo_contratos += v.em_contrato
      s.saldo_pedidos += v.em_pedido
    }
  }

  const projetado = importacao ? await custosDaImportacao(importacao.id) : null
  const linhas = montarLinhas({
    itens, porEtapa, projetado, fatorBase: mesBase ? fatorPosterior(mesBase) : null, paraMega: etapaParaMega,
  })
  const mesesDesdeBase = mesBase ? indices.filter((i) => i.mes > mesBase) : []

  return {
    obra,
    importacao,
    apropriadoSemEtapa,
    reajuste: {
      indice: 'INCC-DI',
      mes_base: mesBase,
      fator: mesBase ? fatorPosterior(mesBase) : null,
      ultimo_mes: ultimoMes,
      meses: mesesDesdeBase,
    },
    linhas,
    ranking: { A: rankingNivel5(linhas, 'A'), B: rankingNivel5(linhas, 'B') },
  }
}
