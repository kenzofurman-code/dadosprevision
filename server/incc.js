// INCC-DI (FGV) pela API pública SGS do Banco Central — série 192, variação % mensal.
import { query } from './db.js'
import { parseSerieBcb } from './painel-teorico.js'

const URL_INCC_DI = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.192/dados?formato=json&dataInicial=01/01/2000'

/** Busca a série inteira e grava (upsert) em indices_incc. */
export async function sincronizarIncc({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(URL_INCC_DI, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Banco Central respondeu ${res.status} ao buscar o INCC-DI.`)
  const meses = parseSerieBcb(await res.json())
  if (!meses.length) throw new Error('Banco Central não retornou índices do INCC-DI.')
  await query(
    `INSERT INTO indices_incc (mes, variacao, atualizado_em)
     SELECT (m || '-01')::date, v, NOW() FROM unnest($1::text[], $2::numeric[]) AS x(m, v)
     ON CONFLICT (mes) DO UPDATE SET variacao = EXCLUDED.variacao, atualizado_em = NOW()`,
    [meses.map((m) => m.mes), meses.map((m) => m.variacao)],
  )
  return { meses_gravados: meses.length, ultimo_mes: meses[meses.length - 1].mes }
}

export async function listarIncc() {
  const { rows } = await query(`SELECT TO_CHAR(mes, 'YYYY-MM') AS mes, variacao::float AS variacao FROM indices_incc ORDER BY mes`)
  return rows
}

/** Na subida do servidor: só busca se a tabela ainda estiver vazia. */
export async function sincronizarInccSeVazio() {
  const { rows } = await query('SELECT 1 FROM indices_incc LIMIT 1')
  if (rows.length) return null
  return sincronizarIncc()
}
