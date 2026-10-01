export type TabelaDiario = 'relatorios' | 'atividades' | 'mao_obra' | 'equipamentos' | 'ocorrencias' | 'fotos' | 'cargas'

export interface ObraDiario {
  obra_id: string
  nome: string
  status: string | null
  relatorios: number
  primeira_data: string | null
  ultima_data: string | null
}

export interface ResumoDiario {
  relatorios: number
  atividades: number
  maoObra: number
  equipamentos: number
  ocorrencias: number
  fotos: number
  ultimaCarga: { id: number; iniciada_em: string; finalizada_em: string | null; status: string; novos: number; alterados: number; removidos: number } | null
}

export interface PaginaDiario {
  records: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface RelatorioDetalhe {
  relatorio: Record<string, any> & { raw: Record<string, any> }
  maoObra: { funcao: string | null; quantidade: number; empreiteira: string | null; empreiteira_norm: string | null }[]
  equipamentos: { descricao: string | null; quantidade: number }[]
  ocorrencias: { descricao: string | null; tags: string[]; paralisacao: boolean }[]
  atividades: { descricao: string | null; observacao: string | null; status: string | null; porcentagem: string | null; total_fotos: number }[]
  fotos: { url: string; url_miniatura: string | null; descricao: string | null; origem: string | null }[]
}

export interface IndicadoresDiario {
  efetivo: {
    porDia: { data: string; total: number }[]
    porEmpreiteira: { chave: string; rotulo: string; media: number }[]
    porFuncao: { rotulo: string; media: number }[]
    mediaPorDia: number
    diasComDiario: number
  }
  clima: {
    totais: { relatorios: number; chuvosos: number; impraticaveis: number; parados: number; chuvaMm: number }
    porObra: { obraId: string; obraNome: string; relatorios: number; chuvosos: number; impraticaveis: number; parados: number; chuvaMm: number }[]
    porDia: { data: string; totalObras: number; chuvosos: number; impraticaveis: number; parados: number; chuvaMediaMm: number; chuvaMaxMm: number }[]
  }
  ocorrencias: { total: number; relatorios: number; porTag: { tag: string; total: number }[] }
  preenchimento: {
    totais: {
      relatorios: number
      aprovados: number
      emRevisao: number
      preenchendo: number
      pendentesAntigos: number
      diasUteis: number
      diasCorridos: number
      semDiarioUteis: number
      semAprovadoUteis: number
      semDiario: number
    }
    porObra: {
      obraId: string
      obraNome: string
      relatorios: number
      aprovados: number
      emRevisao: number
      preenchendo: number
      pendentesAntigos: number
      corridos: number
      comDiario: number
      semDiario: number
      diasUteis: number
      comDiarioUteis: number
      semDiarioUteis: number
      aprovadosUteis: number
      semAprovadoUteis: number
    }[]
  }
}

async function obter<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const corpo = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(corpo.error || `Erro ${res.status}`)
  return corpo as T
}

export const diarioApi = {
  obras: () => obter<{ obras: ObraDiario[] }>('/api/diario/obras').then((r) => r.obras),
  resumo: (obra: string) =>
    obter<{ summary: ResumoDiario }>(`/api/diario/summary?obra=${encodeURIComponent(obra)}`).then((r) => r.summary),
  dados: (tabela: TabelaDiario, p: { obra: string; page: number; limit: number; search: string }) => {
    const q = new URLSearchParams({ table: tabela, page: String(p.page), limit: String(p.limit) })
    if (p.obra) q.set('obra', p.obra)
    if (p.search) q.set('search', p.search)
    return obter<PaginaDiario>(`/api/diario/data?${q}`)
  },
  relatorio: (id: string) => obter<RelatorioDetalhe>(`/api/diario/relatorios/${encodeURIComponent(id)}`),
  indicadores: (f: { obra: string; dataInicio: string; dataFim: string }) => {
    const q = new URLSearchParams()
    if (f.obra) q.set('obra', f.obra)
    if (f.dataInicio) q.set('dataInicio', f.dataInicio)
    if (f.dataFim) q.set('dataFim', f.dataFim)
    return obter<IndicadoresDiario>(`/api/diario/indicadores?${q}`)
  },
}
