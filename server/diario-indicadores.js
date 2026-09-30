// Cálculos puros dos indicadores do Diário de Obra. O SQL (diario-db.js) só agrega; a forma final é montada aqui.

const DIA_MS = 86400000
const utc = (iso) => {
  const [a, m, d] = iso.split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}
const soma = (linhas, campo) => linhas.reduce((t, l) => t + (Number(l[campo]) || 0), 0)
const arredondar = (n) => Math.round(n * 10) / 10

// Dias corridos entre a primeira e a última data (limitados pelo período pedido) sem relatório.
// Não desconta domingo nem feriado: é um número informativo.
export function diasSemDiario(datas, { inicio = null, fim = null } = {}) {
  const unicas = [...new Set(datas)].sort()
  const zero = { corridos: 0, comDiario: 0, semDiario: 0 }
  if (!unicas.length) return zero
  const de = inicio && inicio > unicas[0] ? inicio : unicas[0]
  const ate = fim && fim < unicas[unicas.length - 1] ? fim : unicas[unicas.length - 1]
  if (de > ate) return zero
  const corridos = Math.round((utc(ate) - utc(de)) / DIA_MS) + 1
  const comDiario = unicas.filter((d) => d >= de && d <= ate).length
  return { corridos, comDiario, semDiario: corridos - comDiario }
}

export function montarIndicadores(entrada, { dataInicio = null, dataFim = null } = {}) {
  const {
    efetivoDia = [], efetivoEmpreiteira = [], efetivoFuncao = [], climaObra = [],
    tags = [], ocorrenciaTotais = { ocorrencias: 0, relatorios: 0 }, preenchimentoObra = [], diasComDiario = 0,
  } = entrada

  // Média de pessoas por dia com diário (nunca o acumulado do período, que não diz o tamanho da equipe).
  const media = (total) => (diasComDiario > 0 ? arredondar(Number(total) / diasComDiario) : 0)
  const preenchimento = preenchimentoObra.map((o) => {
    const dias = diasSemDiario(o.datas ?? [], { inicio: dataInicio, fim: dataFim })
    return {
      obraId: o.obra_id, obraNome: o.obra_nome, relatorios: o.relatorios, aprovados: o.aprovados,
      emRevisao: o.em_revisao, preenchendo: o.preenchendo, pendentesAntigos: o.pendentes_antigos,
      corridos: dias.corridos, comDiario: dias.comDiario, semDiario: dias.semDiario,
    }
  })

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
        semDiario: soma(preenchimento, 'semDiario'),
      },
      porObra: preenchimento,
    },
  }
}
