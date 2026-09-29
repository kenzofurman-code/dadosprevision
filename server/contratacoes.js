// Regras puras da Gestão de Contratações (sem banco). Ver
// docs/superpowers/specs/2026-09-28-gestao-contratacoes-design.md

export function normalizarNome(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim()
}

export function nivelDoCodigo(codigo) {
  return String(codigo).split('.').length
}

// Mega: XX.XX.XX.XX.XXX. Prevision: XX.XX.XX.XX.XX (soma um zero à esquerda do último nível).
export function etapaParaMega(codigo) {
  const c = String(codigo ?? '').trim()
  if (/^\d{2}(\.\d{2}){3}\.\d{2,3}$/.test(c)) {
    const partes = c.split('.')
    partes[4] = partes[4].padStart(3, '0')
    return partes.join('.')
  }
  if (/^\d{2}(\.\d{2}){3}$/.test(c)) return c
  return null
}

function filhosNivel5(prefixo, orcamento) {
  return [...orcamento.keys()]
    .filter((c) => nivelDoCodigo(c) === 5 && c.startsWith(prefixo + '.'))
    .sort()
}

export function expandirParaNivel5(codigos, orcamento) {
  const saida = []
  const vistos = new Set()
  for (const bruto of codigos) {
    const codigo = etapaParaMega(bruto)
    if (!codigo) continue
    const itens = nivelDoCodigo(codigo) === 4
      ? filhosNivel5(codigo, orcamento).map((c) => ({ codigo_etapa: c, origem_nivel4: codigo }))
      : orcamento.has(codigo) ? [{ codigo_etapa: codigo, origem_nivel4: null }] : []
    for (const i of itens) {
      if (vistos.has(i.codigo_etapa)) continue
      vistos.add(i.codigo_etapa)
      saida.push(i)
    }
  }
  return saida
}

// Nível 5 explícito vence expansão de nível 4; entre iguais, vence o grupo de menor ordem.
export function resolverEtapasPadrao(gruposPadrao, orcamento) {
  const candidatos = []
  for (const g of [...gruposPadrao].sort((a, b) => a.ordem - b.ordem)) {
    for (const e of g.etapas) {
      const codigo = etapaParaMega(e.codigo)
      if (!codigo) continue
      // O orçamento da Prevision pode não trazer o nível 4; aí o ramo entra
      // pelos filhos, como SUGERIDO, porque não há nome para comparar.
      if (!orcamento.has(codigo) && nivelDoCodigo(codigo) !== 4) continue
      const bate = orcamento.has(codigo) && normalizarNome(e.nome) === normalizarNome(orcamento.get(codigo))
      const situacao = bate ? 'CONFIRMADO' : 'SUGERIDO'
      if (nivelDoCodigo(codigo) === 4) {
        for (const filho of filhosNivel5(codigo, orcamento)) {
          candidatos.push({ ordem: g.ordem, codigo_etapa: filho, situacao, nome_padrao: e.nome,
            nome_obra: orcamento.get(filho), origem_nivel4: codigo, prioridade: 1 })
        }
      } else {
        candidatos.push({ ordem: g.ordem, codigo_etapa: codigo, situacao, nome_padrao: e.nome,
          nome_obra: orcamento.get(codigo), origem_nivel4: null, prioridade: 0 })
      }
    }
  }
  candidatos.sort((a, b) => a.prioridade - b.prioridade || a.ordem - b.ordem)
  const escolhidos = new Map()
  const conflitos = []
  for (const c of candidatos) {
    if (escolhidos.has(c.codigo_etapa)) {
      if (escolhidos.get(c.codigo_etapa).ordem !== c.ordem) conflitos.push({ codigo_etapa: c.codigo_etapa, ordem: c.ordem })
      continue
    }
    escolhidos.set(c.codigo_etapa, c)
  }
  const vinculos = [...escolhidos.values()]
    .sort((a, b) => a.ordem - b.ordem || a.codigo_etapa.localeCompare(b.codigo_etapa))
    .map(({ prioridade: _prioridade, ...v }) => v)
  return { vinculos, conflitos }
}

export function sugestoesPorNome(pendencias, etapasPadrao) {
  const porNome = new Map()
  for (const e of etapasPadrao) {
    const n = normalizarNome(e.nome)
    if (n && !porNome.has(n)) porNome.set(n, e)
  }
  const saida = new Map()
  for (const p of pendencias) {
    const e = porNome.get(normalizarNome(p.nome))
    if (e && e.codigo !== p.codigo) saida.set(p.codigo, { ordem: e.ordem, codigo_padrao: e.codigo })
  }
  return saida
}

function paraNumero(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return { vazio: true }
  if (typeof valor === 'number') return { numero: valor }
  const t = String(valor).trim().replace(/^R\$/i, '').replace(/\s/g, '')
  // pt-BR: "1.234" e "12.345.678,90" usam ponto como milhar; "1.5" continua decimal.
  const milhar = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)
  const normal = milhar || t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normal)
  return Number.isFinite(n) ? { numero: n } : { invalido: true }
}

export function lerCustoProjetado(matriz) {
  const primeiraLinha = (v) => normalizarNome(String(v ?? '').split('\n')[0])
  let cab = -1, colCusto = -1, colCodigo = -1, colNivel = -1
  for (let i = 0; i < Math.min(matriz.length, 20) && cab < 0; i++) {
    const linha = matriz[i] || []
    const custo = linha.findIndex((v) => primeiraLinha(v).startsWith('CUSTO PROJETADO'))
    if (custo < 0) continue
    for (let j = custo - 1; j >= 0; j--) {
      const n = primeiraLinha(linha[j])
      if (n === 'CODIGO' || n === 'ETAPA' || n === 'ETAPA DE ORCAMENTO') { colCodigo = j; break }
    }
    if (colCodigo < 0) continue
    for (let j = colCodigo - 1; j >= 0; j--) {
      if (primeiraLinha(linha[j]) === 'NIVEL') { colNivel = j; break }
    }
    cab = i; colCusto = custo
  }
  if (cab < 0) {
    return { itens: [], total: 0, ignoradas: 0,
      erros: [{ linha: 0, motivo: 'colunas "CÓDIGO" (ou "ETAPA") e "CUSTO PROJETADO" não encontradas' }] }
  }
  // Por etapa: {nivel, soma}. Com coluna NÍVEL, só as linhas de menor N
  // contam (a linha N4 já é o total das N5 do mesmo código). Sem ela, soma tudo.
  const porEtapa = new Map()
  const erros = []
  let ignoradas = 0
  for (let i = cab + 1; i < matriz.length; i++) {
    const linha = matriz[i] || []
    const codigo = etapaParaMega(linha[colCodigo])
    if (!codigo || nivelDoCodigo(codigo) !== 5) continue
    const v = paraNumero(linha[colCusto])
    if (v.vazio) { ignoradas++; continue }
    if (v.invalido) { erros.push({ linha: i + 1, motivo: `custo projetado inválido: "${linha[colCusto]}"` }); continue }
    const nivel = colNivel >= 0 ? Number(String(linha[colNivel] ?? '').replace(/\D/g, '')) || 99 : 0
    const atual = porEtapa.get(codigo)
    if (!atual || nivel < atual.nivel) porEtapa.set(codigo, { nivel, soma: v.numero })
    else if (nivel === atual.nivel) atual.soma += v.numero
  }
  const itens = [...porEtapa.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo_etapa, { soma }]) => ({ codigo_etapa, custo_projetado: Math.round(soma * 100) / 100 }))
  const total = Math.round(itens.reduce((s, i) => s + i.custo_projetado, 0) * 100) / 100
  return { itens, total, ignoradas, erros }
}

export function subtrairDias(dataISO, dias) {
  const d = new Date(`${String(dataISO).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (Number(dias) || 0))
  return d.toISOString().slice(0, 10)
}

const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000)
const PRIORIDADE = ['ATRASADO', 'ATENCAO', 'PENDENCIA', 'NO_PRAZO', 'SEM_DATA', 'SEM_PROJECAO', 'CONCLUIDO']
const FASES = ['solicitado', 'pedido', 'contratado', 'realizado']

// Painel macro: por grupo, % do custo projetado em cada fase e sinalizador.
// Data-limite de solicitação = menor início das etapas no cronograma - lead time.
export function calcularMacro({ grupos, projetado, valores, inicio, hoje }) {
  const linhas = grupos.map((g) => {
    const soma = { projetado: 0, solicitado: 0, pedido: 0, contratado: 0, realizado: 0, lancado: 0 }
    let menorInicio = null
    for (const e of g.etapas) {
      const val = valores.get(e) || {}
      soma.projetado += projetado.get(e) || 0
      for (const f of FASES) soma[f] += Number(val[f]) || 0
      soma.lancado += Math.max(0, ...FASES.map((f) => Number(val[f]) || 0))
      const ini = inicio.get(e)
      if (ini && (!menorInicio || ini < menorInicio)) menorInicio = ini
    }
    const P = soma.projetado
    const pct = Object.fromEntries([...FASES, 'lancado'].map((f) => [f, P > 0 ? soma[f] / P : null]))
    const limite = menorInicio ? subtrairDias(menorInicio, g.lead_time) : null
    const diasAteLimite = limite ? diasEntre(hoje, limite) : null
    let sinal
    if (P <= 0) sinal = 'SEM_PROJECAO'
    else if (soma.lancado > P) sinal = 'PENDENCIA'
    else if (soma.realizado >= P) sinal = 'CONCLUIDO'
    else if (soma.lancado >= 0.95 * P && soma.lancado < P) sinal = 'PENDENCIA'
    else if (!limite) sinal = 'SEM_DATA'
    else if (soma.solicitado < P && diasAteLimite < 0) sinal = 'ATRASADO'
    else if (soma.solicitado < P && diasAteLimite <= 7) sinal = 'ATENCAO'
    else sinal = 'NO_PRAZO'
    return {
      id: g.id, tipo: g.tipo, item: g.item, insumos: g.insumos, lead_time: g.lead_time, etapas: g.etapas.length,
      ...soma, falta: Math.max(0, P - soma.lancado), pct, inicio: menorInicio, limite, dias_ate_limite: diasAteLimite, sinal,
    }
  })
  linhas.sort((a, b) => PRIORIDADE.indexOf(a.sinal) - PRIORIDADE.indexOf(b.sinal)
    || String(a.limite ?? '9').localeCompare(String(b.limite ?? '9')))
  const porSinal = Object.fromEntries(PRIORIDADE.map((s) => [s, 0]))
  for (const l of linhas) porSinal[l.sinal]++
  const total = (f) => linhas.reduce((s, l) => s + l[f], 0)
  return { grupos: linhas, resumo: { projetado: total('projetado'), lancado: total('lancado'), falta: total('falta'), porSinal } }
}

// Data de hoje (AAAA-MM-DD) no fuso das obras; em UTC viraria o dia às 21h.
export function hojeNoBrasil(agora = new Date()) {
  return agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}
