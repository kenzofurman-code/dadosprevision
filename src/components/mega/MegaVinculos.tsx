import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'

interface VinculoObra {
  obra: string
  obra_nome: string
  id_prevision: string | null
}

interface ProjetoPrevision {
  id_prevision: string
  nome_projeto: string
}

export function MegaVinculos() {
  const [obras, setObras] = useState<VinculoObra[]>([])
  const [projetos, setProjetos] = useState<ProjetoPrevision[]>([])
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/mega/vinculos')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar vínculos')
      setObras(data.obras || [])
      setProjetos(data.projetos || [])
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Erro ao carregar vínculos' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const salvar = async (obra: string, idPrevision: string) => {
    setSalvando(obra)
    setMensagem(null)
    try {
      const res = await fetch(`/api/mega/vinculos/${encodeURIComponent(obra)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_prevision: idPrevision }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar vínculo')
      setObras((atual) =>
        atual.map((o) => (o.obra === obra ? { ...o, id_prevision: idPrevision || null } : o)),
      )
      setMensagem({
        tipo: 'ok',
        texto: idPrevision ? `Obra ${obra} vinculada.` : `Vínculo da obra ${obra} removido.`,
      })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Erro ao salvar vínculo' })
    } finally {
      setSalvando(null)
    }
  }

  return (
    <div>
      <div className="mega-info-banner">
        <strong>Vínculo Obra Mega ↔ Projeto Privismo</strong>
        <span>
          Escolha o projeto da Prevision que corresponde a cada obra do Mega. A relação é parcial: obras sem
          projeto podem ficar sem vínculo. Cada projeto só pode estar vinculado a uma obra.
        </span>
      </div>

      {mensagem && (
        <div className="mega-info-banner" role="status">
          {mensagem.tipo === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{mensagem.texto}</span>
        </div>
      )}

      <div className="mega-table-container">
        <div className="mega-table-scroll">
          <table className="mega-table">
            <thead>
              <tr>
                <th>Obra no Mega</th>
                <th>Projeto no Privismo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {obras.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center">
                    <div className="mega-empty-state">
                      {loading ? <RefreshCw size={24} className="mega-loading-spinner" /> : <AlertCircle size={28} />}
                      <span>{loading ? 'Carregando obras...' : 'Nenhuma obra do Mega encontrada.'}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                obras.map((o) => (
                  <tr key={o.obra}>
                    <td>
                      <strong>{o.obra}</strong> {o.obra_nome && o.obra_nome !== o.obra ? <small>{o.obra_nome}</small> : null}
                    </td>
                    <td>
                      <select
                        className="mega-filter-select"
                        value={o.id_prevision || ''}
                        disabled={salvando === o.obra}
                        onChange={(e) => salvar(o.obra, e.target.value)}
                      >
                        <option value="">Sem vínculo</option>
                        {projetos.map((p) => (
                          <option key={p.id_prevision} value={p.id_prevision}>
                            {p.nome_projeto}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {salvando === o.obra ? (
                        <RefreshCw size={14} className="mega-loading-spinner" />
                      ) : o.id_prevision ? (
                        <span className="mega-badge success">Vinculada</span>
                      ) : (
                        <span className="mega-badge neutral">Pendente</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
