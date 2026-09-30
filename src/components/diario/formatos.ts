const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

const vazio = (v: unknown) => v === null || v === undefined || v === ''

export function fmtInteiro(v: unknown): string {
  return vazio(v) || !Number.isFinite(Number(v)) ? '-' : inteiro.format(Number(v))
}

const umaCasa = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Média de pessoas: sempre com uma casa decimal ('10,0').
export function fmtMedia(v: unknown): string {
  return vazio(v) || !Number.isFinite(Number(v)) ? '-' : umaCasa.format(Number(v))
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function fmtNumero(v: unknown): string {
  return vazio(v) || !Number.isFinite(Number(v)) ? '-' : decimal.format(Number(v))
}

// 'AAAA-MM-DD' ou 'AAAA-MM-DD HH:MM:SS' (também com 'T') → 'dd/mm/aaaa' ou 'dd/mm/aaaa HH:MM'
export function fmtData(v: unknown): string {
  if (typeof v !== 'string' || !v) return '-'
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return v
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`
}
