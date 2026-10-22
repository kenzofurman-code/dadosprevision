// Leitor do relatório "Conciliação Financeira" do Mega (xlsx exportado pelo usuário): uma linha
// por AP, parcela e rateio, com o vencimento e quanto já foi pago.

const normalizar = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

const COLUNAS = {
  ap: 'numero ap',
  parcela: 'parcela',
  tipo_documento: 'tipo documento',
  vencimento: 'data vencimento',
  valor_rateado: 'valor rateado',
  pago: 'pagamentos',
  saldo: 'saldo a pagar',
  cod_estruturado: 'codigo estruturado',
}

/** Data do Excel (número serial, Date, ISO ou dd/mm/aaaa) → 'YYYY-MM-DD'. */
function dataIso(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 0) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

const numero = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0)

export function lerConciliacaoFinanceira(matriz) {
  const linhasMatriz = Array.isArray(matriz) ? matriz : []
  const iCab = linhasMatriz.findIndex((l) => Array.isArray(l) && l.some((c) => normalizar(c) === COLUNAS.ap))
  if (iCab < 0) return { linhas: [], erros: ['Cabeçalho "Número AP" não encontrado.'] }

  const cab = linhasMatriz[iCab].map(normalizar)
  const idx = Object.fromEntries(Object.entries(COLUNAS).map(([k, nome]) => [k, cab.findIndex((c) => c.startsWith(nome))]))
  const faltando = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => COLUNAS[k])
  if (faltando.length) return { linhas: [], erros: [`Colunas não encontradas: ${faltando.join(', ')}.`] }

  const linhas = []
  for (const l of linhasMatriz.slice(iCab + 1)) {
    if (!Array.isArray(l)) continue
    const ap = Number(l[idx.ap])
    if (!Number.isInteger(ap) || ap <= 0) continue
    linhas.push({
      ap,
      parcela: l[idx.parcela] == null ? null : String(l[idx.parcela]),
      tipo_documento: l[idx.tipo_documento] == null ? null : String(l[idx.tipo_documento]).trim(),
      vencimento: dataIso(l[idx.vencimento]),
      valor_rateado: numero(l[idx.valor_rateado]),
      pago: numero(l[idx.pago]),
      saldo: numero(l[idx.saldo]),
      cod_estruturado: String(l[idx.cod_estruturado] ?? '').split(' - ')[0].trim() || null,
    })
  }
  return { linhas, erros: [] }
}
