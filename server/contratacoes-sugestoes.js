import { normalizarNome } from './contratacoes.js'

const ignorar = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA', 'COM', 'SEM', 'POR', 'OBRA', 'OBRAS', 'MO', 'MAO', 'MATERIAL', 'SERVICO', 'SERVICOS', 'FORNECIMENTO', 'COLOCACAO', 'GERAL', 'GERAIS', 'MONTAGEM', 'EXECUCAO', 'APLICACAO', 'INSTALACAO', 'INSTALACOES'])
const radical = (t) => t.length > 4 ? t.replace(/OES$/, 'AO').replace(/AIS$/, 'AL').replace(/S$/, '').replace(/[AO]$/, '') : t
const sinonimos = new Map([
  ['ARMADURA', 'ACO'], ['ARMACAO', 'ACO'], ['VERGALHAO', 'ACO'],
  ['TERRAPLANAGEM', 'ESCAVACAO'], ['ATERRO', 'ESCAVACAO'],
  ['PORCELANATO', 'CERAMICO'], ['AZULEJO', 'CERAMICO'], ['CERAMICA', 'CERAMICO'],
  ['SST', 'SEGURANCA'], ['EPI', 'SEGURANCA'], ['EPIS', 'SEGURANCA'],
  ['DRYWALL', 'DRYWALL'], ['ELETRICAS', 'ELETRICA'], ['HIDRAULICAS', 'HIDRAULICA'],
  ['INFRAESTRUTURA', 'FUNDACAO'], ['CONTENCAO', 'FUNDACAO'],
  ['SUPRAESTRUTURA', 'ESTRUTURA'], ['SUPERESTRUTURA', 'ESTRUTURA'],
  ['INT', 'INTERNO'], ['EXT', 'EXTERNO'], ['PLANIALTIMETRICO', 'TOPOGRAFIA'],
].map(([a, b]) => [radical(a), radical(b)]))
function tokens(texto) {
  return new Set(normalizarNome(texto).replace(/DRY\s+WALL/g, 'DRYWALL').split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 2 && !ignorar.has(t) && !/^\d/.test(t))
    .map(radical).flatMap((t) => sinonimos.has(t) ? [t, sinonimos.get(t)] : [t]))
}
const prefixo = (a, b) => {
  const x = a.split('.'), y = b.split('.')
  let n = 0
  while (n < Math.min(x.length, y.length) && x[n] === y[n]) n++
  return n
}

// Apenas propõe destinos. Nenhum vínculo é criado e nunca cruza Material × MO.
export function sugerirGrupos({ codigo, nome, tipo, insumos = [], grupos, referencias = [], contexto = '' }) {
  const candidatos = grupos.filter((g) => g.tipo === tipo)
  if (!candidatos.length) return null
  const documentos = candidatos.map((g) => tokens(`${g.item} ${g.insumos || ''} ${g.pacote_servicos || ''}`))
  const frequencias = new Map()
  for (const doc of documentos) for (const t of doc) frequencias.set(t, (frequencias.get(t) || 0) + 1)
  const peso = (t) => 1 + Math.log(1 + candidatos.length / (frequencias.get(t) || 1))
  const similaridade = (origem, destino) => {
    const comuns = [...origem].filter((t) => destino.has(t))
    if (!comuns.length) return 0
    const soma = (conjunto) => [...conjunto].reduce((s, t) => s + peso(t), 0)
    return comuns.reduce((s, t) => s + peso(t), 0) / Math.sqrt(soma(origem) * soma(destino))
  }
  const nomeTokens = tokens(nome), contextoTokens = tokens(contexto)
  const detalhes = insumos.filter((i) => Number(i.custo_projetado) !== 0 && i.descricao)
    .map((i) => ({ ...i, tokens: tokens(i.descricao), valor: Math.abs(Number(i.custo_projetado)) }))
  const total = detalhes.reduce((s, i) => s + i.valor, 0)
  const ranking = candidatos.map((g) => {
    const alvo = tokens(`${g.item} ${g.insumos || ''}`)
    const pacote = tokens(`${g.item} ${g.pacote_servicos || ''}`)
    const evidencias = detalhes.map((i) => ({ ...i, afinidade: similaridade(i.tokens, alvo) }))
      .filter((i) => i.afinidade > 0).sort((a, b) => b.valor * b.afinidade - a.valor * a.afinidade)
    const porInsumo = total ? evidencias.reduce((s, i) => s + i.afinidade * i.valor / total, 0) : 0
    const porNome = similaridade(nomeTokens, alvo)
    const porContexto = similaridade(contextoTokens, pacote)
    const contextoEstrutural = tipo === 'MAO_DE_OBRA' && porContexto > 0
      && ['ACO', 'CONCRET', 'FORM', 'ESCORAMENT'].some((t) => nomeTokens.has(t))
      && ['ESTRUTUR', 'FUNDACA', 'INFRAESTRUTUR'].some((t) => tokens(g.item).has(t))
    const refs = referencias.filter((r) => r.grupo_id === g.id)
    const iguais = refs.filter((r) => normalizarNome(r.nome) === normalizarNome(nome))
    const proximidade = iguais.reduce((m, r) => Math.max(m, prefixo(codigo, r.codigo)), 0)
    const referencia = iguais.length ? 20 + proximidade * 7 : 0
    const contextual = refs.reduce((m, r) => Math.max(m, prefixo(codigo, r.codigo)), 0)
    const origemContextual = new Set([...nomeTokens, ...contextoTokens])
    const exteriorAlvo = pacote.has('EXTERN') || pacote.has('FACHAD')
    const exteriorOrigem = origemContextual.has('EXTERN') || origemContextual.has('FACHAD')
    const contradicao = (origemContextual.has('INTERN') && exteriorAlvo)
      || (exteriorOrigem && pacote.has('INTERN'))
      || (origemContextual.has('PISO') && !exteriorOrigem && pacote.has('FACHAD'))
    const pontos = 40 * porNome + 50 * porInsumo + 18 * porContexto + referencia
      + ((porNome > 0 || porInsumo > 0) && contextual >= 3 ? (contextual - 2) * 8 : 0)
      + (contextoEstrutural ? 20 : 0)
      - (contradicao ? 35 : 0)
    return { g, pontos, evidencias, referencia, porContexto, porInsumo, porNome, contextoEstrutural }
  }).filter((r) => r.pontos >= 10 && (r.porNome > 0 || r.porInsumo > 0 || r.referencia || r.contextoEstrutural))
    .sort((a, b) => b.pontos - a.pontos || a.g.ordem - b.g.ordem || a.g.id - b.g.id)
  if (!ranking.length) return null
  const primeira = ranking[0], segunda = ranking[1]
  const margem = segunda ? primeira.pontos - segunda.pontos : primeira.pontos
  const confianca = margem < 8 || primeira.pontos < 25 ? 'BAIXA'
    : primeira.pontos >= 55 && margem >= 15 ? 'ALTA' : 'MEDIA'
  const montar = (r) => ({ grupo_id: r.g.id, item: r.g.item, insumos: r.g.insumos, pacote_servicos: r.g.pacote_servicos,
    motivo: [r.evidencias.length ? `Insumos: ${r.evidencias.slice(0, 3).map((i) => i.descricao).join('; ')}` : null,
      r.porNome > 0 ? `Semelhança com a etapa “${nome}”` : null,
      r.referencia ? 'Nome de etapa presente no padrão ou em vínculo confirmado' : null,
      r.porContexto > 0 ? `Contexto: ${contexto}` : null].filter(Boolean).join('. ') })
  return { ...montar(primeira), confianca, alternativas: ranking.slice(1, 3).map(montar) }
}
