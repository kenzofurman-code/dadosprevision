// Rastreio físico -> competência -> financeiro a partir dos fluxos de cada etapa.
// Cada fluxo é uma fatia de dinheiro com o mês físico de origem e os meses de competência e financeiro.

export type Tipo = 'MATERIAL' | 'MAO_DE_OBRA'
export type Linha = 'fis' | 'cmat' | 'cmo' | 'fmat' | 'fmo'

export interface Fluxo {
  tipo: Tipo
  fis: string
  comp: string
  fin: string
  valor: number
  mComp: string
  mFin: string
}

export interface EtapaRastreio {
  codigo_etapa: string
  codigo_prevision?: string | null
  nome: string
  fluxos?: Fluxo[]
  eventosEconomico?: Array<{ mes: string; valor: number }>
}

export interface Celula {
  linha: Linha
  mes: string
}

export interface Ligacao {
  de: Celula
  para: Celula
  tipo: Tipo
  valor: number
}

export interface LinhaPainel {
  texto: string
  valor: number
  motivo: string
  tipo?: Tipo
  alvo?: Celula
}

export interface Secao {
  titulo: string
  linhas: LinhaPainel[]
  total: number
}

export const LINHAS: Array<{ id: Linha; rotulo: string }> = [
  { id: 'fis', rotulo: 'Físico' },
  { id: 'cmat', rotulo: 'Comp. Mat' },
  { id: 'cmo', rotulo: 'Comp. MO' },
  { id: 'fmat', rotulo: 'Fin. Mat' },
  { id: 'fmo', rotulo: 'Fin. MO' },
]

export const ROTULO_LINHA: Record<Linha, string> = {
  fis: 'Físico-financeiro',
  cmat: 'Competência material',
  cmo: 'Competência MO',
  fmat: 'Financeiro material',
  fmo: 'Financeiro MO',
}

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5, 7)) - 1] || m.slice(5, 7)}/${m.slice(2, 4)}`

const tipoDaLinha = (l: Linha): Tipo | null => (l === 'cmat' || l === 'fmat' ? 'MATERIAL' : l === 'cmo' || l === 'fmo' ? 'MAO_DE_OBRA' : null)
const linhaComp = (t: Tipo): Linha => (t === 'MATERIAL' ? 'cmat' : 'cmo')
const linhaFin = (t: Tipo): Linha => (t === 'MATERIAL' ? 'fmat' : 'fmo')
const nomeTipo = (t: Tipo) => (t === 'MATERIAL' ? 'Material' : 'MO')

/** Valores por linha e mês da etapa: físico vem do econômico; o resto, dos fluxos. */
export function valoresDaEtapa(et: EtapaRastreio): Record<Linha, Map<string, number>> {
  const v: Record<Linha, Map<string, number>> = { fis: new Map(), cmat: new Map(), cmo: new Map(), fmat: new Map(), fmo: new Map() }
  const somar = (l: Linha, m: string, x: number) => v[l].set(m, (v[l].get(m) || 0) + x)
  for (const e of et.eventosEconomico || []) somar('fis', e.mes, e.valor)
  for (const f of et.fluxos || []) {
    somar(linhaComp(f.tipo), f.comp, f.valor)
    somar(linhaFin(f.tipo), f.fin, f.valor)
  }
  return v
}

// Soma fluxos agrupando por uma chave; devolve [chave, total, primeiro fluxo do grupo]
function agrupar(fluxos: Fluxo[], chave: (f: Fluxo) => string) {
  const m = new Map<string, { valor: number; f: Fluxo }>()
  for (const f of fluxos) {
    const k = chave(f)
    const a = m.get(k)
    if (a) a.valor += f.valor
    else m.set(k, { valor: f.valor, f })
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor)
}

const secao = (titulo: string, linhas: LinhaPainel[]): Secao => ({
  titulo,
  linhas,
  total: linhas.reduce((s, l) => s + l.valor, 0),
})

/** Setas e painel para a célula clicada (linha + mês) de uma etapa. */
export function tracar(et: EtapaRastreio, sel: Celula): { ligacoes: Ligacao[]; secoes: Secao[] } {
  const fluxos = et.fluxos || []
  const ligacoes: Ligacao[] = []
  const secoes: Secao[] = []
  const tipo = tipoDaLinha(sel.linha)

  if (sel.linha === 'fis') {
    // para onde vai o físico do mês: material e MO, por mês de competência
    const grupos = agrupar(fluxos.filter((f) => f.fis === sel.mes), (f) => `${f.tipo}|${f.comp}|${f.mComp}`)
    const linhas: LinhaPainel[] = grupos.map(({ valor, f }) => {
      const alvo = { linha: linhaComp(f.tipo), mes: f.comp }
      ligacoes.push({ de: sel, para: alvo, tipo: f.tipo, valor })
      return { texto: `${nomeTipo(f.tipo)} → competência ${rotuloMes(f.comp)}`, valor, motivo: f.mComp, tipo: f.tipo, alvo }
    })
    const fisico = (et.eventosEconomico || []).filter((e) => e.mes === sel.mes).reduce((s, e) => s + e.valor, 0)
    const semDivisao = fisico - linhas.reduce((s, l) => s + l.valor, 0)
    if (semDivisao > 0.05) linhas.push({ texto: 'Sem divisão material/MO no custo', valor: semDivisao, motivo: 'não gera competência' })
    secoes.push(secao('Vai para a competência', linhas))
    return { ligacoes, secoes }
  }

  if (!tipo) return { ligacoes, secoes }

  if (sel.linha === 'cmat' || sel.linha === 'cmo') {
    const doMes = fluxos.filter((f) => f.tipo === tipo && f.comp === sel.mes)
    secoes.push(secao('Veio do físico', agrupar(doMes, (f) => `${f.fis}|${f.mComp}`).map(({ valor, f }) => {
      const origem = { linha: 'fis' as Linha, mes: f.fis }
      ligacoes.push({ de: origem, para: sel, tipo, valor })
      return { texto: `← físico ${rotuloMes(f.fis)}`, valor, motivo: f.mComp, tipo, alvo: origem }
    })))
    secoes.push(secao('Vai para o financeiro', agrupar(doMes, (f) => `${f.fin}|${f.mFin}`).map(({ valor, f }) => {
      const alvo = { linha: linhaFin(tipo), mes: f.fin }
      ligacoes.push({ de: sel, para: alvo, tipo, valor })
      return { texto: `→ financeiro ${rotuloMes(f.fin)}`, valor, motivo: f.mFin, tipo, alvo }
    })))
    return { ligacoes, secoes }
  }

  // financeiro: de qual competência veio e, antes dela, de qual físico
  const doMes = fluxos.filter((f) => f.tipo === tipo && f.fin === sel.mes)
  secoes.push(secao('Veio da competência', agrupar(doMes, (f) => `${f.comp}|${f.mFin}`).map(({ valor, f }) => {
    const origem = { linha: linhaComp(tipo), mes: f.comp }
    ligacoes.push({ de: origem, para: sel, tipo, valor })
    return { texto: `← competência ${rotuloMes(f.comp)}`, valor, motivo: f.mFin, tipo, alvo: origem }
  })))
  secoes.push(secao('Que veio do físico', agrupar(doMes, (f) => `${f.fis}|${f.comp}|${f.mComp}`).map(({ valor, f }) => {
    const origem = { linha: 'fis' as Linha, mes: f.fis }
    ligacoes.push({ de: origem, para: { linha: linhaComp(tipo), mes: f.comp }, tipo, valor })
    return { texto: `← físico ${rotuloMes(f.fis)} (via comp. ${rotuloMes(f.comp)})`, valor, motivo: f.mComp, tipo, alvo: origem }
  })))
  return { ligacoes, secoes }
}
