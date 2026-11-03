import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { formatMonth, formatPercent, formatSignedPercent } from '../../lib/curvas-formatters'

interface Props {
  months: string[]
  range: { start: number; end: number }
  plannedPoints: Array<{ date: string; value: number | null }>
  actualPoints: Array<{ date: string; value: number | null }>
  showValues: boolean
  perspectiveLabel?: string
  accentColor?: string
  chartHeight?: number
}

const MARGIN = { top: 18, right: 24, bottom: 36, left: 58 }

export function CumulativeDeviationChart({
  months,
  range,
  plannedPoints,
  actualPoints,
  showValues,
  perspectiveLabel = 'Físico',
  accentColor = '#2563eb',
  chartHeight = 135,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(900)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const windowMonths = useMemo(
    () => months.slice(range.start, range.end + 1),
    [months, range.start, range.end],
  )

  useLayoutEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const update = () => {
      const bounds = node.getBoundingClientRect()
      setWidth(Math.max(480, Math.round(bounds.width || 900)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const items = useMemo(() => {
    return windowMonths.map((month, i) => {
      const absIndex = range.start + i
      const planned = plannedPoints[absIndex]?.value ?? null
      const actual = actualPoints[absIndex]?.value ?? null
      const delta = planned !== null && actual !== null ? actual - planned : null
      return {
        month,
        index: i,
        planned,
        actual,
        delta,
      }
    })
  }, [windowMonths, range.start, plannedPoints, actualPoints])

  const validItems = useMemo(() => items.filter((item) => item.delta !== null), [items])

  const lastMeasuredItem = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].delta !== null) return items[i]
    }
    return null
  }, [items])

  const W = Math.max(500, width)
  const H = Math.max(110, chartHeight)
  const chartWidth = W - MARGIN.left - MARGIN.right
  const innerPlotHeight = H - MARGIN.top - MARGIN.bottom

  const x = useCallback(
    (index: number) => {
      if (windowMonths.length <= 1) return MARGIN.left + chartWidth / 2
      return MARGIN.left + (index * chartWidth) / (windowMonths.length - 1)
    },
    [windowMonths.length, chartWidth],
  )

  // Max amplitude for symmetric zero centering
  const maxAbsDelta = useMemo(() => {
    if (!validItems.length) return 0.05
    const maxVal = Math.max(...validItems.map((item) => Math.abs(item.delta!)))
    return Math.max(0.04, Math.ceil(maxVal * 25) / 25)
  }, [validItems])

  const yDomain = maxAbsDelta
  const y = useCallback(
    (val: number) => {
      // Clamped to range [-yDomain, +yDomain]
      const clamped = Math.max(-yDomain, Math.min(yDomain, val))
      return MARGIN.top + ((yDomain - clamped) / (2 * yDomain)) * innerPlotHeight
    },
    [yDomain, innerPlotHeight],
  )

  const zeroY = y(0)

  // Grid tick marks
  const gridSteps = useMemo(() => {
    const step = yDomain / 2
    return [+yDomain, +step, 0, -step, -yDomain]
  }, [yDomain])

  const labelStride = Math.max(1, Math.ceil(windowMonths.length / Math.max(5, Math.floor(chartWidth / 74))))

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || windowMonths.length <= 1 || chartWidth <= 0) return
    const pixel = e.clientX - rect.left
    const index = Math.max(
      0,
      Math.min(windowMonths.length - 1, Math.round(((pixel - MARGIN.left) / chartWidth) * (windowMonths.length - 1))),
    )
    setHoverIndex(index)
  }

  // Build path for deviation line
  const linePath = useMemo(() => {
    let path = ''
    let connected = false
    items.forEach((item) => {
      if (item.delta === null) {
        connected = false
        return
      }
      const px = x(item.index).toFixed(1)
      const py = y(item.delta).toFixed(1)
      path += `${connected ? ' L ' : 'M '}${px} ${py}`
      connected = true
    })
    return path
  }, [items, x, y])

  // Build area polygons (green for positive, red for negative)
  const areaPolygons = useMemo(() => {
    if (validItems.length < 2) return null
    const first = validItems[0]
    const last = validItems[validItems.length - 1]
    let path = `M ${x(first.index).toFixed(1)} ${zeroY.toFixed(1)}`
    validItems.forEach((item) => {
      path += ` L ${x(item.index).toFixed(1)} ${y(item.delta!).toFixed(1)}`
    })
    path += ` L ${x(last.index).toFixed(1)} ${zeroY.toFixed(1)} Z`
    return path
  }, [validItems, x, y, zeroY])

  return (
    <div className="curvas-deviation-card">
      <div className="curvas-deviation-header">
        <div className="curvas-deviation-titles">
          <span className="curvas-chart-sublabel">DESVIO ACUMULADO NA LINHA DO TEMPO ({perspectiveLabel.toUpperCase()})</span>
          <h4>Desvio Acumulado (Realizado − Previsto)</h4>
        </div>
        <div className="curvas-deviation-meta">
          {lastMeasuredItem && lastMeasuredItem.delta !== null ? (
            <span
              className={`curvas-deviation-badge ${
                lastMeasuredItem.delta > 0.002
                  ? 'positive'
                  : lastMeasuredItem.delta < -0.002
                  ? 'negative'
                  : 'neutral'
              }`}
            >
              Último mês medido ({formatMonth(lastMeasuredItem.month)}):{' '}
              <strong>{formatSignedPercent(lastMeasuredItem.delta)}</strong>
              {lastMeasuredItem.delta > 0.002
                ? ' · Adiantado'
                : lastMeasuredItem.delta < -0.002
                ? ' · Atrasado'
                : ' · Em dia'}
            </span>
          ) : (
            <span className="curvas-deviation-badge neutral">Sem medições no período</span>
          )}
        </div>
      </div>

      <div ref={wrapRef} className="curvas-chart-wrap" style={{ height: H }}>
        <svg
          ref={svgRef}
          className="curvas-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Gráfico de Desvio Acumulado"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />

          {/* Grid lines */}
          {gridSteps.map((stepVal) => {
            const gy = y(stepVal)
            const isZero = Math.abs(stepVal) < 0.0001
            return (
              <g key={`grid-step-${stepVal}`}>
                <line
                  className={`curvas-grid-line ${isZero ? 'curvas-zero-line' : ''}`}
                  x1={MARGIN.left}
                  x2={W - MARGIN.right}
                  y1={gy}
                  y2={gy}
                  stroke={isZero ? '#475569' : '#e2e8f0'}
                  strokeWidth={isZero ? 1.5 : 1}
                  strokeDasharray={isZero ? '4 3' : 'none'}
                />
                <text
                  className="curvas-axis-label"
                  x={MARGIN.left - 8}
                  y={gy + 4}
                  textAnchor="end"
                  fill={isZero ? '#1e293b' : '#64748b'}
                  fontWeight={isZero ? 700 : 500}
                >
                  {formatSignedPercent(stepVal)}
                </text>
              </g>
            )
          })}

          {/* X axis grid ticks and month labels */}
          {windowMonths.map((m, i) => {
            const mx = x(i)
            const showMonth = i % labelStride === 0 || i === windowMonths.length - 1
            return (
              <g key={`x-tick-${m}`}>
                {showMonth && (
                  <line
                    className="curvas-grid-line vertical"
                    x1={mx}
                    x2={mx}
                    y1={MARGIN.top}
                    y2={H - MARGIN.bottom}
                    stroke="#f1f5f9"
                  />
                )}
                <line
                  className="curvas-axis-tick"
                  x1={mx}
                  x2={mx}
                  y1={H - MARGIN.bottom}
                  y2={H - MARGIN.bottom + 4}
                  stroke="#94a3b8"
                />
                {showMonth && (
                  <text
                    className="curvas-axis-label curvas-axis-month"
                    x={mx}
                    y={H - MARGIN.bottom + 16}
                    textAnchor="end"
                    transform={`rotate(-45 ${mx} ${H - MARGIN.bottom + 16})`}
                  >
                    {formatMonth(m)}
                  </text>
                )}
              </g>
            )
          })}

          {/* Area fill */}
          {areaPolygons && (
            <path
              d={areaPolygons}
              fill="rgba(37, 99, 235, 0.12)"
              className="curvas-deviation-area"
            />
          )}

          {/* Zero baseline reference line */}
          <line
            x1={MARGIN.left}
            x2={W - MARGIN.right}
            y1={zeroY}
            y2={zeroY}
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />

          {/* Deviation line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={accentColor}
              strokeWidth={2.6}
              className="curvas-deviation-line"
            />
          )}

          {/* Points & badges */}
          {items.map((item) => {
            if (item.delta === null) return null
            const cx = x(item.index)
            const cy = y(item.delta)
            const isPos = item.delta > 0.0001
            const dotColor = isPos ? '#2563eb' : '#dc2626'
            const badgeColor = isPos ? '#2563eb' : '#dc2626'
            const badgeLabel = formatSignedPercent(item.delta)
            const badgeWidth = Math.max(26, badgeLabel.length * 5.2 + 8)
            const badgeY = isPos ? cy - 18 : cy + 6

            return (
              <g key={`dev-pt-${item.month}`}>
                <circle cx={cx} cy={cy} r={3.6} fill={dotColor} stroke="#ffffff" strokeWidth={1.5} />
                {showValues && (
                  <g className="curvas-point-label">
                    <rect
                      x={cx - badgeWidth / 2}
                      y={badgeY}
                      width={badgeWidth}
                      height={14}
                      rx={2}
                      fill={badgeColor}
                    />
                    <text x={cx} y={badgeY + 10} textAnchor="middle" fill="#ffffff" fontSize={9} fontWeight={700}>
                      {badgeLabel}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* Hover indicator */}
          {hoverIndex !== null && items[hoverIndex] && (
            <g className="curvas-hover-indicator">
              <line
                className="curvas-crosshair"
                x1={x(hoverIndex)}
                x2={x(hoverIndex)}
                y1={MARGIN.top}
                y2={H - MARGIN.bottom}
                stroke="#0f766e"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            </g>
          )}
        </svg>

        {/* Hover Tooltip */}
        {hoverIndex !== null && items[hoverIndex] && items[hoverIndex].delta !== null && (
          <div
            className="curvas-tooltip below"
            style={{
              left: Math.max(50, Math.min(W - 120, x(hoverIndex))),
              top: Math.max(8, y(items[hoverIndex].delta!) - 10),
            }}
          >
            <strong>{formatMonth(items[hoverIndex].month)}</strong>
            <div className="curvas-tooltip-row">
              <i style={{ backgroundColor: '#2563eb' }} />
              <span>Previsto acumulado:</span>
              <b>{formatPercent(items[hoverIndex].planned)}</b>
            </div>
            <div className="curvas-tooltip-row">
              <i style={{ backgroundColor: '#16a34a' }} />
              <span>Realizado acumulado:</span>
              <b>{formatPercent(items[hoverIndex].actual)}</b>
            </div>
            <div className="curvas-tooltip-row">
              <i
                style={{
                  backgroundColor:
                    items[hoverIndex].delta! > 0 ? '#16a34a' : items[hoverIndex].delta! < 0 ? '#dc2626' : '#64748b',
                }}
              />
              <span>Desvio acumulado:</span>
              <b className={items[hoverIndex].delta! < 0 ? 'negative' : 'positive'}>
                {formatSignedPercent(items[hoverIndex].delta)}
              </b>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
