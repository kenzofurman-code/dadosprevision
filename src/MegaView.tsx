import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  RefreshCw,
  Search,
  Download,
  ShoppingBag,
  Eye,
  Scale,
  FileCheck2,
  Server,
  Building2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import './MegaView.css'

export type MegaTabKey =
  | 'pedidos_compra'
  | 'visualizacao_itens'
  | 'analise_saldo'
  | 'itens_solicitados'
  | 'cargas'

export type SaldoSubTab = 'pedidos' | 'contratos' | 'realizado'

interface MegaObra {
  obra: string
  obra_nome: string
}

interface MegaSummary {
  totalPedidosCompra: number
  totalVisualizacaoItens: number
  totalSaldoPedidos: number
  totalSaldoContratos: number
  totalSaldoRealizado: number
  totalItensSolicitados: number
  ultimaExtracao: string | null
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
})

const integerFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

function formatDate(value: any) {
  if (!value || typeof value !== 'string') return '-'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function formatCurrency(value: any) {
  const num = Number(value)
  return Number.isFinite(num) ? currencyFormatter.format(num) : '-'
}

function formatNumber(value: any) {
  const num = Number(value)
  return Number.isFinite(num) ? numberFormatter.format(num) : '-'
}

export function MegaView() {
  const [activeTab, setActiveTab] = useState<MegaTabKey>('pedidos_compra')
  const [saldoSubTab, setSaldoSubTab] = useState<SaldoSubTab>('pedidos')
  const [obras, setObras] = useState<MegaObra[]>([])
  const [selectedObra, setSelectedObra] = useState<string>('')
  const [summary, setSummary] = useState<MegaSummary | null>(null)

  const [records, setRecords] = useState<any[]>([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Determina a tabela correta para o endpoint
  const currentTableKey = useMemo(() => {
    if (activeTab === 'analise_saldo') {
      return `analise_${saldoSubTab}`
    }
    return activeTab
  }, [activeTab, saldoSubTab])

  // Carregar lista de obras
  const loadObras = useCallback(async () => {
    try {
      const res = await fetch('/api/mega/obras')
      const data = await res.json()
      if (data.ok && Array.isArray(data.obras)) {
        setObras(data.obras)
        // Se houver obras e nenhuma selecionada, seleciona a primeira (ex: 340)
        if (data.obras.length > 0 && !selectedObra) {
          setSelectedObra(data.obras[0].obra)
        }
      }
    } catch (err) {
      console.error('Erro ao carregar obras do Mega:', err)
    }
  }, [selectedObra])

  // Carregar sumário
  const loadSummary = useCallback(async () => {
    try {
      const url = selectedObra ? `/api/mega/summary?obra=${encodeURIComponent(selectedObra)}` : '/api/mega/summary'
      const res = await fetch(url)
      const data = await res.json()
      if (data.ok && data.summary) {
        setSummary(data.summary)
      }
    } catch (err) {
      console.error('Erro ao carregar sumário do Mega:', err)
    }
  }, [selectedObra])

  // Carregar dados da tabela ativa
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        table: currentTableKey,
        page: String(page),
        limit: String(pageSize),
      })
      if (selectedObra) params.append('obra', selectedObra)
      if (search.trim()) params.append('search', search.trim())

      const res = await fetch(`/api/mega/data?${params.toString()}`)
      const data = await res.json()
      if (data.ok) {
        setRecords(data.records || [])
        setTotalRecords(data.total || 0)
      } else {
        setRecords([])
        setTotalRecords(0)
      }
    } catch (err) {
      console.error('Erro ao carregar registros do Mega:', err)
      setRecords([])
      setTotalRecords(0)
    } finally {
      setLoading(false)
    }
  }, [currentTableKey, selectedObra, page, pageSize, search])

  // Inicialização
  useEffect(() => {
    loadObras()
  }, [loadObras])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Resetar paginação ao trocar filtro ou aba
  const handleTabChange = (tab: MegaTabKey) => {
    setActiveTab(tab)
    setPage(0)
    setSearch('')
  }

  const handleSaldoSubTabChange = (sub: SaldoSubTab) => {
    setSaldoSubTab(sub)
    setPage(0)
    setSearch('')
  }

  const handleObraChange = (obra: string) => {
    setSelectedObra(obra)
    setPage(0)
  }

  // Exportar registros exibidos para XLSX
  const handleExportXlsx = async () => {
    if (records.length === 0) return
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      // Baixa até 5.000 linhas da consulta atual para o export
      const params = new URLSearchParams({
        table: currentTableKey,
        page: '0',
        limit: '5000',
      })
      if (selectedObra) params.append('obra', selectedObra)
      if (search.trim()) params.append('search', search.trim())

      const res = await fetch(`/api/mega/data?${params.toString()}`)
      const data = await res.json()
      const exportRows = data.ok ? data.records : records

      // Limpar campo raw_data para exportação mais limpa
      const cleanRows = exportRows.map((r: any) => {
        const copy = { ...r }
        delete copy.raw_data
        return copy
      })

      const ws = XLSX.utils.json_to_sheet(cleanRows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Dados_Mega')
      const dateStr = new Date().toISOString().slice(0, 10)
      const fileName = `Mega_${currentTableKey}_${selectedObra || 'Todas'}_${dateStr}.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch (err) {
      console.error('Erro ao exportar dados do Mega para XLSX:', err)
    } finally {
      setExporting(false)
    }
  }

  // Renderizadores de status/badge
  const renderBadge = (situacao: string | null | undefined) => {
    if (!situacao) return <span className="mega-badge neutral">-</span>
    const s = String(situacao).toUpperCase()
    if (s.includes('ATENDIDO') || s.includes('APROVADO') || s.includes('CONCLU') || s.includes('OK')) {
      return <span className="mega-badge success">{situacao}</span>
    }
    if (s.includes('CANCEL') || s.includes('REPROV') || s.includes('BLOQ')) {
      return <span className="mega-badge danger">{situacao}</span>
    }
    if (s.includes('EM APROV') || s.includes('PEND') || s.includes('ANDAMENTO')) {
      return <span className="mega-badge warning">{situacao}</span>
    }
    return <span className="mega-badge info">{situacao}</span>
  }

  // Renderizador de Colunas da Tabela
  const renderTableHeader = () => {
    switch (activeTab) {
      case 'pedidos_compra':
        return (
          <tr>
            <th>Obra</th>
            <th>Data Extração</th>
            <th>Nº Pedido</th>
            <th>Item</th>
            <th>Situação</th>
            <th>Dt. Emissão</th>
            <th>Fornecedor</th>
            <th>Descrição do Item</th>
            <th className="num-cell">Qtde</th>
            <th className="num-cell">Total Pedido</th>
          </tr>
        )
      case 'visualizacao_itens':
        return (
          <tr>
            <th>Obra</th>
            <th>Data Extração</th>
            <th>Orçamento</th>
            <th>Solicitação</th>
            <th>Seq</th>
            <th>Situação</th>
            <th>Fornecedor</th>
            <th>Cód. Item</th>
            <th>Descrição</th>
            <th className="num-cell">Qtde Solicitada</th>
            <th>Data Necessidade</th>
            <th className="num-cell">Valor Total</th>
            <th>Cód. Pedido</th>
            <th>Cód. Contrato</th>
          </tr>
        )
      case 'analise_saldo':
        if (saldoSubTab === 'pedidos') {
          return (
            <tr>
              <th>Obra</th>
              <th>Data Extração</th>
              <th>Cód. Pedido</th>
              <th>Fornecedor</th>
              <th className="num-cell">Qtde Pedido</th>
              <th className="num-cell">Valor Unitário</th>
              <th className="num-cell">Qtde Apropriada</th>
              <th className="num-cell">Valor Apropriação</th>
            </tr>
          )
        }
        if (saldoSubTab === 'contratos') {
          return (
            <tr>
              <th>Obra</th>
              <th>Data Extração</th>
              <th>Cód. Contrato</th>
              <th>Fornecedor</th>
              <th>Status Pré-Contrato</th>
              <th className="num-cell">Saldo Qtde</th>
              <th className="num-cell">Valor Unitário</th>
              <th className="num-cell">Total</th>
            </tr>
          )
        }
        return (
          <tr>
            <th>Obra</th>
            <th>Data Extração</th>
            <th>Documento</th>
            <th>Data Doc.</th>
            <th className="num-cell">AP</th>
            <th>Fornecedor</th>
            <th className="num-cell">Valor Apropriação</th>
          </tr>
        )
      case 'itens_solicitados':
        return (
          <tr>
            <th>Obra</th>
            <th>Data Extração</th>
            <th>Cód. Solicitação</th>
            <th>Nº RM</th>
            <th>Seq</th>
            <th>Dt. Emissão</th>
            <th>Situação</th>
            <th>Descrição do Item</th>
            <th className="num-cell">Qtde Solicitada</th>
            <th className="num-cell">Qtde Baixada</th>
            <th>Unidade</th>
          </tr>
        )
      case 'cargas':
        return (
          <tr>
            <th>ID</th>
            <th>Data Extração</th>
            <th>Relatório</th>
            <th>Arquivo</th>
            <th>Status</th>
            <th>Obras OK</th>
            <th>Obras Sem Movimento</th>
            <th>Obras Falhou</th>
            <th>Motivo</th>
            <th>Executado Em</th>
          </tr>
        )
      default:
        return null
    }
  }

  const renderTableRows = () => {
    if (records.length === 0) {
      return (
        <tr>
          <td colSpan={14} className="text-center">
            <div className="mega-empty-state">
              <AlertCircle size={28} />
              <span>Nenhum registro encontrado para os filtros selecionados.</span>
            </div>
          </td>
        </tr>
      )
    }

    return records.map((record, index) => {
      const key = record.id || record.numero_do_pedido || record.solicitacao || record.codigo_solicitacao || index

      switch (activeTab) {
        case 'pedidos_compra':
          return (
            <tr key={key}>
              <td><strong>{record.obra}</strong> <small>{record.obra_nome}</small></td>
              <td>{formatDate(record.data_extracao)}</td>
              <td><strong>{record.numero_do_pedido}</strong></td>
              <td>{record.item_pedido}</td>
              <td>{renderBadge(record.situacao_do_pedido)}</td>
              <td>{formatDate(record.dt_emissao)}</td>
              <td>{record.nome_fantasia || '-'}</td>
              <td>{record.descricao_do_item || '-'}</td>
              <td className="num-cell">{formatNumber(record.quantidade)}</td>
              <td className="num-cell"><strong>{formatCurrency(record.total_pedido_compra)}</strong></td>
            </tr>
          )
        case 'visualizacao_itens':
          return (
            <tr key={key}>
              <td><strong>{record.obra}</strong></td>
              <td>{formatDate(record.data_extracao)}</td>
              <td>{record.orcamento || '-'}</td>
              <td><strong>{record.solicitacao}</strong></td>
              <td>{record.sequencia}</td>
              <td>{renderBadge(record.situacao_do_item)}</td>
              <td>{record.fornecedor || '-'}</td>
              <td>{record.cod_item || '-'}</td>
              <td>{record.descricao || '-'}</td>
              <td className="num-cell">{formatNumber(record.qtde_solicitada)}</td>
              <td>{formatDate(record.data_de_necessidade)}</td>
              <td className="num-cell"><strong>{formatCurrency(record.valor_total)}</strong></td>
              <td>{record.cod_pedido || '-'}</td>
              <td>{record.cod_contrato || '-'}</td>
            </tr>
          )
        case 'analise_saldo':
          if (saldoSubTab === 'pedidos') {
            return (
              <tr key={key}>
                <td><strong>{record.obra}</strong></td>
                <td>{formatDate(record.data_extracao)}</td>
                <td><strong>{record.codigo_pedido}</strong></td>
                <td>{record.fornecedor || '-'}</td>
                <td className="num-cell">{formatNumber(record.qtde_pedido)}</td>
                <td className="num-cell">{formatCurrency(record.valor_unitario)}</td>
                <td className="num-cell">{formatNumber(record.qtde_apropriada)}</td>
                <td className="num-cell"><strong>{formatCurrency(record.valor_apropriacao)}</strong></td>
              </tr>
            )
          }
          if (saldoSubTab === 'contratos') {
            return (
              <tr key={key}>
                <td><strong>{record.obra}</strong></td>
                <td>{formatDate(record.data_extracao)}</td>
                <td><strong>{record.codigo_contrato}</strong></td>
                <td>{record.fornecedor || '-'}</td>
                <td>{renderBadge(record.status_pre_contrato)}</td>
                <td className="num-cell">{formatNumber(record.saldo_qtde_contrato)}</td>
                <td className="num-cell">{formatCurrency(record.valor_unitario)}</td>
                <td className="num-cell"><strong>{formatCurrency(record.total)}</strong></td>
              </tr>
            )
          }
          return (
            <tr key={key}>
              <td><strong>{record.obra}</strong></td>
              <td>{formatDate(record.data_extracao)}</td>
              <td><strong>{record.documento}</strong></td>
              <td>{formatDate(record.data_documento)}</td>
              <td className="num-cell">{formatNumber(record.ap)}</td>
              <td>{record.fornecedor || '-'}</td>
              <td className="num-cell"><strong>{formatCurrency(record.valor_apropriacao)}</strong></td>
            </tr>
          )
        case 'itens_solicitados':
          return (
            <tr key={key}>
              <td><strong>{record.obra}</strong></td>
              <td>{formatDate(record.data_extracao)}</td>
              <td><strong>{record.codigo_solicitacao}</strong></td>
              <td>{record.numero_rm}</td>
              <td>{record.sequencial_item}</td>
              <td>{formatDate(record.data_de_emissao)}</td>
              <td>{renderBadge(record.situacao_do_item)}</td>
              <td>{record.descricao_do_item || '-'}</td>
              <td className="num-cell">{formatNumber(record.quantidade_solicitada)}</td>
              <td className="num-cell">{formatNumber(record.quantidade_baixada)}</td>
              <td>{record.unidade || '-'}</td>
            </tr>
          )
        case 'cargas':
          return (
            <tr key={key}>
              <td>#{record.id}</td>
              <td>{formatDate(record.data_extracao)}</td>
              <td><strong>{record.relatorio}</strong></td>
              <td>{record.arquivo}</td>
              <td>
                {record.bloqueado ? (
                  <span className="mega-badge danger">Bloqueado</span>
                ) : (
                  <span className="mega-badge success">OK</span>
                )}
              </td>
              <td>{Array.isArray(record.obras_ok) && record.obras_ok.length > 0 ? record.obras_ok.join(', ') : '-'}</td>
              <td>{Array.isArray(record.obras_sem_movimento) && record.obras_sem_movimento.length > 0 ? record.obras_sem_movimento.join(', ') : '-'}</td>
              <td>{Array.isArray(record.obras_falhou) && record.obras_falhou.length > 0 ? record.obras_falhou.join(', ') : '-'}</td>
              <td><small>{record.motivo_bloqueio || '-'}</small></td>
              <td><small>{new Date(record.executado_em).toLocaleString('pt-BR')}</small></td>
            </tr>
          )
        default:
          return null
      }
    })
  }

  const totalPages = Math.ceil(totalRecords / pageSize)

  return (
    <div className="mega-view-container">
      {/* 1. Cards de Resumo */}
      <div className="mega-summary-grid">
        <div className="mega-summary-card">
          <div className="mega-summary-icon">
            <ShoppingBag size={20} />
          </div>
          <div>
            <h4>Pedidos de Compra</h4>
            <p>{integerFormatter.format(summary?.totalPedidosCompra ?? 0)}</p>
            <small>Itens de pedidos no ERP</small>
          </div>
        </div>

        <div className="mega-summary-card">
          <div className="mega-summary-icon">
            <Eye size={20} />
          </div>
          <div>
            <h4>Itens com Status</h4>
            <p>{integerFormatter.format(summary?.totalVisualizacaoItens ?? 0)}</p>
            <small>Follow-up de solicitações</small>
          </div>
        </div>

        <div className="mega-summary-card">
          <div className="mega-summary-icon">
            <Scale size={20} />
          </div>
          <div>
            <h4>Análise de Saldo</h4>
            <p>
              {integerFormatter.format(
                (summary?.totalSaldoPedidos ?? 0) +
                  (summary?.totalSaldoContratos ?? 0) +
                  (summary?.totalSaldoRealizado ?? 0),
              )}
            </p>
            <small>Linhas de saldo e realizado</small>
          </div>
        </div>

        <div className="mega-summary-card">
          <div className="mega-summary-icon success">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <h4>Última Extração</h4>
            <p>{summary?.ultimaExtracao ? formatDate(summary.ultimaExtracao) : 'Hoje'}</p>
            <small>Rotina noturna ativa (02:00)</small>
          </div>
        </div>
      </div>

      {/* 2. Barra de Navegação Principal do Mega (Sub-abas) */}
      <div className="mega-navigation-bar">
        <div className="mega-tabs">
          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'pedidos_compra' ? 'active' : ''}`}
            onClick={() => handleTabChange('pedidos_compra')}
          >
            <ShoppingBag size={15} />
            <span>Pedidos de Compra</span>
            {summary && <span className="mega-tab-badge">{integerFormatter.format(summary.totalPedidosCompra)}</span>}
          </button>

          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'visualizacao_itens' ? 'active' : ''}`}
            onClick={() => handleTabChange('visualizacao_itens')}
          >
            <Eye size={15} />
            <span>Visualização de Itens</span>
            {summary && <span className="mega-tab-badge">{integerFormatter.format(summary.totalVisualizacaoItens)}</span>}
          </button>

          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'analise_saldo' ? 'active' : ''}`}
            onClick={() => handleTabChange('analise_saldo')}
          >
            <Scale size={15} />
            <span>Análise de Saldo</span>
          </button>

          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'itens_solicitados' ? 'active' : ''}`}
            onClick={() => handleTabChange('itens_solicitados')}
          >
            <FileCheck2 size={15} />
            <span>Itens Solicitados</span>
          </button>

          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'cargas' ? 'active' : ''}`}
            onClick={() => handleTabChange('cargas')}
          >
            <Server size={15} />
            <span>Status das Cargas</span>
          </button>
        </div>

        {/* Se for Análise de Saldo, exibe o seletor das 3 abas */}
        {activeTab === 'analise_saldo' && (
          <div className="mega-subnav">
            <button
              type="button"
              className={`mega-subnav-btn ${saldoSubTab === 'pedidos' ? 'active' : ''}`}
              onClick={() => handleSaldoSubTabChange('pedidos')}
            >
              Aba Pedidos ({integerFormatter.format(summary?.totalSaldoPedidos ?? 0)})
            </button>
            <button
              type="button"
              className={`mega-subnav-btn ${saldoSubTab === 'contratos' ? 'active' : ''}`}
              onClick={() => handleSaldoSubTabChange('contratos')}
            >
              Aba Contratos ({integerFormatter.format(summary?.totalSaldoContratos ?? 0)})
            </button>
            <button
              type="button"
              className={`mega-subnav-btn ${saldoSubTab === 'realizado' ? 'active' : ''}`}
              onClick={() => handleSaldoSubTabChange('realizado')}
            >
              Aba Realizado ({integerFormatter.format(summary?.totalSaldoRealizado ?? 0)})
            </button>
          </div>
        )}
      </div>

      {/* 3. Toolbar de Filtros e Ações */}
      <div className="mega-toolbar">
        <div className="mega-toolbar-left">
          {activeTab !== 'cargas' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building2 size={16} style={{ color: 'var(--text-muted)' }} />
              <select
                className="mega-filter-select"
                value={selectedObra}
                onChange={(e) => handleObraChange(e.target.value)}
              >
                <option value="">Todas as Obras ({obras.length})</option>
                {obras.map((o) => (
                  <option key={o.obra} value={o.obra}>
                    Obra {o.obra} {o.obra_nome ? `— ${o.obra_nome}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mega-search-box">
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar fornecedor, pedido, item..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
            />
          </div>
        </div>

        <div className="mega-toolbar-right">
          <button
            type="button"
            className="mega-btn"
            onClick={() => {
              loadSummary()
              loadData()
            }}
            title="Atualizar dados do Mega"
          >
            <RefreshCw size={14} className={loading ? 'mega-loading-spinner' : ''} />
            <span>Atualizar</span>
          </button>

          <button
            type="button"
            className="mega-btn primary"
            onClick={handleExportXlsx}
            disabled={exporting || records.length === 0}
            title="Exportar dados visíveis para planilha Excel"
          >
            <Download size={14} />
            <span>{exporting ? 'Exportando...' : 'Exportar Excel'}</span>
          </button>
        </div>
      </div>

      {/* 4. Tabela de Registros */}
      <div className="mega-table-container">
        <div className="mega-table-scroll">
          <table className="mega-table">
            <thead>{renderTableHeader()}</thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={14} className="text-center">
                    <div className="mega-loading-state">
                      <RefreshCw size={24} className="mega-loading-spinner" />
                      <span>Carregando registros do Mega ERP...</span>
                    </div>
                  </td>
                </tr>
              ) : (
                renderTableRows()
              )}
            </tbody>
          </table>
        </div>

        {/* 5. Rodapé com Paginação */}
        <div className="mega-pagination">
          <div>
            Mostrando {totalRecords === 0 ? 0 : page * pageSize + 1} a{' '}
            {Math.min((page + 1) * pageSize, totalRecords)} de{' '}
            <strong>{integerFormatter.format(totalRecords)}</strong> registros
          </div>

          <div className="mega-pagination-controls">
            <select
              className="mega-filter-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(0)
              }}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              <option value={25}>25 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>

            <button
              type="button"
              className="mega-page-btn"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              title="Página anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <span>
              Página {page + 1} de {totalPages || 1}
            </span>

            <button
              type="button"
              className="mega-page-btn"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => setPage((p) => p + 1)}
              title="Próxima página"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
