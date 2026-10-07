// Consultas e persistência de dados para as Curvas de Competência e Financeira
import { query } from './db.js'
import { calcularCurvasFinanceiras } from './curvas-financeiras-engine.js'
import { etapaParaMega } from './contratacoes.js'

/**
 * Busca os parâmetros da obra ou retorna defaults
 */
export async function obterParametrosObra(projetoId) {
  const { rows } = await query(
    `SELECT projeto_id, dias_antecedencia_padrao, prazo_pagamento_padrao_dias,
            dia_corte_medicao_mo, dia_pagamento_mo, atualizado_em
     FROM curva_parametros_obra WHERE projeto_id = $1`,
    [projetoId]
  )
  if (rows.length > 0) return rows[0]

  return {
    projeto_id: projetoId,
    dias_antecedencia_padrao: 10,
    prazo_pagamento_padrao_dias: 28,
    dia_corte_medicao_mo: 20,
    dia_pagamento_mo: 5,
    atualizado_em: null,
  }
}

/**
 * Busca parâmetros específicos por etapa configurados para a obra
 */
export async function obterParametrosEtapas(projetoId) {
  const { rows } = await query(
    `SELECT id, projeto_id, codigo_etapa, tipo, dias_antecedencia, num_entregas,
            tipo_pagamento, prazo_dias, parcelas_dias, observacao, atualizado_em
     FROM curva_parametros_etapa WHERE projeto_id = $1`,
    [projetoId]
  )
  const mapa = new Map()
  for (const r of rows) {
    mapa.set(r.codigo_etapa, r)
  }
  return { lista: rows, mapa }
}

/**
 * Salva parâmetros da obra e parâmetros de etapas
 */
export async function salvarParametrosCurvas(projetoId, { parametrosObra, parametrosEtapa, parametrosEtapas }) {
  // 1. Salvar parâmetros gerais da obra
  if (parametrosObra) {
    await query(
      `INSERT INTO curva_parametros_obra (projeto_id, dias_antecedencia_padrao, prazo_pagamento_padrao_dias, dia_corte_medicao_mo, dia_pagamento_mo, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (projeto_id) DO UPDATE SET
         dias_antecedencia_padrao = EXCLUDED.dias_antecedencia_padrao,
         prazo_pagamento_padrao_dias = EXCLUDED.prazo_pagamento_padrao_dias,
         dia_corte_medicao_mo = EXCLUDED.dia_corte_medicao_mo,
         dia_pagamento_mo = EXCLUDED.dia_pagamento_mo,
         atualizado_em = NOW()`,
      [
        projetoId,
        Number(parametrosObra.dias_antecedencia_padrao || 10),
        Number(parametrosObra.prazo_pagamento_padrao_dias || 28),
        Number(parametrosObra.dia_corte_medicao_mo || 20),
        Number(parametrosObra.dia_pagamento_mo || 5),
      ]
    )
  }

  // 2. Salvar parâmetros específicos de etapas (aceita lista ou objeto único)
  const itens = Array.isArray(parametrosEtapas)
    ? parametrosEtapas
    : (parametrosEtapa ? [parametrosEtapa] : [])

  for (const item of itens) {
    if (!item?.codigo_etapa) continue
    const cod = String(item.codigo_etapa).trim()
    const tipo = String(item.tipo || 'MATERIAL').toUpperCase()

    if (item.remover) {
      await query(
        `DELETE FROM curva_parametros_etapa WHERE projeto_id = $1 AND codigo_etapa = $2 AND tipo = $3`,
        [projetoId, cod, tipo]
      )
      continue
    }

    await query(
      `INSERT INTO curva_parametros_etapa (
         projeto_id, codigo_etapa, tipo, dias_antecedencia, num_entregas,
         tipo_pagamento, prazo_dias, parcelas_dias, observacao, atualizado_em
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (projeto_id, codigo_etapa, tipo) DO UPDATE SET
         dias_antecedencia = EXCLUDED.dias_antecedencia,
         num_entregas = EXCLUDED.num_entregas,
         tipo_pagamento = EXCLUDED.tipo_pagamento,
         prazo_dias = EXCLUDED.prazo_dias,
         parcelas_dias = EXCLUDED.parcelas_dias,
         observacao = EXCLUDED.observacao,
         atualizado_em = NOW()`,
      [
        projetoId,
        cod,
        tipo,
        item.dias_antecedencia !== undefined ? item.dias_antecedencia : null,
        item.num_entregas !== undefined ? item.num_entregas : null,
        item.tipo_pagamento || 'DIAS',
        item.prazo_dias !== undefined ? item.prazo_dias : 28,
        Array.isArray(item.parcelas_dias) ? item.parcelas_dias : null,
        item.observacao || null,
      ]
    )
  }

  return { ok: true }
}

/**
 * Consulta e monta todo o payload das Curvas de Competência e Financeira para o projeto
 */
export async function obterDadosCurvasFinanceiras(projetoId) {
  const pId = String(projetoId).trim()

  // 1. Parâmetros da Obra e das Etapas
  const [paramsObra, paramsEtapasObj] = await Promise.all([
    obterParametrosObra(pId),
    obterParametrosEtapas(pId),
  ])

  // 2. Buscar última importação de Custo Projetado (se houver)
  const impRes = await query(
    `SELECT id, referencia, total, importado_em, arquivo
     FROM custo_projetado_importacoes
     WHERE projeto_id = $1
     ORDER BY importado_em DESC LIMIT 1`,
    [pId]
  )
  const importacao = impRes.rows[0] || null

  // 3. Buscar custos projetados por etapa e insumos (Material x MO)
  const custosPorEtapaMega = new Map()
  if (importacao) {
    // Buscar classificação de insumos da obra / empresa
    const classifRes = await query(
      `SELECT LOWER(TRIM(descricao)) as descr, tipo
       FROM insumo_classificacao
       WHERE projeto_id = $1 OR projeto_id IS NULL
       ORDER BY (projeto_id IS NOT NULL) DESC`,
      [pId]
    )
    const classifMapa = new Map()
    for (const c of classifRes.rows) {
      if (!classifMapa.has(c.descr)) classifMapa.set(c.descr, c.tipo)
    }

    // Buscar insumos detalhados da importação
    const insumosRes = await query(
      `SELECT codigo_etapa, descricao, custo_projetado
       FROM custo_projetado_insumos
       WHERE importacao_id = $1`,
      [importacao.id]
    )

    for (const row of insumosRes.rows) {
      const cod = row.codigo_etapa
      const v = Number(row.custo_projetado) || 0
      const descr = String(row.descricao || '').toLowerCase().trim()
      const tipo = classifMapa.get(descr) || (descr.startsWith('mo ') || descr.includes('mao de obra') ? 'MAO_DE_OBRA' : 'MATERIAL')

      if (!custosPorEtapaMega.has(cod)) {
        custosPorEtapaMega.set(cod, { material: 0, mao_de_obra: 0, total: 0 })
      }
      const item = custosPorEtapaMega.get(cod)
      if (tipo === 'MAO_DE_OBRA') item.mao_de_obra += v
      else item.material += v
      item.total += v
    }
  }

  // 4. Buscar etapas nível 5 de cff_itens (Prevision)
  const cffRes = await query(
    `SELECT codigo, descricao, nivel, data_inicio::text as data_inicio, data_fim::text as data_fim,
            custo_mao_obra, custo_material, custo_total, peso_base, peso_previsto, peso_realizado,
            pontos_mensais
     FROM cff_itens
     WHERE projeto_id = $1 AND nivel = 5
     ORDER BY codigo ASC`,
    [pId]
  )

  // 5. Montar lista de etapas unificada
  const etapasParaCalculo = []
  let realizadoTotalPrevision = 0

  for (const row of cffRes.rows) {
    const codMega = etapaParaMega(row.codigo) || row.codigo
    const cp = custosPorEtapaMega.get(codMega)

    // Se temos Custo Projetado detalhado da Piemonte, usamos ele com prioridade máxima.
    // Senão, fallback para os custos do CFF da Prevision.
    let cMat = 0
    let cMo = 0
    let cTot = 0

    if (cp && cp.total > 0) {
      cMat = cp.material
      cMo = cp.mao_de_obra
      cTot = cp.total
    } else {
      cMat = Number(row.custo_material || 0)
      cMo = Number(row.custo_mao_obra || 0)
      cTot = Number(row.custo_total || cMat + cMo)
    }

    // Realizado histórico aproximado baseado no peso realizado do CFF
    const pesoRealizado = Number(row.peso_realizado || 0)
    realizadoTotalPrevision += cTot * Math.min(1, Math.max(0, pesoRealizado))

    etapasParaCalculo.push({
      codigo_etapa: codMega,
      codigo_prevision: row.codigo,
      nome: row.descricao,
      nivel: row.nivel,
      data_inicio: row.data_inicio,
      data_fim: row.data_fim,
      custo_material: cMat,
      custo_mao_obra: cMo,
      custo_total: cTot,
      pontos_mensais: Array.isArray(row.pontos_mensais) ? row.pontos_mensais : [],
    })
  }

  // 6. Rodar o motor de cálculo
  const resultadoMotor = calcularCurvasFinanceiras({
    etapas: etapasParaCalculo,
    parametrosObra: paramsObra,
    parametrosEtapas: paramsEtapasObj.mapa,
    realizadoHistorico: Math.round(realizadoTotalPrevision * 100) / 100,
  })

  return {
    ok: true,
    projetoId: pId,
    importacaoCustoProjetado: importacao,
    parametrosObra: paramsObra,
    parametrosEtapas: paramsEtapasObj.lista,
    ...resultadoMotor,
  }
}
