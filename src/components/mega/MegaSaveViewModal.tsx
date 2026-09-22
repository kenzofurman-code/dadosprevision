import { useState, useEffect } from 'react'
import { X, BookmarkPlus, Check, Eye } from 'lucide-react'
import type {
  MegaColumnDef,
  SavedView,
} from './mega-columns'

interface MegaSaveViewModalProps {
  isOpen: boolean
  onClose: () => void
  tableKey: string
  activeColumns: string[]
  allColumns: MegaColumnDef[]
  activeView: SavedView | null
  onSaveView: (name: string, isUpdate: boolean) => void
}

export function MegaSaveViewModal({
  isOpen,
  onClose,
  activeColumns,
  allColumns,
  activeView,
  onSaveView,
}: MegaSaveViewModalProps) {
  const [viewName, setViewName] = useState('')
  const [isUpdateMode, setIsUpdateMode] = useState(false)

  const isCurrentCustom = activeView && !activeView.isDefaultPreset

  useEffect(() => {
    if (isOpen) {
      if (isCurrentCustom && activeView) {
        setViewName(activeView.name)
        setIsUpdateMode(true)
      } else {
        setViewName('')
        setIsUpdateMode(false)
      }
    }
  }, [isOpen, isCurrentCustom, activeView])

  if (!isOpen) return null

  const visibleColumnDefs = allColumns.filter((c) => activeColumns.includes(c.id))

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!viewName.trim()) return
    onSaveView(viewName.trim(), isUpdateMode)
    onClose()
  }

  return (
    <div className="mega-modal-overlay" onClick={onClose}>
      <div className="mega-modal-container compact" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mega-modal-header">
          <div className="mega-modal-title">
            <BookmarkPlus size={18} className="text-primary" />
            <div>
              <h3>Salvar Visão da Tabela</h3>
              <p>Guarde a seleção de colunas para carregar rapidamente depois</p>
            </div>
          </div>
          <button type="button" className="mega-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="mega-save-view-body">
            {/* Opção de Atualizar ou Criar Nova */}
            {isCurrentCustom && activeView && (
              <div className="mega-save-view-toggle">
                <button
                  type="button"
                  className={`mega-subnav-btn ${isUpdateMode ? 'active' : ''}`}
                  onClick={() => {
                    setIsUpdateMode(true)
                    setViewName(activeView.name)
                  }}
                >
                  Atualizar "{activeView.name}"
                </button>
                <button
                  type="button"
                  className={`mega-subnav-btn ${!isUpdateMode ? 'active' : ''}`}
                  onClick={() => {
                    setIsUpdateMode(false)
                    setViewName('')
                  }}
                >
                  Criar como nova visão
                </button>
              </div>
            )}

            <div className="mega-form-group">
              <label htmlFor="viewNameInput">Nome da Visão</label>
              <input
                id="viewNameInput"
                type="text"
                className="mega-text-input"
                placeholder="Ex: Análise Completa com Insumos, Visão Orçamento..."
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                autoFocus
                required
              />
            </div>

            {/* Resumo das Colunas que serão salvas */}
            <div className="mega-save-view-summary">
              <div className="mega-save-view-summary-header">
                <Eye size={14} />
                <span>
                  {visibleColumnDefs.length} colunas salvas nesta visão:
                </span>
              </div>
              <div className="mega-save-view-tags">
                {visibleColumnDefs.map((col) => (
                  <span
                    key={col.id}
                    className={`mega-column-tag ${col.category === 'insumos' ? 'insumo' : ''}`}
                  >
                    {col.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mega-modal-footer">
            <button type="button" className="mega-btn" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="mega-btn primary"
              disabled={!viewName.trim()}
            >
              <Check size={14} />
              <span>{isUpdateMode ? 'Atualizar Visão' : 'Salvar Visão'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
