import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle, Building2, Camera, ChevronLeft, ChevronRight, ClipboardList, ListChecks,
  RefreshCw, Search, Server, SlidersHorizontal, Users, Wrench,
} from 'lucide-react'
import './MegaView.css'
import './components/diario/Diario.css'
import { MegaColumnModal } from './components/mega/MegaColumnModal'
import type { MegaColumnDef } from './components/mega/mega-columns'
import { diarioApi, type ObraDiario, type ResumoDiario, type TabelaDiario } from './components/diario/diario-api'
import { COLUNAS_DIARIO } from './components/diario/diario-columns'
import { DiarioRelatorioModal } from './components/diario/DiarioRelatorioModal'
import { fmtData, fmtInteiro, fmtNumero } from './components/diario/formatos'

type Registro = Record<string, unknown>

const ABAS: { chave: TabelaDiario; rotulo: string; icone: LucideIcon; contador?: keyof Omit<ResumoDiario, 'ultimaCarga'> }[] = [
  { chave: 'relatorios', rotulo: 'Relatórios', icone: ClipboardList, contador: 'relatorios' },
  { chave: 'atividades', rotulo: 'Atividades', icone: ListChecks, contador: 'atividades' },
  { chave: 'mao_obra', rotulo: 'Mão de obra', icone: Users, contador: 'maoObra' },
  { chave: 'equipamentos', rotulo: 'Equipamentos', icone: Wrench, contador: 'equipamentos' },
  { chave: 'ocorrencias', rotulo: 'Ocorrências', icone: AlertCircle, contador: 'ocorrencias' },
  { chave: 'fotos', rotulo: 'Fotos', icone: Camera, contador: 'fotos' },
  { chave: 'cargas', rotulo: 'Status das cargas', icone: Server },
]

const chaveColunas = (t: TabelaDiario) => `dadosprevision_diario_colunas_${t}`

function lerColunas(tabela: TabelaDiario, todas: MegaColumnDef[]): string[] {
  try {
    const salvas = JSON.parse(localStorage.getItem(chaveColunas(tabela)) || 'null')
    if (Array.isArray(salvas)) {
      const validas = salvas.filter((id) => todas.some((c) => c.id === id))
      if (validas.length) return validas
    }
  } catch {
    // sem localStorage ou JSON inválido: usa o padrão
  }
  return todas.filter((c) => c.defaultVisible).map((c) => c.id)
}

function renderBadge(valor: unknown) {
  if (!valor) return <span className="mega-badge neutral">-</span>
  const s = String(valor).toUpperCase()
  const classe =
    s.includes('APROV') || s === 'OK' || s.includes('CONCLU') ? 'success'
      : s.includes('ERRO') || s.includes('PARALIS') ? 'danger'
        : s.includes('PREENCH') || s.includes('REVIS') || s.includes('PARCIAL') || s.includes('EXECUT') || s.includes('ANDAMENTO') ? 'warning'
          : 'info'
  return <span className={`mega-badge ${classe}`}>{String(valor)}</span>
}

function renderCelula(registro: Registro, col: MegaColumnDef) {
  const v = registro[col.id]
  if (col.id === 'url_miniatura') {
    return v ? (
      <a href={String(registro.url)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <img className="dd-miniatura" src={String(v)} alt="" loading="lazy" />
      </a>
    ) : '-'
  }
  if (typeof v === 'boolean') return v ? 'Sim' : '-'
  if (col.type === 'badge') return renderBadge(v)
  if (col.type === 'date') return fmtData(v)
  if (col.type === 'number') return fmtNumero(v)
  return v === null || v === undefined || v === '' ? '-' : String(v)
}

export function DiarioView() {
  const [aba, setAba] = useState<TabelaDiario>('relatorios')
  const [obras, setObras] = useState<ObraDiario[]>([])
  const [obra, setObra] = useState('')
  const [resumo, setResumo] = useState<ResumoDiario | null>(null)
  const [registros, setRegistros] = useState<Registro[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(50)
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [colunasAbertas, setColunasAbertas] = useState(false)
  const [colunasAtivas, setColunasAtivas] = useState<string[]>([])
  const [relatorioAberto, setRelatorioAberto] = useState<string | null>(null)

  const todasColunas = COLUNAS_DIARIO[aba]
  const definicoes = useMemo(
    () => colunasAtivas.map((id) => todasColunas.find((c) => c.id === id)).filter((c): c is MegaColumnDef => Boolean(c)),
    [colunasAtivas, todasColunas],
  )

  useEffect(() => {
    diarioApi.obras().then(setObras).catch((e: Error) => setErro(e.message))
  }, [recarga])

  useEffect(() => {
    let vivo = true
    diarioApi.resumo(obra)
      .then((r) => { if (vivo) setResumo(r) })
      .catch(() => { if (vivo) setResumo(null) })
    return () => { vivo = false }
  }, [obra, recarga])

  useEffect(() => {
    const t = setTimeout(() => { setBuscaAplicada(busca.trim()); setPagina(0) }, 300)
    return () => clearTimeout(t)
  }, [busca])

  useEffect(() => {
    setColunasAtivas(lerColunas(aba, COLUNAS_DIARIO[aba]))
  }, [aba])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    diarioApi.dados(aba, { obra, page: pagina, limit: porPagina, search: buscaAplicada })
      .then((r) => { if (vivo) { setRegistros(r.records); setTotal(r.total) } })
      .catch((e: Error) => { if (vivo) { setRegistros([]); setTotal(0); setErro(e.message) } })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [aba, obra, pagina, porPagina, buscaAplicada, recarga])

  function trocarAba(nova: TabelaDiario) {
    setAba(nova)
    setPagina(0)
    setBusca('')
    setBuscaAplicada('')
  }

  function aplicarColunas(ids: string[]) {
    setColunasAtivas(ids)
    try { localStorage.setItem(chaveColunas(aba), JSON.stringify(ids)) } catch { /* sem localStorage */ }
  }

  const totalPaginas = Math.ceil(total / porPagina)
  const carga = resumo?.ultimaCarga

  return (
    <div className="mega-view-container">
      <p className="dd-info-carga">
        {carga
          ? `Última carga: ${fmtData(carga.finalizada_em ?? carga.iniciada_em)} — ${carga.status} (${fmtInteiro(carga.novos)} novos, ${fmtInteiro(carga.alterados)} alterados, ${fmtInteiro(carga.removidos)} removidos)`
          : 'Nenhuma carga do Diário de Obra registrada ainda.'}
      </p>

      <div className="mega-navigation-bar">
        <div className="mega-tabs">
          {ABAS.map((a) => (
            <button key={a.chave} type="button" className={`mega-tab-btn ${aba === a.chave ? 'active' : ''}`} onClick={() => trocarAba(a.chave)}>
              <a.icone size={15} />
              <span>{a.rotulo}</span>
              {a.contador && resumo && <span className="mega-tab-badge">{fmtInteiro(resumo[a.contador])}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mega-toolbar">
        <div className="mega-toolbar-left">
          {aba !== 'cargas' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building2 size={16} style={{ color: 'var(--text-muted)' }} />
              <select className="mega-filter-select" value={obra} onChange={(e) => { setObra(e.target.value); setPagina(0) }}>
                <option value="">Todas as obras ({obras.length})</option>
                {obras.map((o) => <option key={o.obra_id} value={o.obra_id}>{o.nome}</option>)}
              </select>
            </div>
          )}
          <div className="mega-search-box">
            <Search size={14} style={{ color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar nesta tabela..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        <div className="mega-toolbar-right">
          <button type="button" className="mega-btn" onClick={() => setColunasAbertas(true)} title="Escolher quais colunas mostrar ou ocultar">
            <SlidersHorizontal size={14} className="text-primary" />
            <span>Colunas ({colunasAtivas.length}/{todasColunas.length})</span>
          </button>
          <button type="button" className="mega-btn" onClick={() => setRecarga((n) => n + 1)} title="Atualizar dados">
            <RefreshCw size={14} className={carregando ? 'mega-loading-spinner' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      <div className="mega-table-container">
        <div className="mega-table-scroll">
          <table className="mega-table">
            <thead>
              <tr>{definicoes.map((c) => <th key={c.id} className={c.align === 'right' ? 'num-cell' : ''}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={Math.max(1, definicoes.length)} className="text-center">
                  <div className="mega-loading-state"><RefreshCw size={24} className="mega-loading-spinner" /><span>Carregando registros do Diário de Obra...</span></div>
                </td></tr>
              ) : erro ? (
                <tr><td colSpan={Math.max(1, definicoes.length)} className="text-center">
                  <div className="mega-empty-state"><AlertCircle size={28} /><span>{erro}</span></div>
                </td></tr>
              ) : registros.length === 0 ? (
                <tr><td colSpan={Math.max(1, definicoes.length)} className="text-center">
                  <div className="mega-empty-state"><AlertCircle size={28} /><span>Nenhum registro encontrado para os filtros selecionados.</span></div>
                </td></tr>
              ) : (
                registros.map((registro, i) => {
                  const relId = registro.relatorio_id ? String(registro.relatorio_id) : null
                  return (
                    <tr
                      key={String(registro.id ?? registro.relatorio_id ?? i)}
                      className={relId ? 'dd-linha-clicavel' : undefined}
                      onClick={relId ? () => setRelatorioAberto(relId) : undefined}
                      title={relId ? 'Abrir o diário completo' : undefined}
                    >
                      {definicoes.map((c) => <td key={c.id} className={c.align === 'right' ? 'num-cell' : ''}>{renderCelula(registro, c)}</td>)}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mega-pagination">
          <div>
            Mostrando {total === 0 ? 0 : pagina * porPagina + 1} a {Math.min((pagina + 1) * porPagina, total)} de <strong>{fmtInteiro(total)}</strong> registros
          </div>
          <div className="mega-pagination-controls">
            <select className="mega-filter-select" value={porPagina} onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(0) }} style={{ padding: '4px 8px', fontSize: '11px' }}>
              <option value={25}>25 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>
            <button type="button" className="mega-page-btn" disabled={pagina === 0 || carregando} onClick={() => setPagina((p) => Math.max(0, p - 1))} title="Página anterior"><ChevronLeft size={16} /></button>
            <span>Página {pagina + 1} de {totalPaginas || 1}</span>
            <button type="button" className="mega-page-btn" disabled={pagina >= totalPaginas - 1 || carregando} onClick={() => setPagina((p) => p + 1)} title="Próxima página"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <MegaColumnModal
        isOpen={colunasAbertas}
        onClose={() => setColunasAbertas(false)}
        allColumns={todasColunas}
        activeColumnIds={colunasAtivas}
        onApplyColumns={aplicarColunas}
      />
      <DiarioRelatorioModal relatorioId={relatorioAberto} onClose={() => setRelatorioAberto(null)} />
    </div>
  )
}
