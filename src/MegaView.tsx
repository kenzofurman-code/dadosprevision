import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  RefreshCw,
  Search,
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
  Layers,
  History,
  SlidersHorizontal,
  BookmarkPlus,
  FileText,
} from 'lucide-react'
import './MegaView.css'
import {
  TABLE_COLUMNS,
  type MegaColumnDef,
  type SavedView,
  getAllViews,
  saveCustomView,
  updateCustomView,
  deleteCustomView,
  getActiveViewSelection,
  setActiveViewSelection,
  getRecordValue,
} from './components/mega/mega-columns'
import { MegaColumnModal } from './components/mega/MegaColumnModal'
import { MegaSaveViewModal } from './components/mega/MegaSaveViewModal'
import { MegaSavedViewsMenu } from './components/mega/MegaSavedViewsMenu'
import { MegaReportModal } from './components/mega/MegaReportModal'

export type MegaTabKey =
  | 'pedidos_compra'
  | 'visualizacao_itens'
  | 'analise_saldo'
  | 'itens_solicitados'
  | 'solicitacoes_por_etapa'
  | 'cargas'
  | 'follow_itenscontratos_itens'
  | 'follow_itenscontratos_medicoes'
  | 'follow_itenscontratos_historico'

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
  totalSolicitacoesEtapa?: number
  totalFollowItensContratos?: number
  totalMedicoesContratos?: number
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

  // Modais de Personalização e Relatórios
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false)
  const [isSaveViewModalOpen, setIsSaveViewModalOpen] = useState(false)
  const [isReportModalOpen, setIsReportModalOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Determina a tabela correta para o endpoint e para as definições de colunas
  const currentTableKey = useMemo(() => {
    if (activeTab === 'analise_saldo') {
      return `analise_${saldoSubTab}`
    }
    return activeTab
  }, [activeTab, saldoSubTab])

  // Todas as colunas disponíveis para a tabela ativa
  const allColumns = useMemo(() => {
    return TABLE_COLUMNS[currentTableKey] || []
  }, [currentTableKey])

  // Estado das visões salvas e colunas ativas da tabela atual
  const [allViews, setAllViews] = useState<SavedView[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [activeColumns, setActiveColumns] = useState<string[]>([])

  // Sincroniza visões salvas e colunas ativas ao trocar de tabela ou sub-aba
  useEffect(() => {
    const views = getAllViews(currentTableKey)
    setAllViews(views)

    const sel = getActiveViewSelection(currentTableKey)
    setActiveViewId(sel.activeViewId)

    const validCols = sel.columns.filter((colId) =>
      allColumns.some((c) => c.id === colId),
    )
    setActiveColumns(
      validCols.length > 0
        ? validCols
        : allColumns.filter((c) => c.defaultVisible).map((c) => c.id),
    )
  }, [currentTableKey, allColumns])

  // Definições de colunas atualmente ativas
  const activeColumnDefs = useMemo(() => {
    return activeColumns
      .map((id) => allColumns.find((c) => c.id === id))
      .filter((c): c is MegaColumnDef => Boolean(c))
  }, [activeColumns, allColumns])

  // Feedback Toast
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 3200)
  }

  // Ações de gerenciamento de visões e colunas
  const handleApplyColumns = (newCols: string[]) => {
    setActiveColumns(newCols)
    setActiveViewSelection(currentTableKey, activeViewId, newCols)
    showToast(`${newCols.length} colunas exibidas na tabela`)
  }

  const handleSelectView = (view: SavedView) => {
    setActiveViewId(view.id)
    const validCols = view.columns.filter((colId) =>
      allColumns.some((c) => c.id === colId),
    )
    setActiveColumns(validCols)
    setActiveViewSelection(currentTableKey, view.id, validCols)
    showToast(`Visão "${view.name}" aplicada`)
  }

  const handleSaveCustomView = (name: string, isUpdate: boolean) => {
    if (isUpdate && activeViewId && !activeViewId.startsWith('preset_')) {
      updateCustomView(currentTableKey, activeViewId, name, activeColumns)
      showToast(`Visão "${name}" atualizada com sucesso!`)
    } else {
      const created = saveCustomView(currentTableKey, name, activeColumns)
      setActiveViewId(created.id)
      showToast(`Visão "${name}" salva com sucesso!`)
    }
    setAllViews(getAllViews(currentTableKey))
  }

  const handleDeleteCustomView = (viewId: string) => {
    deleteCustomView(currentTableKey, viewId)
    const updated = getAllViews(currentTableKey)
    setAllViews(updated)
    if (activeViewId === viewId) {
      const defaultView = updated[0]
      setActiveViewId(defaultView.id)
      setActiveColumns(defaultView.columns)
      setActiveViewSelection(currentTableKey, defaultView.id, defaultView.columns)
    }
    showToast('Visão excluída com sucesso')
  }

  // Título legível para o modal de relatório
  const tableTitle = useMemo(() => {
    switch (activeTab) {
      case 'pedidos_compra':
        return 'Pedidos de Compra'
      case 'visualizacao_itens':
        return 'Visualização de Itens (Follow-up)'
      case 'analise_saldo':
        if (saldoSubTab === 'pedidos') return 'Análise de Saldo — Pedidos'
        if (saldoSubTab === 'contratos') return 'Análise de Saldo — Contratos'
        return 'Análise de Saldo — Realizado'
      case 'itens_solicitados':
        return 'Itens Solicitados'
      case 'solicitacoes_por_etapa':
        return 'Solicitações por Etapa'
      case 'cargas':
        return 'Status das Cargas'
      case 'follow_itenscontratos_itens':
        return 'follow_itenscontratos — Follow-up de itens'
      case 'follow_itenscontratos_medicoes':
        return 'follow_itenscontratos — Medições de contratos'
      case 'follow_itenscontratos_historico':
        return 'follow_itenscontratos — Histórico de cargas'
      default:
        return 'Mega ERP'
    }
  }, [activeTab, saldoSubTab])

  // Carregar lista de obras
  const loadObras = useCallback(async () => {
    try {
      const res = await fetch('/api/mega/obras')
      const data = await res.json()
      if (data.ok && Array.isArray(data.obras)) {
        setObras(data.obras)
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

  // Buscar registros completos para relatórios (até 5.000)
  const fetchFilteredRecords = async (limit: number = 5000): Promise<any[]> => {
    try {
      const params = new URLSearchParams({
        table: currentTableKey,
        page: '0',
        limit: String(limit),
      })
      if (selectedObra) params.append('obra', selectedObra)
      if (search.trim()) params.append('search', search.trim())

      const res = await fetch(`/api/mega/data?${params.toString()}`)
      const data = await res.json()
      return data.ok && Array.isArray(data.records) ? data.records : records
    } catch (err) {
      console.error('Erro ao buscar registros para relatório:', err)
      return records
    }
  }

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

  // Renderizadores de status/badge
  const renderBadge = (situacao: string | null | undefined) => {
    if (!situacao) return <span className="mega-badge neutral">-</span>
    const s = String(situacao).toUpperCase()
    if (s.includes('ATENDIDO') || s.includes('APROVADO') || s.includes('CONCLU') || s.includes('OK') || s === 'ATIVO') {
      return <span className="mega-badge success">{situacao}</span>
    }
    if (s.includes('CANCEL') || s.includes('REPROV') || s.includes('BLOQ') || s === 'INATIVO') {
      return <span className="mega-badge danger">{situacao}</span>
    }
    if (s.includes('EM APROV') || s.includes('PEND') || s.includes('ANDAMENTO')) {
      return <span className="mega-badge warning">{situacao}</span>
    }
    return <span className="mega-badge info">{situacao}</span>
  }

  // Renderizador dinâmico de células
  const renderCell = (record: any, col: MegaColumnDef) => {
    const val = getRecordValue(record, col)

    if (col.type === 'badge') {
      return renderBadge(val)
    }
    if (col.type === 'date') {
      return formatDate(val)
    }
    if (col.type === 'currency') {
      return <strong>{formatCurrency(val)}</strong>
    }
    if (col.type === 'number') {
      return formatNumber(val)
    }
    if (col.id === 'obra') {
      return (
        <span>
          <strong>{val}</strong>{' '}
          {record.obra_nome ? <small>{record.obra_nome}</small> : null}
        </span>
      )
    }
    if (col.id === 'numero_insumo' || col.id === 'cod_insumo' || col.id === 'cod_item_compra') {
      return <span className="mega-code-badge insumo">{val || '-'}</span>
    }
    if (col.id === 'descricao_insumo' || col.id === 'desc_item_compra') {
      return <span className="mega-insumo-text">{val || '-'}</span>
    }
    if (col.type === 'code') {
      return <strong>{val !== null && val !== undefined ? String(val) : '-'}</strong>
    }

    if (Array.isArray(val)) {
      return val.length > 0 ? val.join(', ') : '-'
    }

    return val !== null && val !== undefined && val !== '' ? String(val) : '-'
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
          <div className="mega-summary-icon">
            <Layers size={20} />
          </div>
          <div>
            <h4>Por Etapa</h4>
            <p>{integerFormatter.format(summary?.totalSolicitacoesEtapa ?? 0)}</p>
            <small>Solicitações com etapa</small>
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

        <div className="mega-summary-card">
          <div className="mega-summary-icon">
            <FileText size={20} />
          </div>
          <div>
            <h4>Follow-up de Itens</h4>
            <p>{integerFormatter.format(summary?.totalFollowItensContratos ?? 0)}</p>
            <small>Itens de contratos de empreiteiros</small>
          </div>
        </div>

        <div className="mega-summary-card">
          <div className="mega-summary-icon">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <h4>Medições de Contratos</h4>
            <p>{integerFormatter.format(summary?.totalMedicoesContratos ?? 0)}</p>
            <small>Espelho de medições</small>
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
            className={`mega-tab-btn ${activeTab === 'follow_itenscontratos_itens' ? 'active' : ''}`}
            onClick={() => handleTabChange('follow_itenscontratos_itens')}
          >
            <FileText size={15} />
            <span>Follow-up de Itens</span>
            {summary && <span className="mega-tab-badge">{integerFormatter.format(summary.totalFollowItensContratos ?? 0)}</span>}
          </button>

          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'follow_itenscontratos_medicoes' ? 'active' : ''}`}
            onClick={() => handleTabChange('follow_itenscontratos_medicoes')}
          >
            <CheckCircle2 size={15} />
            <span>Medições de Contratos</span>
            {summary && <span className="mega-tab-badge">{integerFormatter.format(summary.totalMedicoesContratos ?? 0)}</span>}
          </button>

          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'follow_itenscontratos_historico' ? 'active' : ''}`}
            onClick={() => handleTabChange('follow_itenscontratos_historico')}
          >
            <History size={15} />
            <span>Histórico follow_itenscontratos</span>
          </button>

          <button
            type="button"
            className={`mega-tab-btn ${activeTab === 'solicitacoes_por_etapa' ? 'active' : ''}`}
            onClick={() => handleTabChange('solicitacoes_por_etapa')}
          >
            <Layers size={15} />
            <span>Solicitações por Etapa</span>
            {summary && summary.totalSolicitacoesEtapa !== undefined && summary.totalSolicitacoesEtapa > 0 && (
              <span className="mega-tab-badge">{integerFormatter.format(summary.totalSolicitacoesEtapa)}</span>
            )}
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
          {activeTab !== 'cargas' && activeTab !== 'follow_itenscontratos_historico' && (
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
              placeholder="Buscar por insumo, fornecedor, pedido, etapa..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
            />
          </div>
        </div>

        <div className="mega-toolbar-right">
          {/* Seletor de Visões Salvas */}
          <MegaSavedViewsMenu
            allViews={allViews}
            activeViewId={activeViewId}
            onSelectView={handleSelectView}
            onDeleteView={handleDeleteCustomView}
            onOpenSaveModal={() => setIsSaveViewModalOpen(true)}
          />

          {/* Botão Configurar Colunas */}
          <button
            type="button"
            className="mega-btn"
            onClick={() => setIsColumnModalOpen(true)}
            title="Escolher quais colunas mostrar ou ocultar na tabela"
          >
            <SlidersHorizontal size={14} className="text-primary" />
            <span>Colunas ({activeColumns.length}/{allColumns.length})</span>
          </button>

          {/* Botão Salvar Visão */}
          <button
            type="button"
            className="mega-btn"
            onClick={() => setIsSaveViewModalOpen(true)}
            title="Salvar a seleção atual de colunas"
          >
            <BookmarkPlus size={14} />
            <span>Salvar visão</span>
          </button>

          {/* Botão Gerar Relatório */}
          <button
            type="button"
            className="mega-btn"
            onClick={() => setIsReportModalOpen(true)}
            disabled={records.length === 0}
            title="Gerar e exportar relatório (Excel, PDF/Impressão ou CSV)"
          >
            <FileText size={14} className="text-primary" />
            <span>Gerar relatório</span>
          </button>

          {/* Botão Atualizar */}
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
        </div>
      </div>

      {/* 4. Tabela de Registros Dinâmica */}
      <div className="mega-table-container">
        <div className="mega-table-scroll">
          <table className="mega-table">
            <thead>
              <tr>
                {activeColumnDefs.map((col) => (
                  <th
                    key={col.id}
                    className={col.align === 'right' ? 'num-cell' : ''}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={Math.max(1, activeColumnDefs.length)} className="text-center">
                    <div className="mega-loading-state">
                      <RefreshCw size={24} className="mega-loading-spinner" />
                      <span>Carregando registros do Mega ERP...</span>
                    </div>
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(1, activeColumnDefs.length)} className="text-center">
                    <div className="mega-empty-state">
                      <AlertCircle size={28} />
                      <span>Nenhum registro encontrado para os filtros selecionados.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((record, index) => {
                  const key =
                    record.id ||
                    record.numero_do_pedido ||
                    record.solicitacao ||
                    record.codigo_solicitacao ||
                    index
                  return (
                    <tr key={key}>
                      {activeColumnDefs.map((col) => (
                        <td
                          key={col.id}
                          className={col.align === 'right' ? 'num-cell' : ''}
                        >
                          {renderCell(record, col)}
                        </td>
                      ))}
                    </tr>
                  )
                })
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

      {/* Modais de Configuração, Salvar Visão e Geração de Relatórios */}
      <MegaColumnModal
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        allColumns={allColumns}
        activeColumnIds={activeColumns}
        onApplyColumns={handleApplyColumns}
        onOpenSaveView={() => setIsSaveViewModalOpen(true)}
      />

      <MegaSaveViewModal
        isOpen={isSaveViewModalOpen}
        onClose={() => setIsSaveViewModalOpen(false)}
        tableKey={currentTableKey}
        activeColumns={activeColumns}
        allColumns={allColumns}
        activeView={allViews.find((v) => v.id === activeViewId) || null}
        onSaveView={handleSaveCustomView}
      />

      <MegaReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        tableTitle={tableTitle}
        tableKey={currentTableKey}
        selectedObra={selectedObra}
        obraNome={obras.find((o) => o.obra === selectedObra)?.obra_nome}
        search={search}
        activeColumns={activeColumns}
        allColumns={allColumns}
        currentRecords={records}
        totalRecords={totalRecords}
        fetchFilteredRecords={fetchFilteredRecords}
      />

      {/* Notificação Toast */}
      {toastMessage && (
        <div className="mega-toast">
          <CheckCircle2 size={16} className="text-emerald" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  )
}
