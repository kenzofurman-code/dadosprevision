import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleHelp,
  Eye,
  EyeOff,
  Palette,
  Plus,
  RotateCcw,
  Settings2,
  Table2,
  X,
} from 'lucide-react'
import './CurvasView.css'

type CurvePerspective = 'physical' | 'monetary'
type CurveKind = 'base' | 'planned' | 'actual' | 'manual'
type CurveStyle = 'solid' | 'dashed' | 'dotted' | 'dottedWide'

type CurvePoint = {
  date: string
  value: number | null
}

export type CurveDefinition = {
  id: string
  label: string
  perspective: CurvePerspective
  kind: CurveKind
  color: string
  style: CurveStyle
  visible: boolean
  origin: 'prevision' | 'manual'
  points?: CurvePoint[]
}

type CurveSeries = CurveDefinition & {
  points: CurvePoint[]
  displayLabel: string
}

type Props = {
  projectId: string
  projectName: string
  records: Array<Record<string, any>>
  baselineCurves?: Array<Record<string, any>>
  loading?: boolean
}

type BaselineCurvePoint = {
  data: string
  fisico: number | null
  financeiro: number | null
}

type BaselineCurve = {
  id: string
  nome: string | null
  descricao: string | null
  criada_em: string | null
  restaurada_em: string | null
  ativa: boolean
  versao_lob_id: string | null
  pontos: BaselineCurvePoint[]
}

type Range = { start: number; end: number }

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const CURVE_STYLES: Array<{ value: CurveStyle; label: string; dash: string }> = [
  { value: 'solid', label: 'Sólido', dash: 'none' },
  { value: 'dashed', label: 'Tracejado', dash: '8 5' },
  { value: 'dotted', label: 'Pontilhado', dash: '2 5' },
  { value: 'dottedWide', label: 'Pontilhado largo', dash: '2 8' },
]

const DEFAULT_CURVES: CurveDefinition[] = [
  {
    id: 'physical-base',
    label: 'Físico · Linha de base',
    perspective: 'physical',
    kind: 'base',
    color: '#0f766e',
    style: 'solid',
    visible: true,
    origin: 'prevision',
  },
  {
    id: 'physical-planned',
    label: 'Físico · Previsto',
    perspective: 'physical',
    kind: 'planned',
    color: '#2563eb',
    style: 'dashed',
    visible: true,
    origin: 'prevision',
  },
  {
    id: 'physical-actual',
    label: 'Físico · Realizado',
    perspective: 'physical',
    kind: 'actual',
    color: '#16a34a',
    style: 'solid',
    visible: true,
    origin: 'prevision',
  },
  {
    id: 'monetary-base',
    label: 'Financeiro · Linha de base',
    perspective: 'monetary',
    kind: 'base',
    color: '#b45309',
    style: 'solid',
    visible: true,
    origin: 'prevision',
  },
  {
    id: 'monetary-planned',
    label: 'Financeiro · Previsto / Orçado',
    perspective: 'monetary',
    kind: 'planned',
    color: '#dc2626',
    style: 'dashed',
    visible: true,
    origin: 'prevision',
  },
  {
    id: 'monetary-actual',
    label: 'Financeiro · Realizado',
    perspective: 'monetary',
    kind: 'actual',
    color: '#9333ea',
    style: 'solid',
    visible: true,
    origin: 'prevision',
  },
]

function normalizePerspective(value: unknown): CurvePerspective {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return normalized.includes('financ') || normalized.includes('monet') ? 'monetary' : 'physical'
}

function monthKey(value: unknown) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{4})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}` : ''
}

function formatMonth(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})/)
  return match ? `${MONTH_NAMES[Number(match[2]) - 1]}/${match[1].slice(2)}` : value
}

function normalizeValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.abs(number) > 1.5 ? number / 100 : number
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function formatInputValue(value: number | null) {
  return value === null ? '' : (value * 100).toFixed(2).replace('.', ',')
}

function parseInputValue(value: string) {
  const text = value.trim().replace('%', '').replace(/\s/g, '').replace(',', '.')
  if (!text) return null
  const number = Number(text)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(1.5, number > 1.5 ? number / 100 : number))
}

function ManualCurveCell({
  value,
  label,
  onCommit,
}: {
  value: number | null
  label: string
  onCommit: (value: number | null) => void
}) {
  const [raw, setRaw] = useState(() => formatInputValue(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setRaw(formatInputValue(value))
  }, [value])

  function commit() {
    const text = raw.trim()
    if (!text || text === '—') {
      onCommit(null)
      setRaw('')
      return
    }
    const parsed = parseInputValue(text)
    if (parsed === null) {
      setRaw(formatInputValue(value))
      return
    }
    onCommit(parsed)
    setRaw(formatInputValue(parsed))
  }

  return (
    <input
      ref={inputRef}
      aria-label={label}
      inputMode="decimal"
      value={raw}
      placeholder="—"
      onChange={(event) => setRaw(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
          inputRef.current?.blur()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setRaw(formatInputValue(value))
          inputRef.current?.blur()
        }
      }}
    />
  )
}

function curveDash(style: CurveStyle) {
  return CURVE_STYLES.find((item) => item.value === style)?.dash || 'none'
}

function isRepeatedActualValue(curve: CurveSeries, rangeStart: number, pointIndex: number) {
  if (curve.kind !== 'actual') return false
  const absoluteIndex = rangeStart + pointIndex
  if (absoluteIndex <= 0) return false
  const current = curve.points[absoluteIndex]?.value
  const previous = curve.points[absoluteIndex - 1]?.value
  return current !== null && current !== undefined && previous !== null && previous !== undefined && Math.abs(current - previous) < 0.0005
}

function sanitizeCurves(value: unknown): CurveDefinition[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): CurveDefinition[] => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Partial<CurveDefinition>
    if (!raw.id || !raw.label) return []
    const origin = raw.origin === 'manual' ? 'manual' : 'prevision'
    const kind: CurveKind = raw.kind === 'manual' ? 'manual' : raw.kind === 'planned' ? 'planned' : raw.kind === 'actual' ? 'actual' : 'base'
    const points = Array.isArray(raw.points)
      ? raw.points.flatMap((point): CurvePoint[] => {
          if (!point || typeof point !== 'object') return []
          const rawPoint = point as Partial<CurvePoint>
          const date = monthKey(rawPoint.date)
          if (!date) return []
          return [{ date, value: normalizeValue(rawPoint.value) }]
        })
      : undefined
    return [{
      id: String(raw.id),
      label: String(raw.label),
      perspective: raw.perspective === 'monetary' ? 'monetary' : 'physical',
      kind,
      color: /^#[0-9a-f]{6}$/i.test(String(raw.color || '')) ? String(raw.color) : '#0f766e',
      style: CURVE_STYLES.some((item) => item.value === raw.style) ? raw.style as CurveStyle : 'solid',
      visible: raw.visible !== false,
      origin,
      ...(points ? { points } : {}),
    }]
  })
}

function sanitizeBaselineCurves(value: unknown): BaselineCurve[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): BaselineCurve[] => {
    if (!item || typeof item !== 'object' || !(item as any).id) return []
    const raw = item as Record<string, any>
    const pontos = Array.isArray(raw.pontos)
      ? raw.pontos.flatMap((point: any): BaselineCurvePoint[] => {
          const data = monthKey(point?.data)
          if (!data) return []
          return [{
            data,
            fisico: normalizeValue(point?.fisico),
            financeiro: normalizeValue(point?.financeiro),
          }]
        })
      : []
    return [{
      id: String(raw.id),
      nome: raw.nome ? String(raw.nome) : null,
      descricao: raw.descricao ? String(raw.descricao) : null,
      criada_em: raw.criada_em ? String(raw.criada_em) : null,
      restaurada_em: raw.restaurada_em ? String(raw.restaurada_em) : null,
      ativa: Boolean(raw.ativa),
      versao_lob_id: raw.versao_lob_id ? String(raw.versao_lob_id) : null,
      pontos,
    }]
  })
}

function formatBaselineDate(value: string | null) {
  if (!value) return ''
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function baselineDisplayName(baseline: BaselineCurve | null) {
  if (!baseline) return 'Linha de base'
  const name = baseline.nome || `Linha de base ${baseline.id}`
  return `${name}${baseline.criada_em ? ` · ${formatBaselineDate(baseline.criada_em)}` : ''}`
}

function baselineOptionLabel(baseline: BaselineCurve) {
  return `${baselineDisplayName(baseline)}${baseline.ativa ? ' · ativa' : ''}`
}

function persistableCurves(curves: CurveDefinition[]) {
  return curves.map((curve) => {
    const { points, ...base } = curve
    return curve.origin === 'manual' ? { ...base, points: points || [] } : base
  })
}

function getPrevisionValue(record: Record<string, any> | undefined, kind: CurveKind) {
  if (!record || kind === 'manual') return null
  const names = kind === 'base'
    ? ['curva_base', 'base_acumulada']
    : kind === 'planned'
      ? ['curva_prevista', 'previsto_acumulado']
      : ['curva_realizada', 'realizado_acumulado']
  for (const name of names) {
    const value = normalizeValue(record[name])
    if (value !== null) return value
  }
  return null
}

function buildPath(points: CurvePoint[], x: (index: number) => number, y: (value: number) => number) {
  let path = ''
  let connected = false
  points.forEach((point, index) => {
    if (point.value === null) {
      connected = false
      return
    }
    path += `${connected ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)} `
    connected = true
  })
  return path.trim()
}

function CurveChart({
  months,
  series,
  range,
  onZoom,
  onResetZoom,
  showMarkers,
  showValues,
  focusedId,
  onFocus,
}: {
  months: string[]
  series: CurveSeries[]
  range: Range
  onZoom: (next: Range) => void
  onResetZoom: () => void
  showMarkers: boolean
  showValues: boolean
  focusedId: string | null
  onFocus: (id: string | null) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(900)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [dragBand, setDragBand] = useState<{ start: number; end: number } | null>(null)
  const dragRef = useRef<{ pixel: number; index: number } | null>(null)
  const windowMonths = months.slice(range.start, range.end + 1)
  const visibleSeries = series.filter((item) => item.visible && item.points.some((point) => point.value !== null))
  const W = Math.max(500, width)
  const H = 360
  const margin = { top: 28, right: 24, bottom: 64, left: 58 }
  const chartWidth = W - margin.left - margin.right
  const chartHeight = H - margin.top - margin.bottom
  const x = (index: number) => margin.left + (windowMonths.length <= 1 ? chartWidth / 2 : (index * chartWidth) / (windowMonths.length - 1))
  const allValues = visibleSeries.flatMap((item) => item.points.slice(range.start, range.end + 1).flatMap((point) => point.value === null ? [] : [point.value]))
  const maxValue = Math.max(1, ...allValues, 0.05)
  const topValue = Math.min(1.5, Math.ceil(maxValue * 10) / 10 + (maxValue >= 1 ? 0.05 : 0.02))
  const y = (value: number) => margin.top + (1 - value / topValue) * chartHeight
  const monthX = (index: number) => x(index)

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const update = () => setWidth(node.getBoundingClientRect().width || 900)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => setHoverIndex(null), [months, range.start, range.end, series])

  function indexAtPixel(pixel: number) {
    if (windowMonths.length <= 1 || chartWidth <= 0) return 0
    return Math.max(0, Math.min(windowMonths.length - 1, Math.round(((pixel - margin.left) / chartWidth) * (windowMonths.length - 1))))
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const pixel = event.clientX - rect.left
    const index = indexAtPixel(pixel)
    if (dragRef.current) {
      setDragBand({ start: dragRef.current.index, end: index })
      return
    }
    setHoverIndex(index)
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || windowMonths.length < 2) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const pixel = event.clientX - rect.left
    const index = indexAtPixel(pixel)
    dragRef.current = { pixel, index }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    dragRef.current = null
    svgRef.current?.releasePointerCapture?.(event.pointerId)
    if (!drag || !dragBand) {
      setDragBand(null)
      return
    }
    const rect = svgRef.current?.getBoundingClientRect()
    const currentPixel = rect ? event.clientX - rect.left : drag.pixel
    if (Math.abs(currentPixel - drag.pixel) >= 7) {
      const end = indexAtPixel(currentPixel)
      const nextStart = range.start + Math.min(drag.index, end)
      const nextEnd = range.start + Math.max(drag.index, end)
      if (nextEnd > nextStart) onZoom({ start: nextStart, end: nextEnd })
    }
    setDragBand(null)
  }

  const hoveredMonth = hoverIndex === null ? null : windowMonths[hoverIndex]
  const tooltipLeft = hoverIndex === null ? 0 : Math.max(12, Math.min(W - 244, x(hoverIndex) - 108))
  const labelStride = Math.max(1, Math.ceil(windowMonths.length / Math.max(5, Math.floor(chartWidth / 74))))
  const gridValues = Array.from({ length: Math.ceil(topValue / 0.2) + 1 }, (_, index) => Math.min(topValue, index * 0.2))

  return (
    <div ref={wrapRef} className="curvas-chart-wrap">
      <svg
        ref={svgRef}
        className="curvas-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Curvas S de andamento físico e financeiro"
        onPointerMove={pointerMove}
        onPointerLeave={() => { if (!dragRef.current) setHoverIndex(null) }}
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onDoubleClick={onResetZoom}
      >
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        {gridValues.map((value) => (
          <g key={`grid-${value}`}>
            <line className="curvas-grid-line" x1={margin.left} x2={W - margin.right} y1={y(value)} y2={y(value)} />
            <text className="curvas-axis-label" x={margin.left - 10} y={y(value) + 4} textAnchor="end">{Math.round(value * 100)}%</text>
          </g>
        ))}
        {windowMonths.map((month, index) => (
          <g key={month}>
            {(index % labelStride === 0 || index === windowMonths.length - 1) && (
              <line className="curvas-grid-line vertical" x1={monthX(index)} x2={monthX(index)} y1={margin.top} y2={H - margin.bottom} />
            )}
            <line className="curvas-axis-tick" x1={monthX(index)} x2={monthX(index)} y1={H - margin.bottom} y2={H - margin.bottom + 5} />
            {(index % labelStride === 0 || index === windowMonths.length - 1) && (
              <text className="curvas-axis-label curvas-axis-month" x={monthX(index)} y={H - margin.bottom + 18} textAnchor="end" transform={`rotate(-45 ${monthX(index)} ${H - margin.bottom + 18})`}>{formatMonth(month)}</text>
            )}
          </g>
        ))}
        <line className="curvas-axis-line" x1={margin.left} x2={W - margin.right} y1={H - margin.bottom} y2={H - margin.bottom} />
        {visibleSeries.map((curve) => {
          const dimmed = focusedId !== null && focusedId !== curve.id
          const points = curve.points.slice(range.start, range.end + 1)
          return (
            <g key={curve.id} className={dimmed ? 'curvas-series dimmed' : 'curvas-series'}>
              <path
                className="curvas-line"
                d={buildPath(points, (index) => x(index), y)}
                stroke={curve.color}
                strokeDasharray={curveDash(curve.style)}
                strokeWidth={focusedId === curve.id ? 3.7 : 2.4}
              />
              {showMarkers && points.map((point, index) => point.value === null ? null : (
                <circle key={`${curve.id}-point-${index}`} className="curvas-marker" cx={x(index)} cy={y(point.value)} r={focusedId === curve.id ? 4 : 3} fill={curve.color} />
              ))}
              {showValues && points.map((point, index) => point.value === null || isRepeatedActualValue(curve, range.start, index) || (index % labelStride !== 0 && index !== points.length - 1) ? null : (
                <text key={`${curve.id}-value-${index}`} className="curvas-point-label" x={x(index)} y={y(point.value) - 9} textAnchor="middle" fill={curve.color}>{formatPercent(point.value)}</text>
              ))}
              <path
                className="curvas-hit-line"
                d={buildPath(points, (index) => x(index), y)}
                onClick={(event) => { event.stopPropagation(); onFocus(focusedId === curve.id ? null : curve.id) }}
              />
            </g>
          )
        })}
        {hoverIndex !== null && (
          <line className="curvas-crosshair" x1={x(hoverIndex)} x2={x(hoverIndex)} y1={margin.top} y2={H - margin.bottom} />
        )}
        {dragBand && dragBand.start !== dragBand.end && (
          <rect className="curvas-brush" x={Math.min(x(dragBand.start), x(dragBand.end))} width={Math.abs(x(dragBand.end) - x(dragBand.start))} y={margin.top} height={chartHeight} />
        )}
      </svg>
      {hoveredMonth && (
        <div className="curvas-tooltip" style={{ left: tooltipLeft }} role="status">
          <strong>{formatMonth(hoveredMonth)}</strong>
          {visibleSeries.map((curve) => {
            const pointIndex = hoverIndex || 0
            const point = curve.points[range.start + pointIndex]
            const repeated = isRepeatedActualValue(curve, range.start, pointIndex)
            return (
              <div key={curve.id} className="curvas-tooltip-row">
                <i style={{ backgroundColor: curve.color }} />
                <span>{curve.displayLabel}</span>
                {!repeated && <b>{formatPercent(point?.value ?? null)}</b>}
              </div>
            )
          })}
        </div>
      )}
      {!visibleSeries.length && <div className="curvas-empty-overlay">Selecione ao menos uma curva com dados para visualizar o gráfico.</div>}
    </div>
  )
}

function CurveSettingsModal({
  curves,
  onChange,
  onClose,
  onNewManual,
}: {
  curves: CurveDefinition[]
  onChange: (next: CurveDefinition[]) => void
  onClose: () => void
  onNewManual: () => void
}) {
  function update(id: string, patch: Partial<CurveDefinition>) {
    onChange(curves.map((curve) => curve.id === id ? { ...curve, ...patch } : curve))
  }

  function move(id: string, direction: -1 | 1) {
    const index = curves.findIndex((curve) => curve.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= curves.length) return
    const next = [...curves]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }

  return (
    <div className="curvas-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="curvas-modal" role="dialog" aria-modal="true" aria-label="Configurar curvas" onClick={(event) => event.stopPropagation()}>
        <div className="curvas-modal-header">
          <div>
            <h3>Configurar curvas</h3>
            <p>As alterações ficam disponíveis para todos os usuários deste projeto.</p>
          </div>
          <button type="button" className="curvas-icon-button" onClick={onClose} aria-label="Fechar configurações"><X size={18} /></button>
        </div>
        <div className="curvas-settings-list">
          {curves.map((curve, index) => (
            <div key={curve.id} className="curvas-setting-row">
              <label className="curvas-setting-visible">
                <input type="checkbox" checked={curve.visible} onChange={(event) => update(curve.id, { visible: event.target.checked })} />
                {curve.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </label>
              <span className="curvas-setting-swatch" style={{ backgroundColor: curve.color }} />
              <div className="curvas-setting-name">
                <strong>{curve.label}</strong>
                <small>{curve.origin === 'prevision' ? 'Prevision · somente leitura' : 'Curva manual · editável'}</small>
              </div>
              <label className="curvas-color-input" title="Escolher cor">
                <Palette size={14} />
                <input type="color" value={curve.color} onChange={(event) => update(curve.id, { color: event.target.value })} />
              </label>
              <select value={curve.style} onChange={(event) => update(curve.id, { style: event.target.value as CurveStyle })} aria-label={`Traço de ${curve.label}`}>
                {CURVE_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
              </select>
              <div className="curvas-setting-order">
                <button type="button" className="curvas-icon-button" disabled={index === 0} onClick={() => move(curve.id, -1)} aria-label="Mover curva para cima"><ArrowUp size={14} /></button>
                <button type="button" className="curvas-icon-button" disabled={index === curves.length - 1} onClick={() => move(curve.id, 1)} aria-label="Mover curva para baixo"><ArrowDown size={14} /></button>
              </div>
              {curve.origin === 'manual' && <button type="button" className="curvas-remove-button" onClick={() => onChange(curves.filter((item) => item.id !== curve.id))}>Excluir</button>}
            </div>
          ))}
        </div>
        <div className="curvas-modal-footer">
          <button type="button" className="curvas-secondary-button" onClick={onNewManual}><Plus size={14} /> Nova curva manual</button>
          <button type="button" className="curvas-primary-button" onClick={onClose}><Check size={14} /> Concluir</button>
        </div>
      </div>
    </div>
  )
}

function ManualCurveModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (label: string, perspective: CurvePerspective, color: string, style: CurveStyle) => void
}) {
  const [label, setLabel] = useState('Curva manual')
  const [perspective, setPerspective] = useState<CurvePerspective>('physical')
  const [color, setColor] = useState('#0f766e')
  const [style, setStyle] = useState<CurveStyle>('dotted')
  return (
    <div className="curvas-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="curvas-modal curvas-manual-modal" role="dialog" aria-modal="true" aria-label="Nova curva manual" onClick={(event) => event.stopPropagation()}>
        <div className="curvas-modal-header">
          <div><h3>Nova curva manual</h3><p>Use a tabela para preencher os pontos que não vêm do Prevision.</p></div>
          <button type="button" className="curvas-icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="curvas-manual-form">
          <label><span>Nome</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Cenário aprovado" /></label>
          <label><span>Perspectiva</span><select value={perspective} onChange={(event) => setPerspective(event.target.value as CurvePerspective)}><option value="physical">Físico</option><option value="monetary">Financeiro</option></select></label>
          <label><span>Cor</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
          <label><span>Traço</span><select value={style} onChange={(event) => setStyle(event.target.value as CurveStyle)}>{CURVE_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
        <div className="curvas-modal-footer"><button type="button" className="curvas-secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="curvas-primary-button" disabled={!label.trim()} onClick={() => onCreate(label.trim(), perspective, color, style)}><Plus size={14} /> Criar curva</button></div>
      </div>
    </div>
  )
}

export function CurvasView({ projectId, projectName, records, baselineCurves = [], loading = false }: Props) {
  const [storedCurves, setStoredCurves] = useState<CurveDefinition[] | null>(null)
  const [storedBaselineId, setStoredBaselineId] = useState<string | null>(null)
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(null)
  const [configState, setConfigState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [configError, setConfigError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showMarkers, setShowMarkers] = useState(true)
  const [showValues, setShowValues] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [range, setRange] = useState<Range>({ start: 0, end: 0 })
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setStoredCurves(null)
    setConfigError('')
    if (!projectId) {
      setConfigState('ready')
      return () => { cancelled = true }
    }
    setConfigState('loading')
    fetch(`/api/curve-config?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar a configuração.')
        if (!cancelled) {
          setStoredCurves(sanitizeCurves(payload?.config?.curves))
          setStoredBaselineId(payload?.config?.linha_base_id ? String(payload.config.linha_base_id) : null)
          setConfigState('ready')
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStoredCurves([])
          setStoredBaselineId(null)
          setConfigState('ready')
          setConfigError(error instanceof Error ? error.message : 'Não foi possível carregar a configuração.')
        }
      })
    return () => { cancelled = true }
  }, [projectId])

  const availableBaselines = useMemo(() => sanitizeBaselineCurves(baselineCurves).sort((left, right) => {
    if (left.ativa !== right.ativa) return left.ativa ? -1 : 1
    return String(right.criada_em || '').localeCompare(String(left.criada_em || ''))
  }), [baselineCurves])

  const activeBaseline = useMemo(
    () => availableBaselines.find((baseline) => baseline.ativa) || availableBaselines[0] || null,
    [availableBaselines],
  )

  useEffect(() => {
    if (!availableBaselines.length) {
      setSelectedBaselineId(null)
      return
    }
    const requested = storedBaselineId || selectedBaselineId
    const selected = availableBaselines.find((baseline) => baseline.id === requested)
    setSelectedBaselineId(selected?.id || activeBaseline?.id || availableBaselines[0].id)
  }, [activeBaseline, availableBaselines, projectId, selectedBaselineId, storedBaselineId])

  const selectedBaseline = useMemo(
    () => availableBaselines.find((baseline) => baseline.id === selectedBaselineId) || activeBaseline,
    [activeBaseline, availableBaselines, selectedBaselineId],
  )

  const definitions = useMemo(() => {
    const stored = storedCurves || []
    const storedById = new Map(stored.map((curve) => [curve.id, curve]))
    const defaults = DEFAULT_CURVES.map((curve) => ({ ...curve, ...storedById.get(curve.id) }))
    const defaultIds = new Set(DEFAULT_CURVES.map((curve) => curve.id))
    const custom = stored.filter((curve) => !defaultIds.has(curve.id))
    const ordered = [...stored.map((curve) => curve.id), ...defaults.map((curve) => curve.id), ...custom.map((curve) => curve.id)]
    const all = new Map([...defaults, ...custom].map((curve) => [curve.id, curve]))
    return [...new Set(ordered)].flatMap((id) => all.get(id) ? [all.get(id)!] : [])
  }, [storedCurves])

  const recordByPerspective = useMemo(() => {
    const result: Record<CurvePerspective, Map<string, Record<string, any>>> = { physical: new Map(), monetary: new Map() }
    records.forEach((record) => {
      const month = monthKey(record.data)
      if (!month) return
      result[normalizePerspective(record.perspectiva)].set(month, record)
    })
    return result
  }, [records])

  const months = useMemo(() => {
    const all = new Set<string>([...recordByPerspective.physical.keys(), ...recordByPerspective.monetary.keys()])
    definitions.forEach((curve) => (curve.points || []).forEach((point) => all.add(point.date)))
    return [...all].sort()
  }, [definitions, recordByPerspective])

  const selectedBaselinePoints = useMemo(
    () => new Map((selectedBaseline?.pontos || []).map((point) => [point.data, point])),
    [selectedBaseline],
  )

  const series = useMemo<CurveSeries[]>(() => definitions.map((curve) => {
    const manualMap = new Map((curve.points || []).map((point) => [point.date, point.value]))
    const points = months.map((date) => ({
      date,
      value: curve.origin === 'manual'
        ? (manualMap.get(date) ?? null)
        : curve.kind === 'base'
          ? (selectedBaselinePoints.get(date)?.[curve.perspective === 'physical' ? 'fisico' : 'financeiro'] ?? getPrevisionValue(recordByPerspective[curve.perspective].get(date), curve.kind))
          : getPrevisionValue(recordByPerspective[curve.perspective].get(date), curve.kind),
    }))
    const displayLabel = curve.kind === 'base'
      ? `${curve.perspective === 'physical' ? 'Físico' : 'Financeiro'} · ${baselineDisplayName(selectedBaseline)}`
      : curve.label
    return { ...curve, points, displayLabel }
  }), [definitions, months, recordByPerspective, selectedBaseline, selectedBaselinePoints])

  useEffect(() => {
    setRange({ start: 0, end: Math.max(0, months.length - 1) })
  }, [projectId, months.length])

  useEffect(() => {
    if (configState !== 'ready' || !projectId || !storedCurves) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      setSaving(true)
      try {
        const response = await fetch('/api/curve-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            config: {
              curves: persistableCurves(storedCurves),
              linha_base_id: selectedBaselineId,
            },
          }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || 'Não foi possível salvar a configuração.')
        setConfigError('')
      } catch (error) {
        setConfigError(error instanceof Error ? error.message : 'Não foi possível salvar a configuração.')
      } finally {
        setSaving(false)
      }
    }, 450)
    return () => { if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current) }
  }, [configState, projectId, selectedBaselineId, storedCurves])

  function updateDefinitions(next: CurveDefinition[]) {
    setStoredCurves(persistableCurves(next))
  }

  function createManualCurve(label: string, perspective: CurvePerspective, color: string, style: CurveStyle) {
    const curve: CurveDefinition = {
      id: `manual-${Date.now()}`,
      label,
      perspective,
      kind: 'manual',
      color,
      style,
      visible: true,
      origin: 'manual',
      points: [],
    }
    updateDefinitions([...definitions, curve])
    setManualOpen(false)
    setTableOpen(true)
  }

  function updateManualPoint(curveId: string, date: string, value: number | null) {
    updateDefinitions(definitions.map((curve) => {
      if (curve.id !== curveId || curve.origin !== 'manual') return curve
      const points = [...(curve.points || []).filter((point) => point.date !== date), { date, value }].sort((left, right) => left.date.localeCompare(right.date))
      return { ...curve, points }
    }))
  }

  const hasAnyData = series.some((curve) => curve.points.some((point) => point.value !== null))
  const settingsStyle = { ['--curve-color' as string]: '#173f38' } as CSSProperties

  return (
    <div className="curvas-view" style={settingsStyle}>
      <div className="curvas-heading-card">
        <div>
          <span className="curvas-eyebrow">Visualizador de curvas</span>
          <h3>Curvas S de andamento</h3>
          <p>{projectId ? `${projectName || 'Projeto selecionado'} · período completo disponível no Prevision` : 'Selecione um projeto para visualizar as curvas.'}</p>
        </div>
        <div className="curvas-heading-actions">
          <label className="curvas-baseline-selector" title={selectedBaseline?.descricao || 'Selecione a linha de base que será exibida'}>
            <span>Linha de base</span>
            <select
              value={selectedBaselineId || ''}
              disabled={!availableBaselines.length}
              onChange={(event) => setSelectedBaselineId(event.target.value || null)}
              aria-label="Selecionar linha de base"
            >
              {!availableBaselines.length && <option value="">Nenhuma disponível</option>}
              {availableBaselines.map((baseline) => (
                <option key={baseline.id} value={baseline.id}>{baselineOptionLabel(baseline)}</option>
              ))}
            </select>
          </label>
          <button type="button" className={showMarkers ? 'curvas-toggle active' : 'curvas-toggle'} onClick={() => setShowMarkers((value) => !value)}><span className="curvas-toggle-dot" /> Marcadores</button>
          <button type="button" className={showValues ? 'curvas-toggle active' : 'curvas-toggle'} onClick={() => setShowValues((value) => !value)}>Valores</button>
          <button type="button" className={tableOpen ? 'curvas-toggle active' : 'curvas-toggle'} onClick={() => setTableOpen((value) => !value)}><Table2 size={14} /> {tableOpen ? 'Ocultar tabela' : 'Mostrar tabela'}</button>
          <button type="button" className="curvas-secondary-button" onClick={() => setSettingsOpen(true)}><Settings2 size={14} /> Configurar</button>
        </div>
      </div>

      {configError && <div className="curvas-feedback error"><CircleHelp size={15} /> {configError}</div>}
      {saving && <div className="curvas-saving"><span /> Salvando configuração compartilhada...</div>}

      {!projectId ? (
        <div className="curvas-empty-card">Escolha um projeto no seletor acima para carregar suas curvas.</div>
      ) : (
        <>
          <div className="curvas-chart-layout">
            <aside className="curvas-legend-card" aria-label="Curvas exibidas">
              <div className="curvas-legend-intro"><strong>Curvas exibidas</strong><span>Clique para ligar/desligar · duplo clique para destacar uma curva</span></div>
              <div className="curvas-legend-list">
                {series.map((curve) => {
                  const available = curve.points.some((point) => point.value !== null)
                  return (
                    <button
                      key={curve.id}
                      type="button"
                      className={`curvas-legend-item ${curve.visible ? 'selected' : ''} ${focusedId === curve.id ? 'focused' : ''}`}
                      aria-pressed={curve.visible}
                      disabled={!available && curve.origin === 'prevision'}
                      onClick={() => updateDefinitions(definitions.map((item) => item.id === curve.id ? { ...item, visible: !item.visible } : item))}
                      onDoubleClick={() => setFocusedId((value) => value === curve.id ? null : curve.id)}
                      title={available ? 'Clique para alternar a curva' : 'Sem dados deste tipo para o projeto'}
                    >
                      <span className="curvas-legend-line" style={{ backgroundColor: curve.color, borderTopStyle: curve.style === 'solid' ? 'solid' : curve.style === 'dashed' ? 'dashed' : 'dotted' }} />
                      <span className="curvas-legend-copy"><strong>{curve.displayLabel}</strong><small>{curve.origin === 'prevision' ? 'Prevision' : 'Manual'}</small></span>
                      {curve.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  )
                })}
              </div>
            </aside>

            <div className="curvas-chart-card">
              <div className="curvas-chart-toolbar">
                <div><strong>{hasAnyData ? `${months.length} meses disponíveis` : 'Sem dados de curva'}</strong><span>Arraste sobre o gráfico para aplicar zoom · duplo clique restaura o período completo</span></div>
                <button type="button" className="curvas-secondary-button" onClick={() => setRange({ start: 0, end: Math.max(0, months.length - 1) })} disabled={!months.length}><RotateCcw size={14} /> Período completo</button>
              </div>
              {loading || configState === 'loading' ? <div className="curvas-loading">Carregando curvas...</div> : months.length > 0 ? <CurveChart months={months} series={series} range={range} onZoom={setRange} onResetZoom={() => setRange({ start: 0, end: Math.max(0, months.length - 1) })} showMarkers={showMarkers} showValues={showValues} focusedId={focusedId} onFocus={setFocusedId} /> : <div className="curvas-empty-card">O projeto não possui pontos mensais de andamento disponíveis.</div>}
            </div>
          </div>

          {tableOpen && (
            <div className="curvas-table-card">
              <div className="curvas-table-heading"><div><strong>Dados mensais das curvas</strong><span>Curvas do Prevision ficam bloqueadas; curvas manuais podem ser preenchidas e copiadas para o Excel.</span></div><span className="curvas-table-project">{projectName}</span></div>
              <div className="curvas-table-scroll">
                <table className="curvas-data-table">
                  <thead><tr><th>Mês</th>{series.filter((curve) => curve.points.some((point) => point.value !== null) || curve.origin === 'manual').map((curve) => <th key={curve.id}><span className="curvas-table-title"><i style={{ backgroundColor: curve.color }} />{curve.displayLabel}</span></th>)}</tr></thead>
                  <tbody>{months.map((month, monthIndex) => <tr key={month}><td>{formatMonth(month)}</td>{series.filter((curve) => curve.points.some((point) => point.value !== null) || curve.origin === 'manual').map((curve) => { const value = curve.points[monthIndex]?.value ?? null; const repeated = isRepeatedActualValue(curve, 0, monthIndex); return <td key={curve.id} className={curve.origin === 'manual' ? 'editable-cell' : 'locked-cell'}>{curve.origin === 'manual' ? <ManualCurveCell label={`${curve.displayLabel} em ${formatMonth(month)}`} value={value} onCommit={(nextValue) => updateManualPoint(curve.id, month, nextValue)} /> : repeated ? <span className="curvas-unchanged-value" title="Sem alteração em relação ao mês anterior" /> : <span title="Valor fornecido pelo Prevision">{formatPercent(value)}</span>}</td> })}</tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {settingsOpen && <CurveSettingsModal curves={definitions} onChange={updateDefinitions} onClose={() => setSettingsOpen(false)} onNewManual={() => { setSettingsOpen(false); setManualOpen(true) }} />}
      {manualOpen && <ManualCurveModal onClose={() => setManualOpen(false)} onCreate={createManualCurve} />}
    </div>
  )
}
