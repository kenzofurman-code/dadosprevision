import { useState, useMemo } from 'react'
import {
  X,
  Search,
  CheckSquare,
  Square,
  RotateCcw,
  SlidersHorizontal,
  Check,
  BookmarkPlus,
} from 'lucide-react'
import type {
  MegaColumnDef,
  ColumnCategory,
} from './mega-columns'

interface MegaColumnModalProps {
  isOpen: boolean
  onClose: () => void
  allColumns: MegaColumnDef[]
  activeColumnIds: string[]
  onApplyColumns: (columns: string[]) => void
  onOpenSaveView?: () => void
}

const CATEGORY_LABELS: Record<ColumnCategory, string> = {
  identificacao: 'Identificação',
  insumos: 'Insumos',
  itens: 'Itens & Materiais',
  valores: 'Valores & Quantidades',
  datas: 'Datas',
  status: 'Status & Situação',
  outros: 'Outros',
}

export function MegaColumnModal({
  isOpen,
  onClose,
  allColumns,
  activeColumnIds,
  onApplyColumns,
  onOpenSaveView,
}: MegaColumnModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>(activeColumnIds)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Sincroniza se o modal abrir com novos activeColumnIds
  useMemo(() => {
    if (isOpen) {
      setSelectedIds(activeColumnIds)
      setSearch('')
      setCategoryFilter('all')
    }
  }, [isOpen, activeColumnIds])

  // Filtragem de colunas
  const filteredColumns = useMemo(() => {
    return allColumns.filter((col) => {
      const matchSearch =
        search.trim() === '' ||
        col.label.toLowerCase().includes(search.toLowerCase()) ||
        col.id.toLowerCase().includes(search.toLowerCase()) ||
        (col.description && col.description.toLowerCase().includes(search.toLowerCase()))

      const matchCategory =
        categoryFilter === 'all' || col.category === categoryFilter

      return matchSearch && matchCategory
    })
  }, [allColumns, search, categoryFilter])

  // Categorias disponíveis nesta tabela
  const availableCategories = useMemo(() => {
    const cats = new Set<ColumnCategory>()
    allColumns.forEach((c) => cats.add(c.category))
    return Array.from(cats)
  }, [allColumns])

  if (!isOpen) return null

  const handleToggle = (id: string) => {
    if (selectedIds.includes(id)) {
      // Não deixa desmarcar a última coluna
      if (selectedIds.length <= 1) return
      setSelectedIds(selectedIds.filter((c) => c !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  const handleSelectAll = () => {
    setSelectedIds(allColumns.map((c) => c.id))
  }

  const handleDeselectAll = () => {
    // Mantém pelo menos a primeira coluna
    setSelectedIds([allColumns[0]?.id || ''])
  }

  const handleRestoreDefault = () => {
    const defaultCols = allColumns.filter((c) => c.defaultVisible).map((c) => c.id)
    setSelectedIds(defaultCols.length > 0 ? defaultCols : allColumns.slice(0, 8).map((c) => c.id))
  }

  const handleApply = () => {
    onApplyColumns(selectedIds)
    onClose()
  }

  return (
    <div className="mega-modal-overlay" onClick={onClose}>
      <div className="mega-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mega-modal-header">
          <div className="mega-modal-title">
            <SlidersHorizontal size={18} className="text-primary" />
            <div>
              <h3>Configurar Colunas da Tabela</h3>
              <p>
                {selectedIds.length} de {allColumns.length} colunas visíveis
              </p>
            </div>
          </div>
          <button type="button" className="mega-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Toolbar de Busca e Ações Rápidas */}
        <div className="mega-modal-toolbar">
          <div className="mega-modal-search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Buscar coluna (ex: insumo, pedido, total)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search && (
              <button
                type="button"
                className="mega-modal-clear-search"
                onClick={() => setSearch('')}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="mega-modal-quick-actions">
            <button
              type="button"
              className="mega-btn-ghost"
              onClick={handleSelectAll}
              title="Marcar todas as colunas"
            >
              <CheckSquare size={13} />
              <span>Marcar todas</span>
            </button>
            <button
              type="button"
              className="mega-btn-ghost"
              onClick={handleDeselectAll}
              title="Desmarcar todas"
            >
              <Square size={13} />
              <span>Desmarcar</span>
            </button>
            <button
              type="button"
              className="mega-btn-ghost"
              onClick={handleRestoreDefault}
              title="Restaurar padrão inicial"
            >
              <RotateCcw size={13} />
              <span>Padrão</span>
            </button>
          </div>
        </div>

        {/* Filtros de Categoria */}
        {availableCategories.length > 1 && (
          <div className="mega-modal-categories">
            <button
              type="button"
              className={`mega-category-pill ${categoryFilter === 'all' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('all')}
            >
              Todas ({allColumns.length})
            </button>
            {availableCategories.map((cat) => {
              const count = allColumns.filter((c) => c.category === cat).length
              return (
                <button
                  key={cat}
                  type="button"
                  className={`mega-category-pill ${categoryFilter === cat ? 'active' : ''} ${cat === 'insumos' ? 'highlight-insumos' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat === 'insumos' ? '★ ' : ''}
                  {CATEGORY_LABELS[cat] || cat} ({count})
                </button>
              )
            })}
          </div>
        )}

        {/* Lista de Colunas com Checkboxes */}
        <div className="mega-modal-columns-list">
          {filteredColumns.length === 0 ? (
            <div className="mega-modal-empty">
              Nenhuma coluna encontrada para "{search}".
            </div>
          ) : (
            filteredColumns.map((col) => {
              const isChecked = selectedIds.includes(col.id)
              return (
                <label
                  key={col.id}
                  className={`mega-column-item ${isChecked ? 'selected' : ''} ${col.category === 'insumos' ? 'insumo-item' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggle(col.id)}
                  />
                  <div className="mega-column-item-info">
                    <div className="mega-column-item-header">
                      <span className="mega-column-item-label">{col.label}</span>
                      {col.category === 'insumos' && (
                        <span className="mega-column-badge insumo">Insumo</span>
                      )}
                      {col.isRawData && (
                        <span className="mega-column-badge raw">Excel</span>
                      )}
                    </div>
                    {col.description && (
                      <span className="mega-column-item-desc">{col.description}</span>
                    )}
                  </div>
                </label>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="mega-modal-footer">
          <div className="mega-modal-footer-left">
            {onOpenSaveView && (
              <button
                type="button"
                className="mega-btn secondary"
                onClick={() => {
                  onApplyColumns(selectedIds)
                  onClose()
                  onOpenSaveView()
                }}
                title="Salvar esta seleção como uma visão customizada"
              >
                <BookmarkPlus size={14} />
                <span>Salvar visão atual...</span>
              </button>
            )}
          </div>

          <div className="mega-modal-footer-right">
            <button type="button" className="mega-btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="mega-btn primary"
              onClick={handleApply}
            >
              <Check size={14} />
              <span>Aplicar ({selectedIds.length} colunas)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
