import { useState, useRef, useEffect } from 'react'
import {
  Bookmark,
  Check,
  Trash2,
  BookmarkPlus,
  ChevronDown,
  Sparkles,
} from 'lucide-react'
import type { SavedView } from './mega-columns'

interface MegaSavedViewsMenuProps {
  allViews: SavedView[]
  activeViewId: string | null
  onSelectView: (view: SavedView) => void
  onDeleteView: (viewId: string) => void
  onOpenSaveModal: () => void
}

export function MegaSavedViewsMenu({
  allViews,
  activeViewId,
  onSelectView,
  onDeleteView,
  onOpenSaveModal,
}: MegaSavedViewsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeView = allViews.find((v) => v.id === activeViewId) || allViews[0]

  const presets = allViews.filter((v) => v.isDefaultPreset)
  const customViews = allViews.filter((v) => !v.isDefaultPreset)

  // Fecha o menu ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="mega-dropdown-wrapper" ref={menuRef}>
      <button
        type="button"
        className={`mega-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Escolher ou gerenciar visões salvas da tabela"
      >
        <Bookmark size={14} className="text-primary" />
        <span>Visões: <strong>{activeView?.name || 'Padrão'}</strong></span>
        <ChevronDown size={13} style={{ opacity: 0.7 }} />
      </button>

      {isOpen && (
        <div className="mega-dropdown-menu">
          <div className="mega-dropdown-header">
            <span>Visões da Tabela</span>
            <small>Alterne entre configurações de colunas</small>
          </div>

          {/* Seção 1: Predefinições do Sistema */}
          <div className="mega-dropdown-section">
            <div className="mega-dropdown-section-title">Predefinições do Sistema</div>
            {presets.map((view) => {
              const isActive = view.id === activeViewId
              const isInsumo = view.id === 'preset_insumos'
              return (
                <button
                  key={view.id}
                  type="button"
                  className={`mega-dropdown-item ${isActive ? 'active' : ''} ${isInsumo ? 'featured' : ''}`}
                  onClick={() => {
                    onSelectView(view)
                    setIsOpen(false)
                  }}
                >
                  <div className="mega-dropdown-item-left">
                    {isInsumo ? (
                      <Sparkles size={14} className="text-emerald" />
                    ) : (
                      <Bookmark size={14} style={{ opacity: 0.5 }} />
                    )}
                    <span>{view.name}</span>
                    <span className="mega-dropdown-col-count">
                      ({view.columns.length} colunas)
                    </span>
                  </div>
                  {isActive && <Check size={14} className="text-primary" />}
                </button>
              )
            })}
          </div>

          {/* Seção 2: Minhas Visões Personalizadas */}
          <div className="mega-dropdown-section">
            <div className="mega-dropdown-section-title">Minhas Visões Salvas</div>
            {customViews.length === 0 ? (
              <div className="mega-dropdown-empty">
                Nenhuma visão personalizada salva para esta tabela ainda.
              </div>
            ) : (
              customViews.map((view) => {
                const isActive = view.id === activeViewId
                return (
                  <div
                    key={view.id}
                    className={`mega-dropdown-item custom ${isActive ? 'active' : ''}`}
                  >
                    <button
                      type="button"
                      className="mega-dropdown-item-btn"
                      onClick={() => {
                        onSelectView(view)
                        setIsOpen(false)
                      }}
                    >
                      <Bookmark size={14} className="text-primary" />
                      <span className="mega-dropdown-name">{view.name}</span>
                      <span className="mega-dropdown-col-count">
                        ({view.columns.length} colunas)
                      </span>
                    </button>

                    <div className="mega-dropdown-actions">
                      {isActive && <Check size={14} className="text-primary" />}
                      <button
                        type="button"
                        className="mega-dropdown-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm(`Deseja realmente excluir a visão "${view.name}"?`)) {
                            onDeleteView(view.id)
                          }
                        }}
                        title="Excluir visão"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Ação rápida para salvar visão atual */}
          <div className="mega-dropdown-footer">
            <button
              type="button"
              className="mega-dropdown-footer-btn"
              onClick={() => {
                setIsOpen(false)
                onOpenSaveModal()
              }}
            >
              <BookmarkPlus size={14} />
              <span>Salvar seleção atual como nova visão...</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
