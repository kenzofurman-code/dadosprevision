import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import './App.css'
import { db, firebaseReady } from './firebase'

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

  const [datePart] = dataStr.split('T')
  const [ano, mes, dia] = datePart.split('-')

  if (!ano || !mes || !dia) return dataStr

  return `${dia}/${mes}/${ano}`
}

function App() {
  const [projetos, setProjetos] = useState<ProjetoPrevision[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    async function carregarProjetos() {
      if (!firebaseReady || !db) {
        setErro('Configure as variaveis de ambiente do Firebase para carregar os dados.')
        setCarregando(false)
        return
      }

      try {
        const projetosQuery = query(
          collection(db, 'prevision_projetos'),
          orderBy('nome_projeto'),
        )
        const snapshot = await getDocs(projetosQuery)

        setProjetos(snapshot.docs.map((doc) => doc.data() as ProjetoPrevision))
      } catch (error) {
        console.error('Erro ao ler dados do Firestore:', error)
        setErro(
          'Erro ao carregar dados. Confira as regras de leitura do Firestore e se a colecao prevision_projetos existe.',
        )
      } finally {
        setCarregando(false)
      }
    }

    carregarProjetos()
  }, [])

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

      <section className="table-panel" aria-live="polite">
        {carregando && <div className="state-message">Carregando dados do Firestore...</div>}

        {!carregando && erro && <div className="state-message error">{erro}</div>}

        {!carregando && !erro && projetos.length === 0 && (
          <div className="state-message">
            Nenhum dado encontrado. Execute a Cloud Function primeiro para povoar o banco.
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
