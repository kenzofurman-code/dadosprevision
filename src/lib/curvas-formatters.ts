const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function formatMonth(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})/)
  return match ? `${MONTH_NAMES[Number(match[2]) - 1]}/${match[1].slice(2)}` : value
}

export function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

export function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${(Math.abs(value) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}
