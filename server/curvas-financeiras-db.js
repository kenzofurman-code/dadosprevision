// Consultas e persistência de dados para as Curvas de Competência e Financeira
import { query, withTransaction } from './db.js'
import { aplicarVinculos, calcularCurvasFinanceiras, projetarRealizado, proximoMesIso, separarForaDoCronograma } from './curvas-financeiras-engine.js'
import { etapaParaMega, hojeNoBrasil } from './contratacoes.js'
import { classificadorDaObra, obraDoProjeto, orcamentoDaObra, projetadoPorTipo } from './contratacoes-db.js'
import { lerConciliacaoFinanceira } from './pagamentos-ap.js'

/** Nível 1 do orçamento de um código estruturado ('01.03.05.02.002' → '01'). */
export const nivel1DoCodigo = (codigo) => {
  const n = String(codigo ?? '').trim().split('.')[0]
  return /^\d+$/.test(n) ? n.padStart(2, '0') : ''
}

/** Vínculos manuais da obra: Map código de origem (custo projetado/Mega) → etapa do cronograma. */
export async function obterVinculosEtapa(projetoId) {
  const { rows } = await query('SELECT codigo_origem, codigo_destino FROM curva_vinculo_etapa WHERE projeto_id = $1 ORDER BY codigo_origem', [projetoId])
  return { lista: rows, mapa: new Map(rows.map((r) => [r.codigo_origem, r.codigo_destino])) }
}

/** Cria, troca ou remove o vínculo de um código de origem. O destino precisa ser etapa nível 5 do cronograma. */
export async function salvarVinculoEtapa(projetoId, { codigo_origem, codigo_destino, remover }) {
  const origem = etapaParaMega(codigo_origem) || String(codigo_origem ?? '').trim()
  if (!origem) throw Object.assign(new Error('Informe o código de origem.'), { status: 400 })
  if (remover) {
    await query('DELETE FROM curva_vinculo_etapa WHERE projeto_id = $1 AND codigo_origem = $2', [projetoId, origem])
    return { ok: true }
  }
  const destino = etapaParaMega(codigo_destino)
  if (!destino) throw Object.assign(new Error('Código de destino inválido.'), { status: 400 })
  if (destino === origem) throw Object.assign(new Error('Origem e destino são o mesmo código.'), { status: 400 })
  const { rows } = await query('SELECT codigo FROM cff_itens WHERE projeto_id = $1 AND nivel = 5', [projetoId])
  if (!rows.some((r) => (etapaParaMega(r.codigo) || r.codigo) === destino)) {
    throw Object.assign(new Error('O destino precisa ser uma etapa (nível 5) do cronograma da Prevision.'), { status: 400 })
  }
  await query(
    `INSERT INTO curva_vinculo_etapa (projeto_id, codigo_origem, codigo_destino, atualizado_em) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (projeto_id, codigo_origem) DO UPDATE SET codigo_destino = EXCLUDED.codigo_destino, atualizado_em = NOW()`,
    [projetoId, origem, destino])
  return { ok: true }
}

/** Quais níveis 1 entram nas curvas: tudo, menos os desmarcados nos parâmetros da obra. */
const nivel1Considerado = (parametrosObra) => {
  const fora = new Set((parametrosObra?.niveis1_excluidos || []).map(String))
  return (codigo) => !fora.has(nivel1DoCodigo(codigo))
}

/**
 * Busca os parâmetros da obra ou retorna defaults
 */
export async function obterParametrosObra(projetoId) {
  const { rows } = await query(
    `SELECT projeto_id, dias_antecedencia_padrao, prazo_pagamento_padrao_dias,
            dia_corte_medicao_mo, dia_pagamento_mo, retencao_mo_ativa,
            retencao_mo_percentual::float AS retencao_mo_percentual, data_fim_obra::text AS data_fim_obra,
            niveis1_excluidos, atualizado_em
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
    retencao_mo_ativa: false,
    retencao_mo_percentual: 5,
    data_fim_obra: null,
    niveis1_excluidos: [],
    atualizado_em: null,
  }
}

/**
 * Busca parâmetros específicos por etapa configurados para a obra
 */
export async function obterParametrosEtapas(projetoId) {
  const { rows } = await query(
    `SELECT id, projeto_id, codigo_etapa, tipo, dias_antecedencia, num_entregas,
            tipo_pagamento, prazo_dias, parcelas_dias, parcelas_pct::float8[] AS parcelas_pct, retencao_ativa,
            retencao_percentual::float AS retencao_percentual, observacao, atualizado_em
     FROM curva_parametros_etapa WHERE projeto_id = $1
     ORDER BY codigo_etapa, tipo`,
    [projetoId]
  )
  // Chave codigo|tipo: a regra de MO e a de Material da mesma etapa não se sobrescrevem
  const mapa = new Map()
  for (const r of rows) {
    mapa.set(`${r.codigo_etapa}|${r.tipo}`, r)
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
      `INSERT INTO curva_parametros_obra (projeto_id, dias_antecedencia_padrao, prazo_pagamento_padrao_dias, dia_corte_medicao_mo, dia_pagamento_mo,
                                          retencao_mo_ativa, retencao_mo_percentual, data_fim_obra, niveis1_excluidos, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::text[], '{}'), NOW())
       ON CONFLICT (projeto_id) DO UPDATE SET
         dias_antecedencia_padrao = EXCLUDED.dias_antecedencia_padrao,
         prazo_pagamento_padrao_dias = EXCLUDED.prazo_pagamento_padrao_dias,
         dia_corte_medicao_mo = EXCLUDED.dia_corte_medicao_mo,
         dia_pagamento_mo = EXCLUDED.dia_pagamento_mo,
         retencao_mo_ativa = EXCLUDED.retencao_mo_ativa,
         retencao_mo_percentual = EXCLUDED.retencao_mo_percentual,
         data_fim_obra = EXCLUDED.data_fim_obra,
         niveis1_excluidos = COALESCE($9::text[], curva_parametros_obra.niveis1_excluidos),
         atualizado_em = NOW()`,
      [
        projetoId,
        Number(parametrosObra.dias_antecedencia_padrao ?? 10),
        Number(parametrosObra.prazo_pagamento_padrao_dias ?? 28),
        Number(parametrosObra.dia_corte_medicao_mo || 20),
        Number(parametrosObra.dia_pagamento_mo || 5),
        Boolean(parametrosObra.retencao_mo_ativa),
        Number(parametrosObra.retencao_mo_percentual ?? 5),
        /^\d{4}-\d{2}-\d{2}$/.test(String(parametrosObra.data_fim_obra || '')) ? parametrosObra.data_fim_obra : null,
        Array.isArray(parametrosObra.niveis1_excluidos)
          ? [...new Set(parametrosObra.niveis1_excluidos.map(nivel1DoCodigo).filter(Boolean))]
          : null,
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
         tipo_pagamento, prazo_dias, parcelas_dias, parcelas_pct, retencao_ativa, retencao_percentual, observacao, atualizado_em
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (projeto_id, codigo_etapa, tipo) DO UPDATE SET
         dias_antecedencia = EXCLUDED.dias_antecedencia,
         num_entregas = EXCLUDED.num_entregas,
         tipo_pagamento = EXCLUDED.tipo_pagamento,
         prazo_dias = EXCLUDED.prazo_dias,
         parcelas_dias = EXCLUDED.parcelas_dias,
         parcelas_pct = EXCLUDED.parcelas_pct,
         retencao_ativa = EXCLUDED.retencao_ativa,
         retencao_percentual = EXCLUDED.retencao_percentual,
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
        Array.isArray(item.parcelas_dias) ? item.parcelas_dias.slice(0, 60) : null,
        Array.isArray(item.parcelas_dias) && Array.isArray(item.parcelas_pct) && item.parcelas_pct.length === item.parcelas_dias.length
          ? item.parcelas_pct.slice(0, 60).map(Number)
          : null,
        typeof item.retencao_ativa === 'boolean' ? item.retencao_ativa : null,
        item.retencao_percentual !== undefined && item.retencao_percentual !== null && item.retencao_percentual !== ''
          ? Number(item.retencao_percentual)
          : null,
        item.observacao || null,
      ]
    )
  }

  return { ok: true }
}

/**
 * Entrada do motor (parâmetros e etapas nível 5 com custo e físico), comum à curva teórica e ao
 * Realizado + projeção.
 */
async function montarEntradaCurvas(pId) {
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
  const considera = nivel1Considerado(paramsObra)

  // 3. Custo projetado por etapa, separado em Material x MO com a MESMA classificação da
  //    Gestão de Contratações (insumos da empresa + ajustes da obra).
  const vinculos = await obterVinculosEtapa(pId)
  let custosPorEtapaMega = new Map()
  if (importacao) {
    const classif = await classificadorDaObra(pId)
    const proj = await projetadoPorTipo(importacao.id, classif.tipoDe)
    for (const [chave, v] of proj.mapa) {
      const [cod, tipo] = chave.split('|')
      if (!considera(cod)) continue
      if (!custosPorEtapaMega.has(cod)) custosPorEtapaMega.set(cod, { material: 0, mao_de_obra: 0, total: 0, descricao: '' })
      const item = custosPorEtapaMega.get(cod)
      if (tipo === 'MAO_DE_OBRA') item.mao_de_obra += v
      else item.material += v
      item.total += v
      // descrição do maior insumo da etapa, para identificar o que está fora do cronograma
      const maior = (proj.detalhes.get(chave) || []).reduce((a, b) => (b.custo_projetado > (a?.custo_projetado ?? -Infinity) ? b : a), null)
      if (maior && !item.descricao) item.descricao = maior.descricao
    }
  }

  custosPorEtapaMega = aplicarVinculos(custosPorEtapaMega, vinculos.mapa)

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
  const etapasSemProjetado = []
  let realizadoTotalPrevision = 0
  const { dentro: projetadoNoCronograma, fora: projetadoFora, totalFora } = separarForaDoCronograma(
    custosPorEtapaMega,
    new Set(cffRes.rows.map((r) => etapaParaMega(r.codigo) || r.codigo))
  )
  // Nome da etapa no orçamento da obra (nível 5; sem ele, o do grupo nível 4) para identificar o que está fora
  if (projetadoFora.length) {
    // 1º o nome que vem do próprio custo projetado importado; depois o orçamento da obra
    const [orcamento, nomesCusto] = await Promise.all([
      orcamentoDaObra(pId),
      importacao
        ? query('SELECT codigo_etapa, nome_etapa FROM custo_projetado_itens WHERE importacao_id = $1 AND nome_etapa IS NOT NULL', [importacao.id])
        : { rows: [] },
    ])
    const nomeCusto = new Map(nomesCusto.rows.map((r) => [r.codigo_etapa, r.nome_etapa]))
    for (const f of projetadoFora) {
      const doCusto = nomeCusto.get(f.codigo)
      const exato = orcamento.get(f.codigo)
      const grupo = orcamento.get(f.codigo.split('.').slice(0, 4).join('.'))
      f.etapa = doCusto ? { nome: doCusto, aproximado: false }
        : exato ? { nome: exato, aproximado: false }
        : grupo ? { nome: grupo, aproximado: true } : null
    }
  }

  for (const row of cffRes.rows) {
    const codMega = etapaParaMega(row.codigo) || row.codigo
    if (!considera(codMega)) continue
    const cp = projetadoNoCronograma.get(codMega)
    if (importacao && !(cp && cp.total > 0) && Number(row.custo_total) > 0) {
      etapasSemProjetado.push({ codigo: codMega, nome: row.descricao, orcamento: Number(row.custo_total) })
    }

    // Com Custo Projetado importado, ele manda: etapa sem projetado vale zero (economia ou
    // etapa que não será feita). Sem importação, fallback para os custos do CFF da Prevision.
    let cMat = 0
    let cMo = 0
    let cTot = 0

    if (importacao) {
      if (cp && cp.total > 0) {
        cMat = cp.material
        cMo = cp.mao_de_obra
        cTot = cp.total
      }
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

  return { paramsObra, paramsEtapasObj, importacao, etapasParaCalculo, realizadoTotalPrevision, projetadoFora, totalFora, etapasSemProjetado, vinculos: vinculos.lista }
}

/**
 * Consulta e monta todo o payload das Curvas de Competência e Financeira para o projeto
 */
export async function obterDadosCurvasFinanceiras(projetoId) {
  const pId = String(projetoId).trim()
  const {
    paramsObra, paramsEtapasObj, importacao, etapasParaCalculo, realizadoTotalPrevision, projetadoFora, totalFora, etapasSemProjetado, vinculos,
  } = await montarEntradaCurvas(pId)
  const niveis1 = await niveis1Disponiveis(pId, await obraDoProjeto(pId), importacao?.id, paramsObra)

  // 6. Rodar o motor de cálculo
  const resultadoMotor = calcularCurvasFinanceiras({
    etapas: etapasParaCalculo,
    parametrosObra: paramsObra,
    parametrosEtapas: paramsEtapasObj.mapa,
    realizadoHistorico: Math.round(realizadoTotalPrevision * 100) / 100,
  })

  // 7. Etapas-mãe (níveis 1 a 4): regras por hierarquia (3 e 4) e planilha analítica (todos)
  const hierRes = await query(
    `SELECT DISTINCT codigo, descricao AS nome, nivel
     FROM cff_itens
     WHERE projeto_id = $1 AND nivel IN (1, 2, 3, 4) AND codigo IS NOT NULL
     ORDER BY codigo ASC`,
    [pId]
  )

  return {
    ok: true,
    projetoId: pId,
    importacaoCustoProjetado: importacao,
    parametrosObra: paramsObra,
    parametrosEtapas: paramsEtapasObj.lista,
    etapasHierarquia: hierRes.rows,
    niveis1,
    // Custo projetado que não entra nas curvas (sem etapa nível 5 no cronograma) e etapas do
    // cronograma sem custo projetado (essas valem zero: economia).
    conciliacaoProjetado: importacao
      ? {
          totalFora, fora: projetadoFora, etapasSemProjetado, vinculos,
          etapasDestino: etapasParaCalculo.map((e) => ({ codigo: e.codigo_etapa, nome: e.nome })),
        }
      : null,
    ...resultadoMotor,
  }
}

// ---- Versões salvas -------------------------------------------------------

/** Congela o resultado atual (recalculado agora no servidor) com um nome. */
export async function salvarVersaoCurvas(projetoId, nome) {
  const dados = await obterDadosCurvasFinanceiras(projetoId)
  const etapas = dados.etapas.map(({ eventos: _eventos, eventosEconomico: _eventosEconomico, fluxos: _fluxos, ...resto }) => resto)
  const payload = {
    kpis: dados.kpis,
    meses: dados.meses,
    seriesMensal: dados.seriesMensal,
    etapas,
    parametrosObra: dados.parametrosObra,
    parametrosEtapas: dados.parametrosEtapas,
    importacaoCustoProjetado: dados.importacaoCustoProjetado,
  }
  const nomeFinal = String(nome || '').trim().slice(0, 120) || `Versão ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
  const { rows } = await query(
    `INSERT INTO curva_versoes (projeto_id, nome, payload) VALUES ($1, $2, $3)
     RETURNING id, nome, criado_em`,
    [projetoId, nomeFinal, payload]
  )
  return { versao: rows[0] }
}

export async function listarVersoesCurvas(projetoId) {
  const { rows } = await query(
    `SELECT id, nome, criado_em, (payload->'kpis'->>'totalOrcado')::float AS total_orcado
     FROM curva_versoes WHERE projeto_id = $1 ORDER BY criado_em DESC`,
    [projetoId]
  )
  return { versoes: rows }
}

export async function obterVersaoCurvas(projetoId, id) {
  const { rows } = await query(
    `SELECT id, nome, criado_em, payload FROM curva_versoes WHERE projeto_id = $1 AND id = $2`,
    [projetoId, id]
  )
  if (!rows.length) throw Object.assign(new Error('Versão não encontrada.'), { status: 404 })
  return { versao: rows[0] }
}

export async function excluirVersaoCurvas(projetoId, id) {
  await query(`DELETE FROM curva_versoes WHERE projeto_id = $1 AND id = $2`, [projetoId, id])
  return {}
}

// ---- Realizado + projeção -------------------------------------------------

/** Grava a planilha "Conciliação Financeira" do projeto, substituindo a anterior. */
export async function importarPagamentos(projetoId, { arquivo, matriz }) {
  const { linhas, erros } = lerConciliacaoFinanceira(matriz)
  if (erros.length) throw Object.assign(new Error(erros.join(' ')), { status: 400 })
  if (!linhas.length) throw Object.assign(new Error('Nenhuma AP encontrada na planilha.'), { status: 400 })
  const col = (k) => linhas.map((l) => l[k])
  return withTransaction(async (q) => {
    await q('DELETE FROM pagamentos_ap WHERE projeto_id = $1', [projetoId])
    const { rows: [r] } = await q(
      `INSERT INTO pagamentos_ap (projeto_id, ap, parcela, tipo_documento, vencimento, valor_rateado, pago, saldo, cod_estruturado, arquivo)
       SELECT $1, ap, parcela, tipo, venc, valor, pago, saldo, cod, $10
       FROM unnest($2::int[], $3::text[], $4::text[], $5::date[], $6::numeric[], $7::numeric[], $8::numeric[], $9::text[])
         AS x(ap, parcela, tipo, venc, valor, pago, saldo, cod)
       RETURNING importado_em`,
      [projetoId, col('ap'), col('parcela'), col('tipo_documento'), col('vencimento'), col('valor_rateado'),
        col('pago'), col('saldo'), col('cod_estruturado'), arquivo ? String(arquivo).slice(0, 200) : null])
    return { linhas: linhas.length, total: Math.round(linhas.reduce((s, l) => s + l.valor_rateado, 0) * 100) / 100, importado_em: r?.importado_em }
  })
}

/** Parcelas por AP (Map ap → [{ vencimento, valor, saldo }]) e quando a planilha foi carregada. */
export async function pagamentosDoProjeto(projetoId, considera = () => true) {
  const { rows } = await query(
    `SELECT ap, vencimento::text AS vencimento, valor_rateado::float AS valor, pago::float AS pago, saldo::float AS saldo,
            cod_estruturado, arquivo, importado_em
     FROM pagamentos_ap WHERE projeto_id = $1 AND vencimento IS NOT NULL`, [projetoId])
  const mapa = new Map()
  for (const r of rows) {
    if (!considera(r.cod_estruturado)) continue
    if (!mapa.has(r.ap)) mapa.set(r.ap, [])
    mapa.get(r.ap).push({ vencimento: r.vencimento, valor: r.valor, pago: r.pago, saldo: r.saldo })
  }
  return { mapa, importado_em: rows[0]?.importado_em || null, arquivo: rows[0]?.arquivo || null }
}

/**
 * Níveis 1 do orçamento que aparecem no custo projetado, no apropriado do Mega ou na conciliação,
 * com o total de cada fonte (para escolher o que entra nas curvas) e se estão considerados.
 */
async function niveis1Disponiveis(projetoId, obra, importacaoId, paramsObra) {
  const [proj, real, pago, nomes] = await Promise.all([
    importacaoId
      ? query(`SELECT split_part(codigo_etapa, '.', 1) AS n1, SUM(custo_projetado)::float AS v
               FROM custo_projetado_itens WHERE importacao_id = $1 GROUP BY 1`, [importacaoId])
      : { rows: [] },
    obra
      ? query(`SELECT split_part(raw_data->>'cod_estruturado', '.', 1) AS n1, SUM(COALESCE(valor_apropriacao, 0))::float AS v
               FROM mega.analise_realizado WHERE obra = $1 AND COALESCE(raw_data->>'cod_estruturado', '') <> '' GROUP BY 1`, [obra])
      : { rows: [] },
    query(`SELECT split_part(cod_estruturado, '.', 1) AS n1, SUM(pago)::float AS v
           FROM pagamentos_ap WHERE projeto_id = $1 GROUP BY 1`, [projetoId]),
    query(`SELECT codigo, MAX(descricao) AS nome FROM (
             SELECT codigo, descricao FROM pesos_orcamento WHERE projeto_id = $1
             UNION ALL SELECT codigo, descricao FROM cff_itens WHERE projeto_id = $1
           ) o WHERE codigo ~ '^\\d{1,2}$' GROUP BY codigo`, [projetoId]),
  ])
  const nome = new Map(nomes.rows.map((r) => [nivel1DoCodigo(r.codigo), r.nome]))
  const lista = new Map()
  const item = (n1) => {
    if (!lista.has(n1)) lista.set(n1, { codigo: n1, nome: nome.get(n1) || null, projetado: 0, apropriado: 0, pago: 0 })
    return lista.get(n1)
  }
  for (const r of proj.rows) if (nivel1DoCodigo(r.n1)) item(nivel1DoCodigo(r.n1)).projetado += r.v
  for (const r of real.rows) if (nivel1DoCodigo(r.n1)) item(nivel1DoCodigo(r.n1)).apropriado += r.v
  for (const r of pago.rows) if (nivel1DoCodigo(r.n1)) item(nivel1DoCodigo(r.n1)).pago += r.v
  const considera = nivel1Considerado(paramsObra)
  return [...lista.values()]
    .map((n) => ({ ...n, considerado: considera(n.codigo) }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
}

const mesAnterior = (mes) => {
  const [y, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 7)
}
const fmtMes = (mes) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`

/** Realizado do Mega até o corte + saldo projetado pelo físico restante (padrão: último mês fechado). */
export async function obterRealizadoProjecao(projetoId, corte) {
  const pId = String(projetoId).trim()
  const cortePadrao = mesAnterior(hojeNoBrasil().slice(0, 7))
  if (corte && !/^\d{4}-(0[1-9]|1[0-2])$/.test(corte)) throw Object.assign(new Error('Corte inválido (AAAA-MM).'), { status: 400 })
  const mesCorte = corte || cortePadrao
  const obra = await obraDoProjeto(pId)
  if (!obra) return { obra: null, motivo: 'Este projeto não tem obra do Mega vinculada.', corte: mesCorte, cortePadrao }

  const considera = nivel1Considerado(await obterParametrosObra(pId))
  const [entrada, classif, pag, realRes, cargaRes] = await Promise.all([
    montarEntradaCurvas(pId),
    classificadorDaObra(pId),
    pagamentosDoProjeto(pId, considera),
    query(
      `SELECT raw_data->>'cod_estruturado' AS codigo, raw_data->>'cod_item' AS cod, raw_data->>'descricao_1' AS descricao,
              data_documento::text AS data, ap::int AS ap, SUM(COALESCE(valor_apropriacao, 0))::float AS valor
       FROM mega.analise_realizado
       -- cod_estruturado nulo é a linha de total do relatório
       WHERE obra = $1 AND COALESCE(raw_data->>'cod_estruturado', '') <> '' GROUP BY 1, 2, 3, 4, 5`, [obra]),
    query('SELECT MAX(data_extracao)::text AS d FROM mega.analise_realizado WHERE obra = $1', [obra]),
  ])
  const vinculoPorOrigem = new Map(entrada.vinculos.map((v) => [v.codigo_origem, v.codigo_destino]))
  const realizado = realRes.rows.filter((r) => considera(r.codigo)).map((r) => ({
    codigo_etapa: vinculoPorOrigem.get(etapaParaMega(r.codigo) || r.codigo) || etapaParaMega(r.codigo) || r.codigo,
    tipo: classif.tipoDe(r.descricao, r.cod).tipo,
    data: r.data,
    valor: r.valor,
    ap: r.ap,
  }))

  const resultado = projetarRealizado({
    etapas: entrada.etapasParaCalculo,
    parametrosObra: entrada.paramsObra,
    parametrosEtapas: entrada.paramsEtapasObj.mapa,
    corte: mesCorte,
    realizado,
    pagamentos: pag.mapa,
    projetadoFora: entrada.totalFora,
  })

  const inicioDoMesSeguinte = `${proximoMesIso(mesCorte)}-01`
  const ultimaCargaMega = cargaRes.rows[0]?.d || null
  const avisos = []
  if (!ultimaCargaMega || ultimaCargaMega < inicioDoMesSeguinte) {
    avisos.push(`A última carga do Mega é de ${ultimaCargaMega ? ultimaCargaMega.split('-').reverse().join('/') : '—'}: o realizado de ${fmtMes(mesCorte)} pode estar incompleto.`)
  }
  if (entrada.totalFora > 0) {
    const niveisFora = [...new Set(entrada.projetadoFora.map((f) => nivel1DoCodigo(f.codigo)))].filter(Boolean).sort()
    avisos.push(`R$ ${entrada.totalFora.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} do custo projetado está fora do cronograma da Prevision (nível ${niveisFora.join(', ')}): entra no custo projetado e no realizado, mas não é distribuído nas curvas.`)
  }
  if (!pag.importado_em) {
    avisos.push('Planilha de pagamentos (Conciliação Financeira) não carregada: o financeiro do realizado é estimado pelas regras.')
  } else if (new Date(pag.importado_em).toISOString().slice(0, 10) < inicioDoMesSeguinte) {
    avisos.push(`A planilha de pagamentos foi carregada antes do fim de ${fmtMes(mesCorte)}: pagamentos posteriores ficam estimados.`)
  }
  if (pag.importado_em && resultado.kpis.realizadoSemPagamento > 0) {
    avisos.push(`R$ ${resultado.kpis.realizadoSemPagamento.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} do realizado sem AP na planilha: financeiro estimado pelas regras.`)
  }

  return {
    obra,
    cortePadrao,
    ...resultado,
    avisos,
    niveis1: await niveis1Disponiveis(pId, obra, entrada.importacao?.id, entrada.paramsObra),
    pagamentos: pag.importado_em ? { importado_em: pag.importado_em, arquivo: pag.arquivo } : null,
    ultimaCargaMega,
  }
}
