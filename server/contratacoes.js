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
  let cab = -1, colCusto = -1, colCodigo = -1, colNivel = -1, colDescricao = -1
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
    for (let j = colCodigo + 1; j < custo; j++) {
      if (primeiraLinha(linha[j]) === 'DESCRICAO') { colDescricao = j; break }
    }
    cab = i; colCusto = custo
  }
  if (cab < 0) {
    return { itens: [], linhas: [], total: 0, ignoradas: 0,
      erros: [{ linha: 0, motivo: 'colunas "CÓDIGO" (ou "ETAPA") e "CUSTO PROJETADO" não encontradas' }] }
  }
  // Por etapa: {nivel, soma}. Com coluna NÍVEL, só as linhas de menor N
  // contam (a linha N4 já é o total das N5 do mesmo código). Sem ela, soma tudo.
  const porEtapa = new Map()
  // Linhas por insumo (descrição) para separar material × mão de obra: as do
  // nível mais detalhado da etapa (N5), que somam o mesmo que a linha N4.
  const detalhe = new Map()
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
    const linhaDet = { codigo_etapa: codigo, descricao: colDescricao >= 0 ? String(linha[colDescricao] ?? '').trim() : '', custo_projetado: v.numero }
    const det = detalhe.get(codigo)
    if (!det || nivel > det.nivel) detalhe.set(codigo, { nivel, linhas: [linhaDet] })
    else if (nivel === det.nivel) det.linhas.push(linhaDet)
  }
  const itens = [...porEtapa.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo_etapa, { soma }]) => ({ codigo_etapa, custo_projetado: Math.round(soma * 100) / 100 }))
  const total = Math.round(itens.reduce((s, i) => s + i.custo_projetado, 0) * 100) / 100
  const linhas = [...detalhe.keys()].sort().flatMap((c) => detalhe.get(c).linhas)
  return { itens, linhas, total, ignoradas, erros }
}

// Classificação de insumos (planilha da empresa): SE = serviço/mão de obra;
// MT, EQ e OU = material.
export function definicaoParaTipo(def) {
  const d = String(def ?? '').trim().toUpperCase()
  if (d === 'SE') return 'MAO_DE_OBRA'
  if (['MT', 'EQ', 'OU'].includes(d)) return 'MATERIAL'
  return null
}

export function lerClassificacaoInsumos(matriz) {
  const n = (v) => normalizarNome(v).replace(/[^A-Z]/g, '')
  const cab = (matriz[0] || []).map(n)
  const iCod = cab.indexOf('CODITEM'), iDesc = cab.indexOf('DESCRICAODOITEM'), iDef = cab.indexOf('DEFINICAOITEM')
  if (iCod < 0 || iDesc < 0 || iDef < 0) {
    return { itens: [], ignoradas: 0, erros: ['colunas "Cód.Item", "Descrição do Item" e "Definição Item" não encontradas'] }
  }
  const itens = []
  let ignoradas = 0
  for (const linha of matriz.slice(1)) {
    const tipo = definicaoParaTipo(linha?.[iDef])
    const descricao = normalizarNome(linha?.[iDesc])
    if (!tipo || !descricao) { ignoradas++; continue }
    const cod = Number(linha[iCod])
    itens.push({ cod_insumo: Number.isFinite(cod) ? cod : null, descricao, definicao: String(linha[iDef]).trim().toUpperCase(), tipo })
  }
  return { itens, ignoradas, erros: [] }
}

const FORA_ORCAMENTO = 'ITENS FORA DE ORCAMENTO'

// Prioridade: item fora de orçamento (sempre material) > ajuste da obra (por
// descrição) > empresa por código > empresa por descrição > heurística "MO ".
export function classificador({ empresa = [], obra = [] }) {
  const porObra = new Map(obra.map((o) => [normalizarNome(o.descricao), o.tipo]))
  const porCodigo = new Map(empresa.filter((e) => e.cod_insumo != null).map((e) => [Number(e.cod_insumo), e.tipo]))
  const porDescricao = new Map(empresa.map((e) => [normalizarNome(e.descricao), e.tipo]))
  return (descricao, cod) => {
    const d = normalizarNome(descricao)
    if (d === FORA_ORCAMENTO) return { tipo: 'MATERIAL', fonte: 'FORA_ORCAMENTO' }
    if (porObra.has(d)) return { tipo: porObra.get(d), fonte: 'OBRA' }
    const c = cod == null || cod === '' ? NaN : Number(cod)
    if (porCodigo.has(c)) return { tipo: porCodigo.get(c), fonte: 'CODIGO' }
    if (porDescricao.has(d)) return { tipo: porDescricao.get(d), fonte: 'DESCRICAO' }
    return { tipo: d.startsWith('MO ') ? 'MAO_DE_OBRA' : 'MATERIAL', fonte: 'HEURISTICA' }
  }
}

export function subtrairDias(dataISO, dias) {
  const d = new Date(`${String(dataISO).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (Number(dias) || 0))
  return d.toISOString().slice(0, 10)
}

const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000)
const PRIORIDADE = ['ATRASADO', 'ATENCAO', 'PENDENCIA', 'NO_PRAZO', 'SEM_DATA', 'SEM_PROJECAO', 'CONCLUIDO']
const TIPOS = ['MATERIAL', 'MAO_DE_OBRA']

// Origem da apropriação na Análise Realizado: E = empreiteiro (medição de
// contrato); R = recebimento de material (pedido). Movimento inicial (MVI),
// CPA e sem origem seguem o tipo do insumo.
export function origemParaCanal(origem, tipo) {
  const o = String(origem ?? '').trim().toUpperCase()
  if (o === 'E') return 'contrato'
  if (o === 'R') return 'pedido'
  return tipo === 'MAO_DE_OBRA' ? 'contrato' : 'pedido'
}

// Flags por fase, de trás para frente a partir do início no cronograma:
// solicitação = início − lead time; mapa = início − (emissão + entrega);
// pedido/contrato = início − entrega. (Levantamento é lembrete: tela própria.)
export function flagsDoGrupo({ inicio, lead_time, prazo_emissao, prazo_entrega, P, solicitado, cotado, comprometido, hoje }) {
  const n = (x) => Number(x) || 0
  const limSolic = inicio ? subtrairDias(inicio, n(lead_time)) : null
  const fases = [
    { fase: 'SOLICITACAO', limite: limSolic, feito: solicitado >= P },
    { fase: 'MAPA', limite: inicio ? subtrairDias(inicio, n(prazo_emissao) + n(prazo_entrega)) : null, feito: Math.max(cotado, comprometido) >= P },
    { fase: 'PEDIDO_CONTRATO', limite: inicio ? subtrairDias(inicio, n(prazo_entrega)) : null, feito: comprometido >= P },
  ]
  return fases.map(({ fase, limite, feito }) => {
    const dias = limite ? diasEntre(hoje, limite) : null
    let estado
    if (P > 0 && feito) estado = 'FEITO'
    else if (!limite) estado = 'SEM_DATA'
    else if (dias < 0) estado = 'ATRASADO'
    else if (dias <= 7) estado = 'ATENCAO'
    else estado = 'NO_PRAZO'
    return { fase, limite, dias, estado }
  })
}

// Painel macro por tipo (material / mão de obra). Projetado e valores vêm por
// 'etapa|TIPO'; cada grupo soma só as chaves do seu tipo.
// Pedido = realizado vindo de pedido + saldo aberto de pedido; Contrato idem;
// Comprometido = Pedido + Contrato (como na planilha de projeção de custo).
// Data-limite de solicitação = menor início das etapas no cronograma - lead time.
export function calcularMacro({ grupos, projetado, valores, inicio, hoje }) {
  const linhas = grupos.map((g) => {
    const soma = { projetado: 0, solicitado: 0, cotado: 0, em_pedido: 0, em_contrato: 0, realizado_pedido: 0, realizado_contrato: 0, solicitado_efetivo: 0 }
    let menorInicio = null
    for (const e of g.etapas) {
      const chave = `${e}|${g.tipo}`
      const val = valores.get(chave) || {}
      const n = (f) => Number(val[f]) || 0
      soma.projetado += projetado.get(chave) || 0
      for (const f of ['solicitado', 'cotado', 'em_pedido', 'em_contrato', 'realizado_pedido', 'realizado_contrato']) soma[f] += n(f)
      const comprometido = n('realizado_pedido') + n('em_pedido') + n('realizado_contrato') + n('em_contrato')
      // Contrato fechado sem passar pela solicitação também conta como solicitado.
      soma.solicitado_efetivo += Math.max(n('solicitado'), comprometido)
      const ini = inicio.get(e)
      if (ini && (!menorInicio || ini < menorInicio)) menorInicio = ini
    }
    const pedido = soma.realizado_pedido + soma.em_pedido
    const contrato = soma.realizado_contrato + soma.em_contrato
    const comprometido = pedido + contrato
    const realizado = soma.realizado_pedido + soma.realizado_contrato
    const P = soma.projetado
    const razao = (x) => (P > 0 ? x / P : null)
    const pct = { solicitado: razao(soma.solicitado_efetivo), pedido: razao(pedido), contrato: razao(contrato),
      comprometido: razao(comprometido), realizado: razao(realizado) }
    const limite = menorInicio ? subtrairDias(menorInicio, g.lead_time) : null
    const diasAteLimite = limite ? diasEntre(hoje, limite) : null
    let sinal
    if (P <= 0) sinal = 'SEM_PROJECAO'
    else if (soma.solicitado_efetivo > P) sinal = 'PENDENCIA'
    else if (realizado >= P) sinal = 'CONCLUIDO'
    else if (!limite) sinal = 'SEM_DATA'
    else if (soma.solicitado_efetivo < P && diasAteLimite < 0) sinal = 'ATRASADO'
    else if (soma.solicitado_efetivo < P && diasAteLimite <= 7) sinal = 'ATENCAO'
    else sinal = 'NO_PRAZO'
    return {
      id: g.id, tipo: g.tipo, item: g.item, insumos: g.insumos, lead_time: g.lead_time, etapas: g.etapas.length,
      projetado: P, solicitado: soma.solicitado, solicitado_efetivo: soma.solicitado_efetivo, cotado: soma.cotado,
      em_pedido: soma.em_pedido, em_contrato: soma.em_contrato, pedido, contrato, comprometido, realizado,
      falta_solicitar: Math.max(0, P - soma.solicitado_efetivo), falta_fechar: Math.max(0, P - comprometido),
      pct, inicio: menorInicio, limite, dias_ate_limite: diasAteLimite, sinal,
      flags: flagsDoGrupo({ ...g, inicio: menorInicio, P, solicitado: soma.solicitado_efetivo, cotado: soma.cotado, comprometido, hoje }),
    }
  })
  linhas.sort((a, b) => PRIORIDADE.indexOf(a.sinal) - PRIORIDADE.indexOf(b.sinal)
    || String(a.limite ?? '9').localeCompare(String(b.limite ?? '9')))
  const projetadoObra = Object.fromEntries(TIPOS.map((t) => [t, 0]))
  for (const [chave, valor] of projetado) {
    const t = chave.split('|')[1]
    if (t in projetadoObra) projetadoObra[t] += Number(valor) || 0
  }
  const resumo = { total_obra: projetadoObra.MATERIAL + projetadoObra.MAO_DE_OBRA }
  for (const t of TIPOS) {
    const doTipo = linhas.filter((l) => l.tipo === t)
    const total = (f) => doTipo.reduce((s, l) => s + l[f], 0)
    const porSinal = Object.fromEntries(PRIORIDADE.map((s) => [s, 0]))
    for (const l of doTipo) porSinal[l.sinal]++
    resumo[t] = { projetado_obra: projetadoObra[t], projetado_grupos: total('projetado'),
      fora_grupos: Math.max(0, projetadoObra[t] - total('projetado')), comprometido: total('comprometido'),
      falta_solicitar: total('falta_solicitar'), falta_fechar: total('falta_fechar'), porSinal }
  }
  return { grupos: linhas, resumo }
}

// Data de hoje (AAAA-MM-DD) no fuso das obras; em UTC viraria o dia às 21h.
export function hojeNoBrasil(agora = new Date()) {
  return agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

// Trilha de aprovação do Approvo (spec seção 12). A regra guarda só quantas
// aprovações cada passo exige; nomes aparecem só na tela.
export const REGRAS_PADRAO = { solicitacao: 2, estouro: 1, estouro_minimo: 100000, mapa: 1, compra_ate: 1, compra_acima: 2, alcada_valor: 50000, aditivo: 2, medicao: 3 }

export function avaliarPasso({ passo, numero, doc, eventos = [], exigidas }) {
  const iReprov = eventos.map((e) => e.acao).lastIndexOf('Reprovação')
  const validos = eventos.slice(iReprov + 1).filter((e) => e.acao === 'Aprovação')
  const nomes = new Map()
  for (const e of validos) nomes.set(normalizarNome(e.aprovador), e.aprovador.trim())
  const feitas = nomes.size
  // Sem eventos, o passo está parado desde o envio para aprovação.
  const ultimo = eventos.length ? eventos[eventos.length - 1].data_hora : (doc?.data_envio ?? null)
  let status
  if (!doc && !eventos.length) status = 'NAO_INICIADO'
  else if (iReprov === eventos.length - 1 && iReprov >= 0) status = 'REPROVADO'
  else if (exigidas === 0) status = 'DISPENSADO'
  else status = feitas >= exigidas ? 'APROVADO' : 'PENDENTE'
  return { passo, numero, status, exigidas, feitas, aprovadores: [...nomes.values()], ultimo, valor: doc?.valor ?? null }
}

export function calcularTrilha({ item, docs, eventos, medicoes, regras }) {
  const passo = (p, numero, exigidas) => avaliarPasso({ passo: p, numero, doc: docs.get(`${p}|${numero}`) || null, eventos: eventos.get(`${p}|${numero}`) || [], exigidas })
  const valorDe = (p, n) => Number(docs.get(`${p}|${n}`)?.valor) || 0
  const passos = [passo('SOLICITACAO', item.solicitacao, regras.solicitacao)]
  const c = item.cotacao
  if (c && (docs.has(`ESTOURO|${c}`) || eventos.has(`ESTOURO|${c}`))) {
    passos.push(passo('ESTOURO', c, valorDe('ESTOURO', c) > regras.estouro_minimo ? regras.estouro : 0))
  }
  passos.push(c ? passo('MAPA', c, regras.mapa) : avaliarPasso({ passo: 'MAPA', numero: null, doc: null, eventos: [], exigidas: regras.mapa }))
  const alcada = (p, n) => (valorDe(p, n) > regras.alcada_valor ? regras.compra_acima : regras.compra_ate)
  if (item.contrato) {
    passos.push(passo('CONTRATO', item.contrato, alcada('CONTRATO', item.contrato)))
    if (docs.has(`ADITIVO|${item.contrato}`) || eventos.has(`ADITIVO|${item.contrato}`)) passos.push(passo('ADITIVO', item.contrato, regras.aditivo))
    for (const m of medicoes) passos.push(passo('MEDICAO', m, regras.medicao))
  } else if (item.pedido) {
    passos.push(passo('PEDIDO', item.pedido, alcada('PEDIDO', item.pedido)))
  } else {
    passos.push(avaliarPasso({ passo: 'COMPRA', numero: null, doc: null, eventos: [], exigidas: regras.compra_ate }))
  }
  // Documento posterior já existe no Mega (cotação, pedido, contrato, medição):
  // o passo anterior seguiu adiante, então conta como aprovado com as
  // aprovações que teve. Medições não se cobrem entre si, e o mapa não cobre o
  // estouro (os dois usam o número da mesma cotação).
  for (let i = 0; i < passos.length; i++) {
    const p = passos[i]
    if (p.passo === 'MEDICAO' || p.status === 'APROVADO' || p.status === 'DISPENSADO') continue
    const posterior = passos.slice(i + 1).some((q) => q.numero != null && !(p.passo === 'ESTOURO' && q.passo === 'MAPA'))
    if (posterior) passos[i] = { ...p, status: 'APROVADO', implicito: true }
  }
  const parado_em = passos.find((p) => p.status === 'PENDENTE' || p.status === 'REPROVADO' || p.status === 'NAO_INICIADO') || null
  return { passos, parado_em }
}

// Medições de um contrato numa linha só: quantas, quantas aprovadas e a
// primeira ainda pendente (com dias desde o último movimento).
export function resumirMedicoes(passos, hoje) {
  const pend = passos.find((p) => p.status === 'PENDENTE' || p.status === 'NAO_INICIADO')
  const desde = pend?.ultimo?.slice(0, 10)
  return {
    total: passos.length,
    aprovadas: passos.filter((p) => p.status === 'APROVADO' || p.status === 'DISPENSADO').length,
    reprovadas: passos.filter((p) => p.status === 'REPROVADO').length,
    pendente: pend ? { numero: pend.numero, dias: desde ? diasEntre(desde, hoje) : null } : null,
  }
}

// Valor do item na tela: o último conhecido. Unitário do pedido, senão do
// contrato, × quantidade solicitada (um pedido pode juntar o mesmo insumo de
// várias solicitações); senão a solicitação, que nem sempre vem certa.
export function valorDoItem({ solicitacao, pedido = null, contrato = null }) {
  const qtde = Number(solicitacao?.qtde) || 0
  for (const [fonte, doc] of [['PEDIDO', pedido], ['CONTRATO', contrato]]) {
    const u = doc?.unitario
    if (u !== null && u !== undefined && Number.isFinite(Number(u))) {
      return { fonte, unitario: Number(u), total: Math.round(Number(u) * qtde * 100) / 100 }
    }
  }
  const total = Number(solicitacao?.total) || 0
  return { fonte: 'SOLICITACAO', unitario: solicitacao?.unitario ?? (qtde ? total / qtde : null), total }
}
