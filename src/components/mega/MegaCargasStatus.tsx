import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSpreadsheet,
  Layers,
  MinusCircle,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react'
import './MegaCargasStatus.css'

export interface ObraItem {
  obra: string
  nome: string
}

export interface RelatorioItem {
  key: string
  label: string
  modulo: string
  relatorio: string
  arquivoPattern: string | null
  isGlobal?: boolean
}

export interface CellStatus {
  status: 'ok' | 'falhou' | 'sem_movimento' | 'nao_executado'
  count?: number
  motivo?: string | null
  horario?: string | null
  idCarga?: number | null
}

export interface CargaRaw {
  id: number
  relatorio: string
  arquivo: string
  data_extracao: string
  obras_ok: string[]
  obras_sem_movimento: string[]
  obras_falhou: string[]
  bloqueado: boolean
  motivo_bloqueio: string | null
  horario: string
  executado_em: string
}

export interface CargasStatusResponse {
  data: string
  datasDisponiveis: string[]
  obras: ObraItem[]
  relatorios: RelatorioItem[]
  matriz: Record<string, Record<string, CellStatus>>
  resumo: {
    totalCargas: number
    totalOk: number
    totalFalhou: number
    totalSemMovimento: number
    totalNaoExecutado: number
    obras100Porcento: number
    totalObras: number
    inicio: string | null
    fim: string | null
  }
  cargas: CargaRaw[]
}

function formatarDataPorExtenso(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const data = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return data.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function somarDiasIso(iso: string, delta: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

const intFmt = new Intl.NumberFormat('pt-BR')

export function MegaCargasStatus() {
  const [dataSelecionada, setDataSelecionada] = useState<string>('')
  const [dados, setDados] = useState<CargasStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLogBruto, setShowLogBruto] = useState(false)
  const [filtroLog, setFiltroLog] = useState('')
  const [modalErro, setModalErro] = useState<{
    relatorioLabel: string
    obraNome: string
    obraCodigo: string
    cell: CellStatus
  } | null>(null)

  const hojeIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const ontemIso = useMemo(() => somarDiasIso(new Date().toISOString().slice(0, 10), -1), [])

  const carregarStatus = useCallback(async (dataAlvo?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = dataAlvo
        ? `/api/mega/cargas/status-diario?data=${encodeURIComponent(dataAlvo)}`
        : '/api/mega/cargas/status-diario'
      const res = await fetch(url)
      const json = await res.json()
      if (json.ok) {
        setDados(json)
        setDataSelecionada(json.data)
      } else {
        setError(json.error || 'Erro ao carregar status das cargas')
      }
    } catch (err: any) {
      console.error('Falha ao carregar status diário das cargas:', err)
      setError(err.message || 'Erro de conexão com o servidor')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregarStatus()
  }, [carregarStatus])

  function handleDataChange(novaData: string) {
    if (!novaData) return
    setDataSelecionada(novaData)
    carregarStatus(novaData)
  }

  function navegarDia(delta: number) {
    const base = dataSelecionada || hojeIso
    const nova = somarDiasIso(base, delta)
    handleDataChange(nova)
  }

  // Agrupar relatórios por módulo
  const relatoriosPorModulo = useMemo(() => {
    if (!dados?.relatorios) return []
    const grupos: Record<string, RelatorioItem[]> = {}
    for (const rel of dados.relatorios) {
      if (!grupos[rel.modulo]) grupos[rel.modulo] = []
      grupos[rel.modulo].push(rel)
    }
    return Object.entries(grupos)
  }, [dados?.relatorios])

  // Cargas brutas filtradas para a tabela de log
  const cargasFiltradas = useMemo(() => {
    if (!dados?.cargas) return []
    if (!filtroLog.trim()) return dados.cargas
    const termo = filtroLog.trim().toLowerCase()
    return dados.cargas.filter((c) =>
      String(c.relatorio || '').toLowerCase().includes(termo) ||
      String(c.arquivo || '').toLowerCase().includes(termo) ||
      String(c.motivo_bloqueio || '').toLowerCase().includes(termo) ||
      (Array.isArray(c.obras_ok) && c.obras_ok.some((o) => String(o).includes(termo))) ||
      (Array.isArray(c.obras_falhou) && c.obras_falhou.some((o) => String(o).includes(termo)))
    )
  }, [dados?.cargas, filtroLog])

  return (
    <div className="mega-cargas-status-container">
      {/* 1. Barra de Navegação de Datas (estilo Painel 7) */}
      <div className="mega-cargas-header-toolbar">
        <div className="mega-cargas-date-nav">
          <button
            type="button"
            className="mega-cargas-nav-btn"
            onClick={() => navegarDia(-1)}
            title="Dia anterior"
            disabled={loading}
          >
            <ChevronLeft size={16} />
          </button>

          <label className="mega-cargas-date-input-wrap">
            <Calendar size={14} className="mega-cargas-calendar-icon" />
            <input
              type="date"
              className="mega-cargas-date-input"
              value={dataSelecionada}
              onChange={(e) => handleDataChange(e.target.value)}
              disabled={loading}
            />
          </label>

          <button
            type="button"
            className="mega-cargas-nav-btn"
            onClick={() => navegarDia(1)}
            title="Próximo dia"
            disabled={loading}
          >
            <ChevronRight size={16} />
          </button>

          {dataSelecionada && (
            <span className="mega-cargas-date-label">
              {formatarDataPorExtenso(dataSelecionada)}
            </span>
          )}
        </div>

        {/* Botões Rápidos */}
        <div className="mega-cargas-quick-actions">
          {dados?.datasDisponiveis && dados.datasDisponiveis.length > 0 && (
            <button
              type="button"
              className={`mega-cargas-quick-btn ${dataSelecionada === dados.datasDisponiveis[0] ? 'active' : ''}`}
              onClick={() => handleDataChange(dados.datasDisponiveis[0])}
              title={`Ir para a última extração com registros (${dados.datasDisponiveis[0]})`}
            >
              Última Carga ({dados.datasDisponiveis[0].slice(5).replace('-', '/')})
            </button>
          )}

          <button
            type="button"
            className={`mega-cargas-quick-btn ${dataSelecionada === ontemIso ? 'active' : ''}`}
            onClick={() => handleDataChange(ontemIso)}
          >
            Ontem
          </button>

          <button
            type="button"
            className={`mega-cargas-quick-btn ${dataSelecionada === hojeIso ? 'active' : ''}`}
            onClick={() => handleDataChange(hojeIso)}
          >
            Hoje
          </button>

          <button
            type="button"
            className="mega-cargas-quick-btn refresh"
            onClick={() => carregarStatus(dataSelecionada)}
            title="Recarregar status do dia"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'mega-loading-spinner' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mega-cargas-error-banner">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Cards de Resumo do Dia Selecionado */}
      {dados && (
        <div className="mega-cargas-cards-grid">
          <div className="mega-cargas-card">
            <div className="mega-cargas-card-header">
              <span className="mega-cargas-card-title">STATUS GERAL DA EXTRAÇÃO</span>
              <Server size={18} className="text-primary" />
            </div>
            <div className="mega-cargas-card-body">
              <div className="mega-cargas-metric">
                <span className="mega-cargas-metric-value ok">{dados.resumo.totalOk}</span>
                <span className="mega-cargas-metric-label">sucessos</span>
              </div>
              <div className="mega-cargas-metric-separator" />
              <div className="mega-cargas-metric">
                <span className={`mega-cargas-metric-value ${dados.resumo.totalFalhou > 0 ? 'fail' : 'neutral'}`}>
                  {dados.resumo.totalFalhou}
                </span>
                <span className="mega-cargas-metric-label">falhas</span>
              </div>
              <div className="mega-cargas-metric-separator" />
              <div className="mega-cargas-metric">
                <span className="mega-cargas-metric-value neutral">{dados.resumo.totalCargas}</span>
                <span className="mega-cargas-metric-label">cargas no dia</span>
              </div>
            </div>
          </div>

          <div className="mega-cargas-card">
            <div className="mega-cargas-card-header">
              <span className="mega-cargas-card-title">OBRAS 100% CONCLUÍDAS</span>
              <ShieldCheck size={18} className="text-success" />
            </div>
            <div className="mega-cargas-card-body">
              <div className="mega-cargas-metric">
                <span className="mega-cargas-metric-value success">
                  {dados.resumo.obras100Porcento}
                </span>
                <span className="mega-cargas-metric-label">de {dados.resumo.totalObras} obras</span>
              </div>
              <div className="mega-cargas-progress-bar-wrap">
                <div
                  className="mega-cargas-progress-bar-fill"
                  style={{
                    width: `${Math.round((dados.resumo.obras100Porcento / Math.max(1, dados.resumo.totalObras)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="mega-cargas-card">
            <div className="mega-cargas-card-header">
              <span className="mega-cargas-card-title">JANELA DE EXECUÇÃO</span>
              <Clock size={18} className="text-muted" />
            </div>
            <div className="mega-cargas-card-body">
              {dados.resumo.inicio ? (
                <div className="mega-cargas-time-range">
                  <strong>{dados.resumo.inicio}</strong>
                  <span>até</span>
                  <strong>{dados.resumo.fim || dados.resumo.inicio}</strong>
                </div>
              ) : (
                <span className="mega-cargas-no-time">Nenhuma execução registrada nesta data</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Matriz Visual de Status: Relatórios × Obras */}
      {dados && (
        <div className="mega-cargas-matrix-container">
          <div className="mega-cargas-matrix-header">
            <div>
              <h3 className="mega-cargas-matrix-title">
                Matriz de Extração por Relatório e Projeto
              </h3>
              <p className="mega-cargas-matrix-subtitle">
                Visualização detalhada do status e volume de registros extraídos na data selecionada ({dataSelecionada}).
              </p>
            </div>

            <div className="mega-cargas-legend">
              <span className="mega-cargas-legend-item">
                <span className="mega-cargas-dot ok" /> Sucesso (OK)
              </span>
              <span className="mega-cargas-legend-item">
                <span className="mega-cargas-dot fail" /> Falhou / Bloqueado
              </span>
              <span className="mega-cargas-legend-item">
                <span className="mega-cargas-dot sem-mov" /> Sem Movimento
              </span>
              <span className="mega-cargas-legend-item">
                <span className="mega-cargas-dot none" /> Não Executado
              </span>
            </div>
          </div>

          <div className="mega-cargas-matrix-scroll">
            <table className="mega-cargas-table">
              <thead>
                <tr>
                  <th className="relatorio-col">Relatório / Módulo</th>
                  {dados.obras.map((ob) => {
                    // Verificar se a obra teve alguma falha no dia
                    let obraTemFalha = false
                    let obraTemSucesso = false
                    for (const rel of dados.relatorios) {
                      const cell = dados.matriz[rel.key]?.[ob.obra]
                      if (cell?.status === 'falhou') obraTemFalha = true
                      if (cell?.status === 'ok') obraTemSucesso = true
                    }

                    return (
                      <th key={ob.obra} className="obra-col" title={`Obra ${ob.obra}: ${ob.nome}`}>
                        <div className="obra-header-content">
                          <div className="obra-header-code-line">
                            <span className="obra-code">Obra {ob.obra}</span>
                            {obraTemFalha ? (
                              <span className="obra-status-dot fail" title="Obra com falha em um ou mais relatórios" />
                            ) : obraTemSucesso ? (
                              <span className="obra-status-dot ok" title="Obra 100% com sucesso" />
                            ) : null}
                          </div>
                          <small className="obra-name-short">
                            {ob.nome.replace(/^PIEMONTE\s+/i, '').slice(0, 16)}
                          </small>
                        </div>
                      </th>
                    )
                  })}
                  <th className="summary-col">Status Geral</th>
                </tr>
              </thead>
              <tbody>
                {relatoriosPorModulo.map(([modulo, relatoriosDoModulo]) => (
                  <React.Fragment key={`mod_group_${modulo}`}>
                    <tr className="modulo-group-row">
                      <td colSpan={dados.obras.length + 2} className="modulo-group-header">
                        {modulo === 'Suprimentos' && <Layers size={13} />}
                        {modulo === 'Contratos' && <FileSpreadsheet size={13} />}
                        {modulo === 'Approvo' && <CheckCircle2 size={13} />}
                        <span>{modulo.toUpperCase()}</span>
                      </td>
                    </tr>
                    {relatoriosDoModulo.map((rel) => {
                      const rowCells = dados.obras.map((ob) => dados.matriz[rel.key]?.[ob.obra])
                      const countOk = rowCells.filter((c) => c?.status === 'ok').length
                      const countFail = rowCells.filter((c) => c?.status === 'falhou').length
                      const totalObras = dados.obras.length

                      return (
                        <tr key={rel.key}>
                          <td className="relatorio-name-cell">
                            <div className="relatorio-name-box">
                              <span className="relatorio-title">{rel.label}</span>
                            <span className="relatorio-subtag">{rel.modulo}</span>
                          </div>
                        </td>

                        {dados.obras.map((ob) => {
                          const cell = dados.matriz[rel.key]?.[ob.obra]
                          if (!cell) {
                            return (
                              <td key={ob.obra} className="status-cell">
                                <span className="status-badge none">—</span>
                              </td>
                            )
                          }

                          if (cell.status === 'ok') {
                            return (
                              <td key={ob.obra} className="status-cell">
                                <span
                                  className="status-badge ok"
                                  title={
                                    cell.count !== undefined
                                      ? `Extraído com sucesso (${intFmt.format(cell.count)} registros)${cell.horario ? ` às ${cell.horario}` : ''}`
                                      : `Sucesso${cell.horario ? ` às ${cell.horario}` : ''}`
                                  }
                                >
                                  <CheckCircle2 size={12} />
                                  <span>
                                    {cell.count !== undefined && cell.count > 0
                                      ? `${intFmt.format(cell.count)} reg`
                                      : 'OK'}
                                  </span>
                                </span>
                              </td>
                            )
                          }

                          if (cell.status === 'falhou') {
                            return (
                              <td key={ob.obra} className="status-cell">
                                <button
                                  type="button"
                                  className="status-badge fail clickable"
                                  onClick={() =>
                                    setModalErro({
                                      relatorioLabel: rel.label,
                                      obraNome: ob.nome,
                                      obraCodigo: ob.obra,
                                      cell,
                                    })
                                  }
                                  title={`Falha na extração. Clique para ver detalhes: ${cell.motivo || 'Erro'}`}
                                >
                                  <AlertTriangle size={12} />
                                  <span>Falhou</span>
                                </button>
                              </td>
                            )
                          }

                          if (cell.status === 'sem_movimento') {
                            return (
                              <td key={ob.obra} className="status-cell">
                                <span
                                  className="status-badge sem-mov"
                                  title="Obra sem movimento neste relatório"
                                >
                                  <MinusCircle size={12} />
                                  <span>Sem Mov.</span>
                                </span>
                              </td>
                            )
                          }

                          return (
                            <td key={ob.obra} className="status-cell">
                              <span className="status-badge none" title="Não executado nesta data">
                                —
                              </span>
                            </td>
                          )
                        })}

                        <td className="summary-cell">
                          {countFail > 0 ? (
                            <span className="summary-pill fail">
                              {countFail} falha{countFail > 1 ? 's' : ''} ({countOk}/{totalObras} OK)
                            </span>
                          ) : countOk === totalObras ? (
                            <span className="summary-pill ok">100% OK ({countOk}/{totalObras})</span>
                          ) : countOk > 0 ? (
                            <span className="summary-pill neutral">{countOk}/{totalObras} OK</span>
                          ) : (
                            <span className="summary-pill none">Não executado</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </React.Fragment>
              ))}
            </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Acordeão: Log Detalhado de Cargas Brutas */}
      {dados && dados.cargas.length > 0 && (
        <div className="mega-cargas-log-section">
          <button
            type="button"
            className="mega-cargas-log-toggle"
            onClick={() => setShowLogBruto(!showLogBruto)}
          >
            <div className="mega-cargas-log-toggle-left">
              <Server size={15} />
              <strong>Histórico Técnico de Execuções do Dia</strong>
              <span className="mega-cargas-log-badge">{dados.cargas.length} registros</span>
            </div>
            <span className="mega-cargas-log-toggle-action">
              {showLogBruto ? 'Ocultar Log Detalhado ▲' : 'Ver Log Detalhado ▼'}
            </span>
          </button>

          {showLogBruto && (
            <div className="mega-cargas-log-content">
              <div className="mega-cargas-log-toolbar">
                <div className="mega-search-box" style={{ maxWidth: '320px' }}>
                  <Search size={14} style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Filtrar por relatório, arquivo, motivo..."
                    value={filtroLog}
                    onChange={(e) => setFiltroLog(e.target.value)}
                  />
                </div>
                <small>{cargasFiltradas.length} de {dados.cargas.length} execuções</small>
              </div>

              <div className="mega-table-scroll" style={{ maxHeight: '350px' }}>
                <table className="mega-table">
                  <thead>
                    <tr>
                      <th style={{ width: '80px' }}>ID</th>
                      <th style={{ width: '90px' }}>Horário</th>
                      <th>Relatório</th>
                      <th>Arquivo</th>
                      <th>Obras OK</th>
                      <th>Obras Falhou</th>
                      <th>Status</th>
                      <th>Motivo do Bloqueio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cargasFiltradas.map((c) => (
                      <tr key={c.id}>
                        <td className="text-muted">#{c.id}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.horario}</td>
                        <td><strong>{c.relatorio}</strong></td>
                        <td className="text-muted">{c.arquivo}</td>
                        <td>
                          {Array.isArray(c.obras_ok) && c.obras_ok.length > 0 ? (
                            <span className="log-pill ok">{c.obras_ok.join(', ')}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {Array.isArray(c.obras_falhou) && c.obras_falhou.length > 0 ? (
                            <span className="log-pill fail">{c.obras_falhou.join(', ')}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {c.bloqueado ? (
                            <span className="log-pill fail">Bloqueado</span>
                          ) : (
                            <span className="log-pill ok">OK</span>
                          )}
                        </td>
                        <td className="text-muted" style={{ maxWidth: '300px', fontSize: '11px' }}>
                          {c.motivo_bloqueio || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Modal de Detalhe de Falha */}
      {modalErro && (
        <div className="mega-modal-backdrop" onClick={() => setModalErro(null)}>
          <div className="mega-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="mega-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} className="text-danger" />
                <h3 style={{ margin: 0, fontSize: '16px' }}>Detalhe da Falha na Extração</h3>
              </div>
              <button
                type="button"
                className="mega-modal-close"
                onClick={() => setModalErro(null)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="mega-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <small className="text-muted" style={{ display: 'block' }}>RELATÓRIO</small>
                <strong>{modalErro.relatorioLabel}</strong>
              </div>

              <div>
                <small className="text-muted" style={{ display: 'block' }}>PROJETO / OBRA</small>
                <strong>Obra {modalErro.obraCodigo} — {modalErro.obraNome}</strong>
              </div>

              {modalErro.cell.horario && (
                <div>
                  <small className="text-muted" style={{ display: 'block' }}>HORÁRIO DA EXECUÇÃO</small>
                  <span>{modalErro.cell.horario}</span>
                </div>
              )}

              {modalErro.cell.idCarga && (
                <div>
                  <small className="text-muted" style={{ display: 'block' }}>ID DA CARGA</small>
                  <span>#{modalErro.cell.idCarga}</span>
                </div>
              )}

              <div style={{ background: 'rgba(239, 68, 68, 0.08)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                <small style={{ color: '#b91c1c', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                  MOTIVO DO ERRO / BLOQUEIO
                </small>
                <code style={{ color: '#b91c1c', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px' }}>
                  {modalErro.cell.motivo || 'Nenhum motivo detalhado registrado para este bloqueio.'}
                </code>
              </div>
            </div>

            <div className="mega-modal-footer">
              <button
                type="button"
                className="mega-btn"
                onClick={() => setModalErro(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
