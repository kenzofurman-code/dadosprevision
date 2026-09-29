// Orquestra a carga do Diário de Obra: obras → lista de relatórios → detalhe só do que é novo ou mudou.
// `client` fala com a API e `repo` com o banco; ambos são injetados para permitir teste sem rede nem Postgres.
import { mapearObra, mapearRelatorio } from './diario-map.js'

export async function sincronizarDiario({ client, repo, log = () => {} }) {
  const cargaId = await repo.iniciarCarga()
  const resumo = { obras: 0, novos: 0, alterados: 0, removidos: 0, erros: [] }

  async function sincronizarObra(item) {
    const detalhe = await client.get(`/obras/${item._id}`)
    await repo.salvarObra(mapearObra(item, detalhe))
    resumo.obras++

    const lista = await client.get(`/obras/${item._id}/relatorios?ordem=asc&limite=10000`)
    if (!Array.isArray(lista)) throw new Error('Lista de relatórios em formato inesperado.')
    const conhecidos = await repo.modifiedPorRelatorio(item._id)

    for (const r of lista) {
      const antes = conhecidos.get(r._id)
      if (antes !== undefined && antes === r.modified) continue
      try {
        const bruto = await client.get(`/obras/${item._id}/relatorios/${r._id}`)
        await repo.salvarRelatorio(mapearRelatorio(bruto))
        if (antes === undefined) resumo.novos++
        else resumo.alterados++
      } catch (err) {
        resumo.erros.push({ obra: item.nome, relatorio: r._id, erro: err.message })
      }
    }

    if (lista.length === 0 && conhecidos.size > 0) {
      resumo.erros.push({ obra: item.nome, erro: 'API devolveu lista vazia para obra com relatórios; remoções ignoradas.' })
    } else {
      resumo.removidos += await repo.marcarRemovidos(item._id, lista.map((r) => r._id))
    }
    log(`[Diário] ${item.nome}: ${lista.length} relatórios na API`)
  }

  let fatal = null
  try {
    const obras = await client.get('/obras')
    if (!Array.isArray(obras)) throw new Error('Lista de obras em formato inesperado.')
    for (const item of obras) {
      try {
        await sincronizarObra(item)
      } catch (err) {
        resumo.erros.push({ obra: item.nome, erro: err.message })
      }
    }
  } catch (err) {
    fatal = err
    resumo.erros.push({ erro: err.message })
  }

  const status = fatal ? 'erro' : resumo.erros.length ? 'parcial' : 'ok'
  await repo.finalizarCarga(cargaId, { ...resumo, status })
  return { ...resumo, status }
}

let emExecucao = false

// Evita duas cargas ao mesmo tempo dentro do mesmo processo (cron sobreposto).
export async function executarSincronizacaoDiario(deps) {
  if (emExecucao) return { ignorado: true }
  emExecucao = true
  try {
    return await sincronizarDiario(deps)
  } finally {
    emExecucao = false
  }
}
