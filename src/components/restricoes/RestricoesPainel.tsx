import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  LayoutGrid,
  List,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react'
import {
  FAIXAS,
  carregarRestricoes,
  dataRestricao,
  formatarPrazo,
  hojeRestricoes,
  prepararRestricoes,
} from '../../lib/restricoes'
import type { CSSProperties } from 'react'
import type { Prazo, RestrictionCard, RestrictionRecord } from '../../lib/restricoes'
import './RestricoesPainel.css'

type Recorte = Prazo | 'todas' | 'atrasadas' | 'semResponsavel' | 'concluidas' | 'semana'
type Selection = { obra: string; faixa: Recorte }
const date = (value: string | null) =>
  value ? value.split('-').reverse().join('/') : 'Não informado'
const searchText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
const isLate = (c: RestrictionCard) => !c.concluida && c.dias !== null && c.dias < 0
const tone = (c: RestrictionCard) =>
  c.concluida
    ? 'success'
    : isLate(c)
      ? 'danger'
      : c.dias !== null && c.dias <= 7
        ? 'warning'
        : c.dias === null
          ? 'neutral'
          : 'info'
const cutLabel = (cut: Recorte) =>
  ({
    todas: 'Todas as abertas',
    atrasadas: 'Atrasadas',
    semResponsavel: 'Sem responsável',
    concluidas: 'Concluídas',
    semana: 'Vencem de hoje a 7 dias',
  })[cut as string] ||
  FAIXAS.find((f) => f.id === cut)?.detalhe ||
  ''

function matches(c: RestrictionCard, cut: Recorte) {
  if (cut === 'concluidas') return c.concluida
  if (c.concluida) return false
  if (cut === 'todas') return true
  if (cut === 'atrasadas') return isLate(c)
  if (cut === 'semResponsavel') return c.responsaveis.length === 0
  if (cut === 'semana') return c.dias !== null && c.dias >= 0 && c.dias <= 7
  return c.faixa === cut
}

function downloadCsv(cards: RestrictionCard[]) {
  const cell = (s: unknown) => {
    const text = String(s ?? '')
    return `"${(/^[=+@\-\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`
  }
  const lines = [
    [
      'Projeto',
      'Card',
      'Restrição',
      'Etapa',
      'Responsáveis',
      'Vencimento',
      'Situação',
      'Dias de atraso',
      'Criação',
      'Conclusão',
      'Serviço',
      'Pavimento',
      'Checklist atrasado',
    ],
    ...cards.map((c) => [
      c.projeto,
      c.codigo,
      c.titulo,
      c.etapa,
      c.responsaveis.join(', '),
      date(c.prazo),
      formatarPrazo(c),
      !c.concluida && c.dias !== null ? Math.max(0, -c.dias) : '',
      date(c.criado),
      date(c.conclusao),
      c.servico,
      c.pavimento,
      c.checklistAtrasados,
    ]),
  ]
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', lines.map((r) => r.map(cell).join(';')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `restricoes-prevision-${hojeRestricoes()}.csv`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Props {
  projectId: string
  allowedProjectIds: string[]
  search: string
  paper: boolean
}

export function RestricoesPainel({ projectId, allowedProjectIds, search, paper }: Props) {
  const [records, setRecords] = useState<RestrictionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [consultado, setConsultado] = useState('')
  const [referencia, setReferencia] = useState(hojeRestricoes)
  const [etapa, setEtapa] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [checklistOnly, setChecklistOnly] = useState(false)
  const [selection, setSelection] = useState<Selection>({ obra: '', faixa: 'atrasadas' })
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<'prazo' | 'projeto' | 'titulo'>('prazo')
  const [desc, setDesc] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const detailRef = useRef<HTMLHeadingElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    carregarRestricoes(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        setRecords(rows)
        setConsultado(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Erro ao consultar restrições.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reload])

  const cards = useMemo(() => prepararRestricoes(records, referencia), [records, referencia])
  const projectCards = useMemo(
    () =>
      cards.filter((c) =>
        projectId ? c.projetoId === projectId : allowedProjectIds.includes(c.projetoId),
      ),
    [cards, projectId, allowedProjectIds],
  )
  const etapas = useMemo(
    () => [...new Set(projectCards.map((c) => c.etapa))].sort(),
    [projectCards],
  )
  const responsaveis = useMemo(
    () =>
      [
        ...new Set(
          projectCards.flatMap((c) => [
            ...c.responsaveis,
            ...c.checklist.map((i) => i.responsavel).filter(Boolean),
          ]),
        ),
      ].sort(),
    [projectCards],
  )
  const base = useMemo(() => {
    const query = searchText(search.trim())
    return projectCards.filter(
      (c) =>
        (!etapa || c.etapa === etapa) &&
        (!responsavel ||
          c.responsaveis.includes(responsavel) ||
          c.checklist.some((i) => i.responsavel === responsavel)) &&
        (!checklistOnly || c.checklistAtrasados > 0) &&
        (!query ||
          searchText(
            [
              c.projeto,
              c.codigo,
              c.titulo,
              c.descricao,
              c.etapa,
              c.servico,
              c.pavimento,
              c.eap,
              ...c.responsaveis,
              ...c.etiquetas,
              ...c.checklist.flatMap((i) => [i.descricao, i.responsavel]),
            ].join(' '),
          ).includes(query)),
    )
  }, [projectCards, search, etapa, responsavel, checklistOnly])
  const open = useMemo(() => base.filter((c) => !c.concluida), [base])
  const matrix = useMemo(() => {
    const projects = new Map<
      string,
      { id: string; nome: string; cells: Record<Prazo, number>; total: number; atrasadas: number }
    >()
    for (const c of open) {
      if (!projects.has(c.projetoId))
        projects.set(c.projetoId, {
          id: c.projetoId,
          nome: c.projeto,
          cells: Object.fromEntries(FAIXAS.map((f) => [f.id, 0])) as Record<Prazo, number>,
          total: 0,
          atrasadas: 0,
        })
      const p = projects.get(c.projetoId)!
      p.cells[c.faixa]++
      p.total++
      if (isLate(c)) p.atrasadas++
    }
    return [...projects.values()].sort(
      (a, b) =>
        b.atrasadas - a.atrasadas || b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'),
    )
  }, [open])
  const maxCell = Math.max(1, ...matrix.flatMap((p) => Object.values(p.cells)))
  const filtered = useMemo(
    () =>
      base
        .filter(
          (c) => (!selection.obra || c.projetoId === selection.obra) && matches(c, selection.faixa),
        )
        .sort((a, b) => {
          const left = sort === 'prazo' ? a.prazo || '9999' : a[sort]
          const right = sort === 'prazo' ? b.prazo || '9999' : b[sort]
          // Sem prazo permanece ao final da ordenação por data.
          if (sort === 'prazo' && (!a.prazo || !b.prazo)) return Number(!a.prazo) - Number(!b.prazo)
          return left.localeCompare(right, 'pt-BR', { numeric: true }) * (desc ? -1 : 1)
        }),
    [base, selection, sort, desc],
  )
  const pageSize = view === 'cards' ? 12 : 25
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const detail = filtered.find((c) => c.id === detailId)
  useEffect(() => {
    if (detail) detailRef.current?.focus()
  }, [detail])
  useEffect(() => {
    setPage(0)
    setDetailId(null)
  }, [projectId, search, referencia, etapa, responsavel, checklistOnly, selection, view])
  useEffect(() => {
    setEtapa('')
    setResponsavel('')
    setSelection({ obra: '', faixa: 'atrasadas' })
  }, [projectId])

  function select(obra: string, faixa: Recorte, showCards = false) {
    setSelection({ obra, faixa })
    setDetailId(null)
    setPage(0)
    if (showCards) {
      setView('cards')
      resultsRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      })
    }
  }
  function reset() {
    setEtapa('')
    setResponsavel('')
    setChecklistOnly(false)
    setSelection({ obra: '', faixa: 'atrasadas' })
    setDetailId(null)
    setPage(0)
  }
  function toggleDetails(card: RestrictionCard, trigger: HTMLButtonElement) {
    detailTrigger.current = trigger
    setDetailId(detailId === card.id ? null : card.id)
  }
  function closeDetails() {
    setDetailId(null)
    detailTrigger.current?.focus()
  }
  function sortBy(key: typeof sort) {
    setSort(key)
    setDesc(sort === key ? !desc : false)
    setPage(0)
  }
  const atrasadas = open.filter(isLate).length
  const stats: {
    cut: Recorte
    label: string
    count: number
    note: string
    icon: typeof Clock3
    tom: string
  }[] = [
    {
      cut: 'atrasadas',
      label: 'Atrasadas',
      count: atrasadas,
      note: 'Prazo do card vencido',
      icon: CircleAlert,
      tom: 'danger',
    },
    {
      cut: 'semana',
      label: 'Vencem em até 7 dias',
      count: open.filter((c) => c.dias !== null && c.dias >= 0 && c.dias <= 7).length,
      note: 'Inclui os vencimentos de hoje',
      icon: CalendarDays,
      tom: 'warning',
    },
    {
      cut: 'semData',
      label: 'Sem prazo',
      count: open.filter((c) => c.dias === null).length,
      note: 'Precisam de uma data definida',
      icon: Clock3,
      tom: 'neutral',
    },
    {
      cut: 'semResponsavel',
      label: 'Sem responsável',
      count: open.filter((c) => !c.responsaveis.length).length,
      note: 'Sem responsável no card',
      icon: Users,
      tom: 'neutral',
    },
  ]

  return (
    <div className={`rp gestao-print-source ${paper ? 'rp-paper' : ''}`}>
      <header className="rp-heading">
        <div>
          <h3>
            <ShieldAlert size={22} /> Painel 10: Restrições da Prevision
          </h3>
          <p>O que precisa ser liberado, por quem e até quando.</p>
        </div>
        <div className="rp-heading-meta">
          <strong>
            {projectId
              ? projectCards[0]?.projeto || 'Projeto selecionado'
              : 'Todos os projetos ativos'}
          </strong>
          <span>
            {loading
              ? 'Carregando todos os cards…'
              : error
                ? 'Consulta indisponível'
                : `${open.length} cards abertos · ${matrix.length} projeto(s) no filtro`}
          </span>
        </div>
      </header>
      <div className="rp-toolbar rp-no-print">
        <label>
          <span>Data de referência</span>
          <input
            type="date"
            value={referencia}
            onChange={(e) => {
              if (dataRestricao(e.target.value)) setReferencia(e.target.value)
            }}
          />
        </label>
        <label>
          <span>Etapa do card</span>
          <select value={etapa} onChange={(e) => setEtapa(e.target.value)}>
            <option value="">Todas as etapas</option>
            {etapas.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Responsável</span>
          <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="rp-checkbox">
          <input
            type="checkbox"
            checked={checklistOnly}
            onChange={(e) => setChecklistOnly(e.target.checked)}
          />
          Com checklist atrasado
        </label>
        <button className="rp-button" onClick={reset}>
          <RotateCcw size={14} /> Limpar recortes
        </button>
        <button className="rp-button" disabled={loading} onClick={() => setReload((v) => v + 1)}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Recarregar
        </button>
      </div>
      {loading ? (
        <div className="rp-state" role="status">
          <RefreshCw size={22} className="spin" />
          <strong>Carregando todos os cards de restrição…</strong>
          <span>Os totais serão exibidos após a leitura de todas as páginas.</span>
        </div>
      ) : error ? (
        <div className="rp-state" role="alert">
          <CircleAlert size={24} />
          <strong>{error}</strong>
          <button className="rp-button" onClick={() => setReload((v) => v + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <div className="rp-stats" aria-label="Indicadores de restrições">
            {stats.map(({ cut, label, count, note, icon: Icon, tom }) => (
              <button
                key={cut}
                className={`rp-stat rp-${tom} ${selection.faixa === cut && !selection.obra ? 'is-selected' : ''}`}
                aria-pressed={selection.faixa === cut && !selection.obra}
                onClick={() => select('', cut)}
              >
                <span>
                  <Icon size={16} />
                  {label}
                </span>
                <strong>{count}</strong>
                <small>{note}</small>
              </button>
            ))}
          </div>
          <section className="rp-map" aria-labelledby="rp-map-title">
            <div className="rp-section-heading">
              <div>
                <h4 id="rp-map-title">Mapa de prazos por projeto</h4>
                <p>
                  Clique em uma quantidade para ver os cards. Projetos com mais atrasos aparecem
                  primeiro.
                </p>
              </div>
              <span className="rp-reference">Referência: {date(referencia)}</span>
            </div>
            {matrix.length === 0 ? (
              <div className="rp-empty">Nenhuma restrição aberta para os filtros atuais.</div>
            ) : (
              <div className="rp-map-scroll">
                <table className="rp-matrix">
                  <caption className="rp-sr-only">
                    Quantidade de cards abertos por projeto e faixa de vencimento. Cada quantidade
                    abre os cards correspondentes.
                  </caption>
                  <thead>
                    <tr>
                      <th rowSpan={2} scope="col">
                        Projeto
                      </th>
                      <th colSpan={3} scope="colgroup" className="rp-overdue-header">
                        Prazo vencido · dias de atraso
                      </th>
                      <th colSpan={3} scope="colgroup">
                        A vencer
                      </th>
                      <th rowSpan={2} scope="col">
                        Sem prazo
                      </th>
                      <th rowSpan={2} scope="col">
                        Abertas
                      </th>
                    </tr>
                    <tr>
                      {FAIXAS.filter((f) => f.id !== 'semData').map((f) => (
                        <th key={f.id} scope="col">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">
                          <button
                            className="rp-project-button"
                            onClick={() => select(p.id, 'todas', true)}
                          >
                            {p.nome}
                            <span>{p.atrasadas} atrasadas</span>
                          </button>
                        </th>
                        {FAIXAS.map((f) => {
                          const count = p.cells[f.id]
                          return (
                            <td key={f.id}>
                              <button
                                disabled={!count}
                                aria-label={`${p.nome}: ${count} restrições. ${f.detalhe}`}
                                aria-pressed={selection.obra === p.id && selection.faixa === f.id}
                                className={`rp-heat rp-${f.tom} ${count ? 'has-value' : ''} ${selection.obra === p.id && selection.faixa === f.id ? 'is-selected' : ''}`}
                                style={
                                  {
                                    '--rp-intensity': count ? 0.12 + (0.55 * count) / maxCell : 0,
                                  } as CSSProperties
                                }
                                onClick={() => select(p.id, f.id, true)}
                              >
                                {count || '—'}
                              </button>
                            </td>
                          )
                        })}
                        <td>
                          <button
                            className="rp-total"
                            onClick={() => select(p.id, 'todas', true)}
                            aria-label={`Ver ${p.total} cards abertos de ${p.nome}`}
                          >
                            {p.total}
                            <ArrowUpRight size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="rp-map-legend">
              <span>
                <i className="rp-legend-light" /> Menos cards
              </span>
              <span>
                <i className="rp-legend-dark" /> Mais cards
              </span>
              <small>A intensidade compara as quantidades; a cor indica a faixa de prazo.</small>
            </div>
          </section>
          <section ref={resultsRef} className="rp-results" aria-labelledby="rp-results-title">
            <div className="rp-section-heading">
              <div>
                <h4 id="rp-results-title">
                  {cutLabel(selection.faixa)} <span className="rp-count">{filtered.length}</span>
                </h4>
                <p>
                  {selection.obra
                    ? matrix.find((p) => p.id === selection.obra)?.nome || 'Projeto selecionado'
                    : 'Todos os projetos do filtro'}{' '}
                  ·{' '}
                  {sort === 'prazo'
                    ? desc
                      ? 'Das datas mais recentes para as mais antigas'
                      : 'Das datas mais antigas para as mais recentes'
                    : sort === 'projeto'
                      ? 'Ordenadas por projeto'
                      : 'Ordenadas por título'}
                </p>
              </div>
              <div className="rp-result-actions rp-no-print">
                <select
                  aria-label="Recorte de restrições"
                  value={selection.faixa}
                  onChange={(e) => select(selection.obra, e.target.value as Recorte)}
                >
                  <option value="atrasadas">Atrasadas</option>
                  <option value="todas">Todas as abertas</option>
                  <option value="semana">Vencem de hoje a 7 dias</option>
                  {FAIXAS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.detalhe}
                    </option>
                  ))}
                  <option value="semResponsavel">Sem responsável</option>
                  <option value="concluidas">
                    Concluídas ({base.filter((c) => c.concluida).length})
                  </option>
                </select>
                {selection.obra && (
                  <button
                    className="rp-icon-button"
                    aria-label="Remover recorte de projeto"
                    onClick={() => select('', selection.faixa)}
                  >
                    <X size={16} />
                  </button>
                )}
                <div className="rp-view-switch" aria-label="Forma de exibição">
                  <button
                    className={view === 'table' ? 'is-selected' : ''}
                    aria-label="Exibir tabela"
                    aria-pressed={view === 'table'}
                    onClick={() => setView('table')}
                  >
                    <List size={16} />
                  </button>
                  <button
                    className={view === 'cards' ? 'is-selected' : ''}
                    aria-label="Exibir cards"
                    aria-pressed={view === 'cards'}
                    onClick={() => setView('cards')}
                  >
                    <LayoutGrid size={16} />
                  </button>
                </div>
                <button
                  className="rp-button"
                  disabled={!filtered.length}
                  onClick={() => downloadCsv(filtered)}
                >
                  <Download size={14} /> CSV
                </button>
              </div>
            </div>
            <p className="rp-sr-only" role="status">
              {filtered.length} restrições no recorte. Página {currentPage + 1} de {lastPage + 1}.
            </p>
            <div className="rp-screen-results">
              {filtered.length === 0 ? (
                <div className="rp-empty">
                  <CheckCheck size={25} />
                  <strong>
                    {base.length === 0
                      ? 'Nenhum card encontrado para os filtros atuais.'
                      : 'Nenhuma restrição neste recorte.'}
                  </strong>
                  <span>Experimente outra faixa de prazo ou exiba todas as abertas.</span>
                  <button className="rp-button rp-no-print" onClick={() => select('', 'todas')}>
                    Ver todas as abertas
                  </button>
                </div>
              ) : view === 'table' ? (
                <div className="rp-table-scroll">
                  <table className="rp-table">
                    <thead>
                      <tr>
                        {(['projeto', 'titulo'] as const).map((key) => (
                          <th
                            key={key}
                            scope="col"
                            aria-sort={sort === key ? (desc ? 'descending' : 'ascending') : 'none'}
                          >
                            <button onClick={() => sortBy(key)}>
                              {key === 'projeto' ? 'Projeto' : 'Restrição'}
                              {sort === key &&
                                (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                            </button>
                          </th>
                        ))}
                        <th scope="col">Responsável / Etapa</th>
                        <th
                          scope="col"
                          aria-sort={
                            sort === 'prazo' ? (desc ? 'descending' : 'ascending') : 'none'
                          }
                        >
                          <button onClick={() => sortBy('prazo')}>
                            Vencimento
                            {sort === 'prazo' &&
                              (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                          </button>
                        </th>
                        <th scope="col">Situação</th>
                        <th scope="col">Checklist</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((c) => (
                        <tr key={c.id} className={detailId === c.id ? 'rp-row-selected' : ''}>
                          <td>{c.projeto}</td>
                          <td>
                            <button
                              className="rp-card-link"
                              aria-expanded={detailId === c.id}
                              aria-controls="rp-card-detail"
                              onClick={(event) => toggleDetails(c, event.currentTarget)}
                            >
                              {c.titulo}
                              <ArrowUpRight size={13} />
                            </button>
                            <small>
                              #{c.codigo}
                              {c.servico && ` · ${c.servico}`}
                              {c.pavimento && ` · ${c.pavimento}`}
                            </small>
                          </td>
                          <td>
                            {c.responsaveis.join(', ') || 'Não atribuído'}
                            <small>{c.etapa}</small>
                          </td>
                          <td className="rp-date">{date(c.prazo)}</td>
                          <td>
                            <span className={`rp-badge rp-${tone(c)}`}>{formatarPrazo(c)}</span>
                          </td>
                          <td>
                            <span>
                              {c.checklist.filter((i) => i.concluido).length}/{c.checklist.length}
                            </span>
                            {c.checklistAtrasados > 0 && (
                              <small className="rp-text-danger">
                                {c.checklistAtrasados} atrasado(s)
                              </small>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rp-card-grid">
                  {visible.map((c) => (
                    <button
                      key={c.id}
                      className={`rp-restriction-card ${detailId === c.id ? 'is-selected' : ''}`}
                      aria-expanded={detailId === c.id}
                      aria-controls="rp-card-detail"
                      onClick={(event) => toggleDetails(c, event.currentTarget)}
                    >
                      <span className="rp-card-top">
                        <span>
                          {c.projeto} · #{c.codigo}
                        </span>
                        <ArrowUpRight size={16} />
                      </span>
                      <strong>{c.titulo}</strong>
                      <span className={`rp-badge rp-${tone(c)}`}>{formatarPrazo(c)}</span>
                      <span className="rp-card-date">
                        <CalendarDays size={14} /> Prazo: {date(c.prazo)}
                      </span>
                      <span>
                        <Users size={14} />
                        {c.responsaveis.join(', ') || 'Sem responsável'}
                      </span>
                      <span className="rp-card-footer">
                        {c.etapa}
                        <small>
                          {c.checklist.filter((i) => i.concluido).length}/{c.checklist.length}{' '}
                          checklist
                          {c.checklistAtrasados ? ` · ${c.checklistAtrasados} atrasado(s)` : ''}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="rp-print-all">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Projeto</th>
                    <th>Restrição</th>
                    <th>Responsáveis / Etapa</th>
                    <th>Vencimento</th>
                    <th>Situação</th>
                    <th>Checklist</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td>{c.projeto}</td>
                      <td>
                        <strong>{c.titulo}</strong>
                        <small>
                          #{c.codigo} · {[c.servico, c.pavimento].filter(Boolean).join(' / ')}
                        </small>
                      </td>
                      <td>
                        {c.responsaveis.join(', ') || 'Não atribuído'}
                        <small>{c.etapa}</small>
                      </td>
                      <td>{date(c.prazo)}</td>
                      <td>{formatarPrazo(c)}</td>
                      <td>
                        {c.checklist.filter((i) => i.concluido).length}/{c.checklist.length}
                        <small>{c.checklistAtrasados} atrasado(s)</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail && (
              <article
                className="rp-detail"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeDetails()
                }}
                id="rp-card-detail"
                aria-labelledby="rp-detail-title"
              >
                <div className="rp-section-heading">
                  <div>
                    <h4 id="rp-detail-title" ref={detailRef} tabIndex={-1}>
                      {detail.titulo}
                    </h4>
                    <p>
                      {detail.projeto} · Card #{detail.codigo} · {detail.etapa}
                    </p>
                  </div>
                  <button
                    className="rp-icon-button rp-no-print"
                    aria-label="Fechar detalhes do card"
                    onClick={closeDetails}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="rp-detail-meta">
                  <div>
                    <span>Responsáveis do card</span>
                    <strong>{detail.responsaveis.join(', ') || 'Não atribuídos'}</strong>
                  </div>
                  <div>
                    <span>Criação</span>
                    <strong>{date(detail.criado)}</strong>
                  </div>
                  <div>
                    <span>Vencimento</span>
                    <strong>{date(detail.prazo)}</strong>
                  </div>
                  <div>
                    <span>Conclusão</span>
                    <strong>
                      {detail.conclusao
                        ? date(detail.conclusao)
                        : detail.concluida
                          ? 'Concluída na etapa · sem data'
                          : 'Em aberto'}
                    </strong>
                  </div>
                  <div>
                    <span>Serviço / Pavimento</span>
                    <strong>
                      {[detail.servico, detail.pavimento].filter(Boolean).join(' / ') ||
                        'Não informados'}
                    </strong>
                  </div>
                  {detail.eap && (
                    <div>
                      <span>EAP</span>
                      <strong>{detail.eap}</strong>
                    </div>
                  )}
                </div>
                {detail.descricao && <p className="rp-description">{detail.descricao}</p>}
                {detail.etiquetas.length > 0 && (
                  <div className="rp-labels">
                    {detail.etiquetas.map((s) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                )}
                <h5>
                  Checklist · {detail.checklist.filter((i) => i.concluido).length} de{' '}
                  {detail.checklist.length} concluídos
                </h5>
                {detail.checklist.length === 0 ? (
                  <p>Este card não possui checklist.</p>
                ) : (
                  <ul className="rp-checklist">
                    {detail.checklist.map((i) => (
                      <li key={i.id}>
                        <span
                          className={`rp-check-icon ${i.concluido ? 'rp-success' : i.atrasado ? 'rp-danger' : ''}`}
                        >
                          {i.concluido ? <Check size={16} /> : <Clock3 size={16} />}
                        </span>
                        <div>
                          <strong>{i.descricao}</strong>
                          <span>
                            {i.responsavel || 'Sem responsável'} · Prazo: {date(i.prazo)}
                            {i.conclusao && ` · Conclusão: ${date(i.conclusao)}`}
                          </span>
                        </div>
                        <span
                          className={`rp-badge rp-${i.concluido ? 'success' : i.atrasado ? 'danger' : 'neutral'}`}
                        >
                          {i.concluido ? 'Concluído' : i.atrasado ? 'Atrasado' : 'Pendente'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )}
            {filtered.length > 0 && (
              <div className="rp-pagination rp-no-print">
                <span>
                  {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, filtered.length)} de {filtered.length}{' '}
                  cards
                </span>
                <button
                  className="rp-icon-button"
                  disabled={currentPage === 0}
                  aria-label="Página anterior de restrições"
                  onClick={() => {
                    setPage(currentPage - 1)
                    setDetailId(null)
                  }}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  Página {currentPage + 1} de {lastPage + 1}
                </span>
                <button
                  className="rp-icon-button"
                  disabled={currentPage >= lastPage}
                  aria-label="Próxima página de restrições"
                  onClick={() => {
                    setPage(currentPage + 1)
                    setDetailId(null)
                  }}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
          </section>
          <footer className="rp-footnote">
            <p>
              <strong>Critério:</strong> atraso = vencimento do card anterior à referência, em dias
              corridos. Cards concluídos ficam fora dos atrasos. Checklist é acompanhado
              separadamente; seus itens não multiplicam a contagem de cards.
            </p>
            <details className="rp-no-print">
              <summary>Como interpretar e referências</summary>
              <p>
                O mapa compara os prazos dos cards abertos, sem atribuir impacto no cronograma ou
                prioridade que a Prevision não informou. Os indicadores podem se sobrepor: um card
                atrasado também pode estar sem responsável. A data de referência recalcula os prazos
                da situação atual; não reconstrói um histórico.
              </p>
              <p>
                A organização combina o registro de restrições do{' '}
                <a
                  href="https://leanconstruction.org/lean-topics/last-planner-system/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Last Planner System · Lean Construction Institute
                </a>{' '}
                com a exploração visual de prazos observada em{' '}
                <a
                  href="https://o3.solutions/blog/the-benefits-of-a-purpose-built-solution-that-support-awp-for-construction-and-workface-planning"
                  target="_blank"
                  rel="noreferrer"
                >
                  painéis de gestão de restrições da O3
                </a>
                .
              </p>
            </details>
            <span>
              Fonte: cards da Prevision armazenados no banco · Consulta: {consultado} (Brasília).
              Atualidade conforme a última sincronização disponível.
            </span>
            <span className="rp-print-note">
              Impressão do recorte atual · {cutLabel(selection.faixa)} · {filtered.length} cards no
              recorte.
            </span>
          </footer>
        </>
      )}
    </div>
  )
}
