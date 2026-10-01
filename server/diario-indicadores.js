// Cálculos puros dos indicadores do Diário de Obra. O SQL (diario-db.js) só agrega; a forma final é montada aqui.

const DIA_MS = 86400000
const utc = (iso) => {
  const [a, m, d] = iso.split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}
const soma = (linhas, campo) => linhas.reduce((t, l) => t + (Number(l[campo]) || 0), 0)
const arredondar = (n) => Math.round(n * 10) / 10
// Efetivo de pessoas: sempre inteiro mais próximo (não existe fração de pessoa).
const arredondarEfetivo = (n) => Math.round(Number(n) || 0)

// Dias corridos e dias úteis (segunda a sexta) no intervalo, com diário feito e com diário aprovado.
export function diasSemDiario(datas, { inicio = null, fim = null, datasAprovadas = [] } = {}) {
  const unicas = [...new Set(datas || [])].sort()
  const unicasAprov = new Set(datasAprovadas || [])
  const zero = {
    corridos: 0,
    comDiario: 0,
    semDiario: 0,
    diasUteis: 0,
    comDiarioUteis: 0,
    semDiarioUteis: 0,
    aprovadosUteis: 0,
    semAprovadoUteis: 0,
  }
  if (!unicas.length && !inicio && !fim) return zero

  const de = inicio || unicas[0]
  const ate = fim || unicas[unicas.length - 1]
  if (!de || !ate || de > ate) return zero

  const setDatas = new Set(unicas)
  let d = new Date(`${de}T12:00:00Z`)
  const fimMs = new Date(`${ate}T12:00:00Z`).getTime()

  let corridos = 0
  let uteis = 0
  let comDiarioCorridos = 0
  let comDiarioUteis = 0
  let aprovadosUteis = 0

  while (d.getTime() <= fimMs) {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay() // 0 = Dom, 6 = Sáb
    const ehUtil = dow >= 1 && dow <= 5

    corridos++
    if (ehUtil) uteis++

    if (setDatas.has(iso)) {
      comDiarioCorridos++
      if (ehUtil) comDiarioUteis++
    }
    if (unicasAprov.has(iso)) {
      if (ehUtil) aprovadosUteis++
    }

    d.setUTCDate(d.getUTCDate() + 1)
  }

  return {
    corridos,
    comDiario: comDiarioCorridos,
    semDiario: Math.max(0, corridos - comDiarioCorridos),
    diasUteis: uteis,
    comDiarioUteis,
    semDiarioUteis: Math.max(0, uteis - comDiarioUteis),
    aprovadosUteis,
    semAprovadoUteis: Math.max(0, uteis - aprovadosUteis),
  }
}

export function montarIndicadores(entrada, { dataInicio = null, dataFim = null } = {}) {
  const {
    efetivoDia = [], efetivoEmpreiteira = [], efetivoFuncao = [], climaObra = [], climaDia = [],
    tags = [], ocorrenciaTotais = { ocorrencias: 0, relatorios: 0 }, preenchimentoObra = [], diasComDiario = 0,
  } = entrada

  // Média de pessoas por dia com diário: número inteiro arredondado para cima ou para baixo.
  const media = (total) => (diasComDiario > 0 ? arredondarEfetivo(Number(total) / diasComDiario) : 0)
  const preenchimento = preenchimentoObra.map((o) => {
    const dias = diasSemDiario(o.datas ?? [], {
      inicio: dataInicio,
      fim: dataFim,
      datasAprovadas: o.datas_aprovadas ?? [],
    })
    return {
      obraId: o.obra_id, obraNome: o.obra_nome, relatorios: o.relatorios, aprovados: o.aprovados,
      emRevisao: o.em_revisao, preenchendo: o.preenchendo, pendentesAntigos: o.pendentes_antigos,
      corridos: dias.corridos, comDiario: dias.comDiario, semDiario: dias.semDiario,
      diasUteis: dias.diasUteis, comDiarioUteis: dias.comDiarioUteis, semDiarioUteis: dias.semDiarioUteis,
      aprovadosUteis: dias.aprovadosUteis, semAprovadoUteis: dias.semAprovadoUteis,
    }
  })

  const diasUteisReferencia = preenchimento.length > 0 ? Math.max(...preenchimento.map((p) => p.diasUteis)) : 0
  const diasCorridosReferencia = preenchimento.length > 0 ? Math.max(...preenchimento.map((p) => p.corridos)) : 0

  return {
    efetivo: {
      porDia: efetivoDia.map((d) => ({ data: d.data, total: Number(d.total) })),
      porEmpreiteira: efetivoEmpreiteira.map((e) => ({ chave: e.chave, rotulo: e.rotulo, media: media(e.total) })),
      porFuncao: efetivoFuncao.map((f) => ({ rotulo: f.rotulo, media: media(f.total) })),
      mediaPorDia: media(soma(efetivoDia, 'total')),
      diasComDiario,
    },
    clima: {
      totais: {
        relatorios: soma(climaObra, 'relatorios'),
        chuvosos: soma(climaObra, 'chuvosos'),
        impraticaveis: soma(climaObra, 'impraticaveis'),
        parados: soma(climaObra, 'parados'),
        chuvaMm: arredondar(soma(climaObra, 'chuva_mm')),
      },
      porObra: climaObra.map((o) => ({
        obraId: o.obra_id, obraNome: o.obra_nome, relatorios: o.relatorios, chuvosos: o.chuvosos,
        impraticaveis: o.impraticaveis, parados: o.parados, chuvaMm: arredondar(Number(o.chuva_mm) || 0),
      })),
      porDia: (climaDia || []).map((d) => ({
        data: d.data,
        totalObras: Number(d.total_obras) || 0,
        chuvosos: Number(d.chuvosos) || 0,
        impraticaveis: Number(d.impraticaveis) || 0,
        parados: Number(d.parados) || 0,
        chuvaMediaMm: arredondar(Number(d.chuva_media_mm) || 0),
        chuvaMaxMm: arredondar(Number(d.chuva_max_mm) || 0),
      })),
    },
    ocorrencias: {
      total: ocorrenciaTotais.ocorrencias,
      relatorios: ocorrenciaTotais.relatorios,
      porTag: tags.map((t) => ({ tag: t.tag, total: Number(t.total) })),
    },
    preenchimento: {
      totais: {
        relatorios: soma(preenchimento, 'relatorios'),
        aprovados: soma(preenchimento, 'aprovados'),
        emRevisao: soma(preenchimento, 'emRevisao'),
        preenchendo: soma(preenchimento, 'preenchendo'),
        pendentesAntigos: soma(preenchimento, 'pendentesAntigos'),
        diasUteis: diasUteisReferencia,
        diasCorridos: diasCorridosReferencia,
        semDiarioUteis: soma(preenchimento, 'semDiarioUteis'),
        semAprovadoUteis: soma(preenchimento, 'semAprovadoUteis'),
        semDiario: soma(preenchimento, 'semDiario'),
      },
      porObra: preenchimento,
    },
  }
}
