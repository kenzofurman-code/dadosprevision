// Painel 9 — Teórico x Físico: cálculo puro (sem banco).
// OR = orçamento reajustado pelo INCC-DI; AP = apropriado reajustado; MF = medição física.

/** Resposta da API SGS do Banco Central -> [{ mes: 'YYYY-MM', variacao }]. */
export function parseSerieBcb(json) {
  if (!Array.isArray(json)) return []
  const out = []
  for (const p of json) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(p?.data || ''))
    const v = String(p?.valor ?? '').trim() === '' ? NaN : Number(p.valor)
    if (m && Number.isFinite(v)) out.push({ mes: `${m[3]}-${m[2]}`, variacao: v })
  }
  return out
}

/**
 * fatorPosterior(m) = produto de (1 + v/100) dos meses estritamente posteriores a `m`, até o último publicado.
 * O próprio mês `m` não entra: o valor já está a preço daquele mês. Sem mês informado, fator 1.
 */
export function criarFatorPosterior(indices) {
  const ordenados = [...(indices || [])].sort((a, b) => (a.mes < b.mes ? -1 : 1))
  return {
    ultimoMes: ordenados.length ? ordenados[ordenados.length - 1].mes : null,
    fatorPosterior(mes) {
      if (!mes) return 1
      let f = 1
      for (const i of ordenados) if (i.mes > mes) f *= 1 + Number(i.variacao) / 100
      return f
    },
  }
}

const razao = (num, den) => (den > 0 && num !== null ? num / den : null)

function calcularDerivados(s, temOrcamento, temProjetado) {
  const or = temOrcamento ? s.orcamento_reajustado : null
  const mf = s.peso_base > 0 ? s.mf_ponderado / s.peso_base : 0
  const projetado = temProjetado ? s.custo_projetado : null
  const resultado = or !== null && projetado !== null ? or - projetado : null
  const ef = razao(s.apropriado_reajustado, or)
  const rt = or !== null && or > 0 ? or * mf - s.apropriado_reajustado : null
  return {
    orcamento_base: s.orcamento_base,
    orcamento_reajustado: or,
    apropriado_nominal: s.apropriado_nominal,
    apropriado_reajustado: s.apropriado_reajustado,
    saldo_contratos: s.saldo_contratos,
    saldo_pedidos: s.saldo_pedidos,
    comprometido: s.apropriado_reajustado + s.saldo_contratos + s.saldo_pedidos,
    custo_projetado: projetado,
    resultado,
    evolucao_financeira: ef,
    medicao_fisica: mf,
    resultado_teorico: rt,
    regua_a: ef !== null ? ef - mf : null,
    regua_b: rt !== null && resultado !== null ? (rt - resultado) / or : null,
  }
}

/**
 * Linhas da EAP (níveis 1 a 5) com as colunas do painel. Níveis 1 a 4 somam seus filhos nível 5;
 * a medição física deles é ponderada pelo orçamento e as razões são recalculadas a partir das somas.
 * `fatorBase` null = obra sem mês-base (sem orçamento reajustado). `projetado` null = sem importação.
 */
export function montarLinhas({ itens, porEtapa, projetado, fatorBase, paraMega }) {
  const temOrcamento = fatorBase !== null && fatorBase !== undefined
  const fator = temOrcamento ? Number(fatorBase) : 1
  const codigos = new Set(itens.map((i) => i.codigo))
  const somas = new Map()
  const novaSoma = () => ({
    orcamento_base: 0, orcamento_reajustado: 0, apropriado_nominal: 0, apropriado_reajustado: 0,
    saldo_contratos: 0, saldo_pedidos: 0, custo_projetado: 0, mf_ponderado: 0, peso_base: 0,
  })
  for (const i of itens) somas.set(i.codigo, novaSoma())

  for (const folha of itens.filter((i) => Number(i.nivel) === 5)) {
    const cod = paraMega(folha.codigo) || folha.codigo
    const base = Number(folha.custo_total) || 0
    const mf = Math.min(1, Math.max(0, Number(folha.peso_realizado) || 0))
    const v = porEtapa.get(cod) || {}
    const segs = folha.codigo.split('.')
    const alvos = []
    for (let k = 1; k <= segs.length; k++) {
      const prefixo = segs.slice(0, k).join('.')
      if (codigos.has(prefixo)) alvos.push(somas.get(prefixo))
    }
    for (const s of alvos) {
      s.orcamento_base += base
      s.orcamento_reajustado += base * fator
      s.apropriado_nominal += Number(v.apropriado_nominal) || 0
      s.apropriado_reajustado += Number(v.apropriado_reajustado) || 0
      s.saldo_contratos += Number(v.saldo_contratos) || 0
      s.saldo_pedidos += Number(v.saldo_pedidos) || 0
      s.custo_projetado += projetado ? Number(projetado.get(cod)) || 0 : 0
      s.mf_ponderado += base * mf
      s.peso_base += base
    }
  }

  return [...itens]
    .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
    .map((i) => ({
      codigo: i.codigo,
      codigo_mega: Number(i.nivel) === 5 ? paraMega(i.codigo) || i.codigo : null,
      descricao: i.descricao || '',
      nivel: Number(i.nivel),
      ...calcularDerivados(somas.get(i.codigo), temOrcamento, Boolean(projetado)),
    }))
}

/** Códigos nível 5 com orçamento > 0 e régua calculável, do maior para o menor |valor| da régua. */
export function rankingNivel5(linhas, regua) {
  const campo = regua === 'B' ? 'regua_b' : 'regua_a'
  return linhas
    .filter((l) => l.nivel === 5 && l.orcamento_reajustado > 0 && l[campo] !== null)
    .sort((a, b) => Math.abs(b[campo]) - Math.abs(a[campo]))
    .map((l) => l.codigo)
}
