// Regras puras do Diário de Obra: conversão de formatos e mapeamento do JSON da API para linhas do banco.

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')

export const COLUNAS_OBRA = [
  'obra_id', 'nome', 'status_id', 'status', 'grupo', 'endereco', 'numero_contrato', 'data_inicio', 'data_fim',
  'responsavel', 'cliente', 'total_relatorios', 'total_fotos', 'modified_api', 'raw',
]

export const COLUNAS_RELATORIO = [
  'relatorio_id', 'obra_id', 'data', 'data_fim', 'numero', 'dia_semana', 'status_id', 'status',
  'clima_manha', 'condicao_manha', 'clima_tarde', 'condicao_tarde', 'clima_noite', 'condicao_noite',
  'indice_pluviometrico', 'dia_parado', 'dia_chuvoso', 'dia_impraticavel',
  'criado_por', 'criado_em', 'modificado_por', 'modificado_em', 'created_api', 'modified_api',
  'link_pdf', 'total_fotos', 'raw',
]

export function dataBR(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(valor ?? ''))
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export function dataHoraBR(valor) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(valor ?? ''))
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`
}

export function normalizarEmpreiteira(nome) {
  const n = semAcento(nome).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  return n || null
}

export function ehParalisacao(tag) {
  return semAcento(tag).toUpperCase().startsWith('PARALISACAO')
}

const inteiro = (v) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? n : 0
}

const decimal = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const periodoComProblema = (periodo, campo, valor) =>
  Boolean(periodo?.ativo) && semAcento(periodo?.[campo]).toUpperCase() === valor

function coletarFotos(raw) {
  const vistas = new Set()
  const fotos = []
  const adicionar = (f, origem) => {
    if (!f?.url || vistas.has(f.url)) return
    vistas.add(f.url)
    fotos.push({ url: f.url, url_miniatura: f.urlMiniatura ?? null, descricao: f.descricao || null, origem })
  }
  ;(raw.galeriaDeFotos ?? []).forEach((f) => adicionar(f, 'galeria'))
  ;(raw.atividades ?? []).forEach((a) => (a.fotos ?? []).forEach((f) => adicionar(f, 'atividade')))
  ;(raw.ocorrencias ?? []).forEach((o) => (o.fotos ?? []).forEach((f) => adicionar(f, 'ocorrencia')))
  return fotos
}

export function mapearObra(item, detalhe = {}) {
  return {
    obra_id: item._id,
    nome: item.nome,
    status_id: item.status?.id ?? null,
    status: item.status?.descricao ?? null,
    grupo: detalhe.grupo?.descricao ?? null,
    endereco: detalhe.endereco ?? null,
    numero_contrato: detalhe.numeroContrato ?? null,
    data_inicio: dataBR(detalhe.dataInicio),
    data_fim: dataBR(detalhe.dataFim),
    responsavel: detalhe.responsavel ?? null,
    cliente: detalhe.cliente ?? null,
    total_relatorios: inteiro(item.totalRelatorios),
    total_fotos: inteiro(item.totalFotos),
    modified_api: item.modified ?? null,
    raw: detalhe,
  }
}

export function mapearRelatorio(raw) {
  const data = dataBR(raw.data)
  if (!raw._id) throw new Error('Relatório sem _id.')
  if (!raw.obra?._id) throw new Error(`Relatório ${raw._id} sem obra.`)
  if (!data) throw new Error(`Relatório ${raw._id} com data inválida: ${raw.data}`)

  const clima = raw.clima ?? {}
  const periodos = [clima.manha, clima.tarde, clima.noite]

  const ocorrencias = (raw.ocorrencias ?? []).map((o) => {
    const tags = (o.tags ?? []).filter((t) => t.checked).map((t) => t.descricao)
    return { descricao: o.descricao ?? null, tags, paralisacao: tags.some(ehParalisacao) }
  })

  const maoObra = (raw.maoDeObra?.padrao ?? []).map((m) => ({
    funcao: m.descricao ?? null,
    quantidade: inteiro(m.quantidade),
    empreiteira: m.categoria?.descricao ?? null,
    empreiteira_norm: normalizarEmpreiteira(m.categoria?.descricao),
  }))

  const equipamentos = (raw.equipamentos ?? []).map((e) => ({
    descricao: e.descricao ?? null,
    quantidade: inteiro(e.quantidade),
  }))

  const atividades = (raw.atividades ?? []).map((a) => ({
    descricao: a.descricao ?? null,
    observacao: a.observacao || null,
    status: a.status?.descricao ?? null,
    porcentagem: decimal(a.porcentagem),
    total_fotos: (a.fotos ?? []).length,
  }))

  const fotos = coletarFotos(raw)

  return {
    relatorio: {
      relatorio_id: raw._id,
      obra_id: raw.obra._id,
      data,
      data_fim: dataBR(raw.dataFim),
      numero: Number.isInteger(raw.numero) ? raw.numero : null,
      dia_semana: raw.diaDaSemana ?? null,
      status_id: raw.status?.id ?? null,
      status: raw.status?.descricao ?? null,
      clima_manha: clima.manha?.clima ?? null,
      condicao_manha: clima.manha?.condicao ?? null,
      clima_tarde: clima.tarde?.clima ?? null,
      condicao_tarde: clima.tarde?.condicao ?? null,
      clima_noite: clima.noite?.clima ?? null,
      condicao_noite: clima.noite?.condicao ?? null,
      indice_pluviometrico: decimal(clima.indicePluviometrico),
      dia_parado: ocorrencias.some((o) => o.paralisacao),
      dia_chuvoso: periodos.some((p) => periodoComProblema(p, 'clima', 'CHUVOSO')),
      dia_impraticavel: periodos.some((p) => periodoComProblema(p, 'condicao', 'IMPRATICAVEL')),
      criado_por: raw.log?.criadoPor?.usuario?.nome ?? null,
      criado_em: dataHoraBR(raw.log?.criadoPor?.dataHora),
      modificado_por: raw.log?.modificadoPor?.usuario?.nome ?? null,
      modificado_em: dataHoraBR(raw.log?.modificadoPor?.dataHora),
      created_api: raw.created ?? null,
      modified_api: raw.modified ?? null,
      link_pdf: raw.linkPdf ?? null,
      total_fotos: fotos.length,
      raw,
    },
    maoObra,
    equipamentos,
    ocorrencias,
    atividades,
    fotos,
  }
}
