import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

type ProjetoPrevision = {
  id_prevision?: string | number
  nome_projeto?: string
  empresa_nome?: string
  data_inicio?: string
  data_fim?: string
  status?: string
  desativado?: boolean
}

const formatarData = (dataStr?: string) => {
  if (!dataStr) return '-'

  const [datePart] = dataStr.split(/[T ]/)
  const [ano, mes, dia] = datePart.split('-')

  if (!ano || !mes || !dia) return dataStr

  return `${dia}/${mes}/${ano}`
}

async function fetchJson(url: string, options?: RequestInit) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(
        payload?.error ||
          `O servidor respondeu HTTP ${response.status} sem uma mensagem valida. Confira os logs da funcao na Vercel.`,
      )
    }

    if (!payload) {
      throw new Error('O servidor respondeu sem dados. Confira os logs da funcao na Vercel.')
    }

    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Tempo limite ao consultar o servidor.')
    }

    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function App() {
  const [projetos, setProjetos] = useState<ProjetoPrevision[]>([])
  const [carregando, setCarregando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')

  const carregarProjetos = useCallback(async () => {
    try {
      setCarregando(true)
      setErro('')
      const payload = await fetchJson('/api/projects')
      setProjetos(Array.isArray(payload.projects) ? payload.projects : [])
    } catch (error) {
      console.error('Erro ao carregar projetos:', error)
      setErro(
        error instanceof Error
          ? error.message
          : 'Erro ao carregar dados do servidor.',
      )
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    carregarProjetos()
  }, [carregarProjetos])

  async function sincronizarProjetos() {
    try {
      setSincronizando(true)
      setMensagem('')
      setErro('')

      const payload = await fetchJson('/api/sync-prevision', {
        method: 'POST',
      })

      setMensagem(`${payload.imported ?? 0} projeto(s) sincronizado(s).`)
      await carregarProjetos()
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao sincronizar com a Prevision.')
    } finally {
      setSincronizando(false)
    }
  }

  const resumo = useMemo(() => {
    const ativos = projetos.filter((projeto) => !projeto.desativado).length

    return {
      total: projetos.length,
      ativos,
      inativos: projetos.length - ativos,
    }
  }, [projetos])

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Projetos Prevision</p>
          <h1>Projetos sincronizados</h1>
          <p className="subtitle">
            Dados atualizados no Firestore e publicados em uma interface pronta para Vercel.
          </p>
        </div>

        <div className="summary" aria-label="Resumo dos projetos">
          <div>
            <span>{resumo.total}</span>
            <small>Total</small>
          </div>
          <div>
            <span>{resumo.ativos}</span>
            <small>Ativos</small>
          </div>
          <div>
            <span>{resumo.inativos}</span>
            <small>Inativos</small>
          </div>
        </div>
      </header>

      <div className="actions-bar">
        <button type="button" className="secondary-button" onClick={carregarProjetos} disabled={carregando}>
          {carregando ? 'Carregando...' : 'Recarregar'}
        </button>
        <button type="button" onClick={sincronizarProjetos} disabled={sincronizando}>
          {sincronizando ? 'Sincronizando...' : 'Sincronizar Prevision'}
        </button>
        {mensagem && <span>{mensagem}</span>}
      </div>

      <section className="table-panel" aria-live="polite">
        {carregando && <div className="state-message">Carregando dados do Firestore...</div>}

        {!carregando && erro && <div className="state-message error">{erro}</div>}

        {!carregando && !erro && projetos.length === 0 && (
          <div className="state-message">
            Nenhum dado encontrado. Use Sincronizar Prevision para povoar o banco.
          </div>
        )}

        {!carregando && !erro && projetos.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID Prevision</th>
                  <th>Nome do Projeto</th>
                  <th>Empresa</th>
                  <th>Data Inicio</th>
                  <th>Data Fim</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {projetos.map((projeto, index) => {
                  const statusClass = projeto.desativado ? 'status-inativo' : 'status-ativo'
                  const statusText = projeto.desativado ? 'Desativado' : projeto.status || 'Ativo'

                  return (
                    <tr key={`${projeto.id_prevision ?? projeto.nome_projeto ?? 'projeto'}-${index}`}>
                      <td>{projeto.id_prevision ?? '-'}</td>
                      <td>
                        <strong>{projeto.nome_projeto ?? '-'}</strong>
                      </td>
                      <td>{projeto.empresa_nome ?? '-'}</td>
                      <td>{formatarData(projeto.data_inicio)}</td>
                      <td>{formatarData(projeto.data_fim)}</td>
                      <td>
                        <span className={`status-badge ${statusClass}`}>{statusText}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

export default App
