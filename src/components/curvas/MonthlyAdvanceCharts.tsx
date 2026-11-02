import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { formatMonth, formatPercent, formatSignedPercent } from '../../lib/curvas-formatters'

export interface MonthlyDataPoint {
  month: string
  index: number
  plannedMonthly: number | null
  actualMonthly: number | null
  variationMonthly: number | null
  plannedCumulative: number | null
  actualCumulative: number | null
}

interface Props {
  months: string[]
  range: { start: number; end: number }
  plannedSeries?: { points: Array<{ date: string; value: number | null }> }
  actualSeries?: { points: Array<{ date: string; value: number | null }> }
  recordByPerspective?: Map<string, Record<string, any>>
  perspectiveLabel?: string
  showValues?: boolean
}

const MARGIN = { top: 28, right: 24, bottom: 48, left: 58 }

export function MonthlyAdvanceCharts({
  months,
  range,
  plannedSeries,
  actualSeries,
  recordByPerspective,
  perspectiveLabel = 'Físico',
  showValues = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
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

  // Calculate monthly values for each month in the window
  const monthlyData = useMemo<MonthlyDataPoint[]>(() => {
    return windowMonths.map((month, i) => {
      const absIndex = range.start + i
      const plannedCum = plannedSeries?.points[absIndex]?.value ?? null
      const actualCum = actualSeries?.points[absIndex]?.value ?? null
      const prevPlannedCum = absIndex > 0 ? (plannedSeries?.points[absIndex - 1]?.value ?? 0) : 0
      const prevActualCum = absIndex > 0 ? (actualSeries?.points[absIndex - 1]?.value ?? null) : 0

      const rec = recordByPerspective?.get(month)

      // Previsto Mensal
      let pMes: number | null = null
      if (rec?.previsto_mes !== undefined && rec?.previsto_mes !== null && Number.isFinite(Number(rec.previsto_mes))) {
        pMes = Math.max(0, Number(rec.previsto_mes))
      } else if (plannedCum !== null) {
        pMes = Math.max(0, plannedCum - prevPlannedCum)
      }

      // Realizado Mensal (only if actual measurement exists)
      let rMes: number | null = null
      if (actualCum !== null) {
        if (
          rec?.realizado_mes !== undefined &&
          rec?.realizado_mes !== null &&
          Number.isFinite(Number(rec.realizado_mes)) &&
          Number(rec.realizado_mes) > 0
        ) {
          rMes = Math.max(0, Number(rec.realizado_mes))
        } else if (prevActualCum !== null) {
          rMes = Math.max(0, actualCum - prevActualCum)
        } else {
          rMes = actualCum
        }
      }

      // Variação Mensal = Realizado do Mês - Previsto do Mês
      let vMes: number | null = null
      if (rMes !== null && pMes !== null) {
        vMes = rMes - pMes
      }

      return {
        month,
        index: i,
        plannedMonthly: pMes,
        actualMonthly: rMes,
        variationMonthly: vMes,
        plannedCumulative: plannedCum,
        actualCumulative: actualCum,
      }
    })
  }, [windowMonths, range.start, plannedSeries, actualSeries, recordByPerspective])

  const W = Math.max(500, width)
  const chartWidth = W - MARGIN.left - MARGIN.right

  const x = useCallback(
    (index: number) => {
      if (windowMonths.length <= 1) return MARGIN.left + chartWidth / 2
      return MARGIN.left + (index * chartWidth) / (windowMonths.length - 1)
    },
    [windowMonths.length, chartWidth],
  )

  const labelStride = Math.max(1, Math.ceil(windowMonths.length / Math.max(5, Math.floor(chartWidth / 74))))

  function handlePointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (windowMonths.length <= 1 || chartWidth <= 0) return
    const pixel = e.clientX - rect.left
    const index = Math.max(
      0,
      Math.min(windowMonths.length - 1, Math.round(((pixel - MARGIN.left) / chartWidth) * (windowMonths.length - 1))),
    )
    setHoverIndex(index)
  }

  // Bar Chart calculations
  const barChartHeight = 270
  const barInnerH = barChartHeight - MARGIN.top - MARGIN.bottom

  const maxBarValue = useMemo(() => {
    let maxV = 0.04
    monthlyData.forEach((d) => {
      if (d.plannedMonthly !== null) maxV = Math.max(maxV, d.plannedMonthly)
      if (d.actualMonthly !== null) maxV = Math.max(maxV, d.actualMonthly)
    })
    return Math.max(0.04, Math.ceil(maxV * 20) / 20) // round up to next 5%
  }, [monthlyData])

  const yBar = useCallback(
    (val: number) => {
      const clamped = Math.max(0, Math.min(maxBarValue, val))
      return MARGIN.top + (1 - clamped / maxBarValue) * barInnerH
    },
    [maxBarValue, barInnerH],
  )

  const zeroBarY = yBar(0)

  const barGridTicks = useMemo(() => {
    const step = maxBarValue <= 0.1 ? 0.02 : maxBarValue <= 0.2 ? 0.05 : 0.1
    const ticks: number[] = []
    for (let v = 0; v <= maxBarValue + 0.0001; v += step) {
      ticks.push(v)
    }
    return ticks
  }, [maxBarValue])

  // Slot and bar sizing
  const slotWidth = chartWidth / Math.max(1, windowMonths.length - 1)
  const barWidth = Math.min(20, Math.max(5, (slotWidth - 8) / 2))

  // Variation Chart calculations
  const varChartHeight = 180
  const varInnerH = varChartHeight - MARGIN.top - MARGIN.bottom

  const maxAbsVar = useMemo(() => {
    let maxV = 0.02
    monthlyData.forEach((d) => {
      if (d.variationMonthly !== null) maxV = Math.max(maxV, Math.abs(d.variationMonthly))
    })
    return Math.max(0.025, Math.ceil(maxV * 40) / 40)
  }, [monthlyData])

  const yVarDomain = maxAbsVar
  const yVar = useCallback(
    (val: number) => {
      const clamped = Math.max(-yVarDomain, Math.min(yVarDomain, val))
      return MARGIN.top + ((yVarDomain - clamped) / (2 * yVarDomain)) * varInnerH
    },
    [yVarDomain, varInnerH],
  )

  const zeroVarY = yVar(0)

  const varGridTicks = useMemo(() => {
    const step = yVarDomain / 2
    return [+yVarDomain, +step, 0, -step, -yVarDomain]
  }, [yVarDomain])

  // Build variation line path
  const varLinePath = useMemo(() => {
    let path = ''
    let connected = false
    monthlyData.forEach((d) => {
      if (d.variationMonthly === null) {
        connected = false
        return
      }
      const px = x(d.index).toFixed(1)
      const py = yVar(d.variationMonthly).toFixed(1)
      path += `${connected ? ' L ' : 'M '}${px} ${py}`
      connected = true
    })
    return path
  }, [monthlyData, x, yVar])

  // Build variation area polygon
  const varAreaPolygon = useMemo(() => {
    const measured = monthlyData.filter((d) => d.variationMonthly !== null)
    if (measured.length < 2) return null
    const first = measured[0]
    const last = measured[measured.length - 1]
    let path = `M ${x(first.index).toFixed(1)} ${zeroVarY.toFixed(1)}`
    measured.forEach((d) => {
      path += ` L ${x(d.index).toFixed(1)} ${yVar(d.variationMonthly!).toFixed(1)}`
    })
    path += ` L ${x(last.index).toFixed(1)} ${zeroVarY.toFixed(1)} Z`
    return path
  }, [monthlyData, x, yVar, zeroVarY])

  return (
    <div ref={wrapRef} className="curvas-monthly-wrapper">
      {/* 1. TOP CHART: BAR CHART (Previsto Mensal x Realizado Mensal) */}
      <div className="curvas-monthly-card">
        <div className="curvas-deviation-header">
          <div className="curvas-deviation-titles">
            <span className="curvas-chart-sublabel">AVANÇO MENSAL POR COMPETÊNCIA ({perspectiveLabel.toUpperCase()})</span>
            <h4>Previsto Mensal vs. Realizado Mensal</h4>
          </div>
          <div className="curvas-bar-legend">
            <span className="curvas-bar-legend-item">
              <span className="curvas-bar-swatch planned" /> Previsto Mensal
            </span>
            <span className="curvas-bar-legend-item">
              <span className="curvas-bar-swatch actual" /> Realizado Mensal
            </span>
          </div>
        </div>

        <div className="curvas-chart-wrap" style={{ height: barChartHeight }}>
          <svg
            className="curvas-chart"
            viewBox={`0 0 ${W} ${barChartHeight}`}
            role="img"
            aria-label="Gráfico de Barras de Avanço Mensal"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <rect x="0" y="0" width={W} height={barChartHeight} fill="#ffffff" />

            {/* Gridlines */}
            {barGridTicks.map((v) => {
              const gy = yBar(v)
              return (
                <g key={`bar-grid-${v}`}>
                  <line
                    className="curvas-grid-line"
                    x1={MARGIN.left}
                    x2={W - MARGIN.right}
                    y1={gy}
                    y2={gy}
                    stroke="#e2e8f0"
                  />
                  <text className="curvas-axis-label" x={MARGIN.left - 8} y={gy + 4} textAnchor="end">
                    {formatPercent(v)}
                  </text>
                </g>
              )
            })}

            {/* X-axis lines & Month Ticks */}
            {windowMonths.map((m, i) => {
              const mx = x(i)
              const showMonth = i % labelStride === 0 || i === windowMonths.length - 1
              return (
                <g key={`bar-x-tick-${m}`}>
                  {showMonth && (
                    <line
                      className="curvas-grid-line vertical"
                      x1={mx}
                      x2={mx}
                      y1={MARGIN.top}
                      y2={barChartHeight - MARGIN.bottom}
                      stroke="#f8fafc"
                    />
                  )}
                  <line
                    className="curvas-axis-tick"
                    x1={mx}
                    x2={mx}
                    y1={barChartHeight - MARGIN.bottom}
                    y2={barChartHeight - MARGIN.bottom + 4}
                    stroke="#94a3b8"
                  />
                  {showMonth && (
                    <text
                      className="curvas-axis-label curvas-axis-month"
                      x={mx}
                      y={barChartHeight - MARGIN.bottom + 16}
                      textAnchor="end"
                      transform={`rotate(-45 ${mx} ${barChartHeight - MARGIN.bottom + 16})`}
                    >
                      {formatMonth(m)}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Baseline axis */}
            <line
              x1={MARGIN.left}
              x2={W - MARGIN.right}
              y1={zeroBarY}
              y2={zeroBarY}
              stroke="#64748b"
              strokeWidth={1.5}
            />

            {/* Vertical Bars for each month */}
            {monthlyData.map((d) => {
              const cx = x(d.index)
              const pVal = d.plannedMonthly
              const rVal = d.actualMonthly

              // Bar 1: Planned (left)
              const pBarH = pVal !== null ? Math.max(0, zeroBarY - yBar(pVal)) : 0
              const pBarX = cx - barWidth - 1
              const pBarY = zeroBarY - pBarH

              // Bar 2: Actual (right)
              const rBarH = rVal !== null ? Math.max(0, zeroBarY - yBar(rVal)) : 0
              const rBarX = cx + 1
              const rBarY = zeroBarY - rBarH

              const isHovered = hoverIndex === d.index

              return (
                <g key={`bars-${d.month}`} className={`curvas-month-bar-group ${isHovered ? 'hovered' : ''}`}>
                  {/* Planned Bar */}
                  {pVal !== null && pBarH > 0 && (
                    <g>
                      <rect
                        x={pBarX}
                        y={pBarY}
                        width={barWidth}
                        height={pBarH}
                        rx={2}
                        fill="#2563eb"
                        className="curvas-bar-rect planned"
                      />
                      {showValues && pBarH >= 12 && (
                        <text
                          x={pBarX + barWidth / 2}
                          y={pBarY - 4}
                          textAnchor="middle"
                          fill="#1d4ed8"
                          fontSize={8.5}
                          fontWeight={700}
                        >
                          {formatPercent(pVal)}
                        </text>
                      )}
                    </g>
                  )}

                  {/* Actual Bar */}
                  {rVal !== null && rBarH > 0 && (
                    <g>
                      <rect
                        x={rBarX}
                        y={rBarY}
                        width={barWidth}
                        height={rBarH}
                        rx={2}
                        fill="#16a34a"
                        className="curvas-bar-rect actual"
                      />
                      {showValues && rBarH >= 12 && (
                        <text
                          x={rBarX + barWidth / 2}
                          y={rBarY - 4}
                          textAnchor="middle"
                          fill="#15803d"
                          fontSize={8.5}
                          fontWeight={700}
                        >
                          {formatPercent(rVal)}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              )
            })}

            {/* Hover crosshair */}
            {hoverIndex !== null && (
              <line
                className="curvas-crosshair"
                x1={x(hoverIndex)}
                x2={x(hoverIndex)}
                y1={MARGIN.top}
                y2={barChartHeight - MARGIN.bottom}
                stroke="#64748b"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
          </svg>

          {/* Hover Tooltip */}
          {hoverIndex !== null && monthlyData[hoverIndex] && (
            <div
              className="curvas-tooltip below"
              style={{
                left: Math.max(50, Math.min(W - 140, x(hoverIndex))),
                top: 40,
              }}
            >
              <strong>{formatMonth(monthlyData[hoverIndex].month)}</strong>
              <div className="curvas-tooltip-row">
                <i style={{ backgroundColor: '#2563eb' }} />
                <span>Previsto do mês:</span>
                <b>{formatPercent(monthlyData[hoverIndex].plannedMonthly)}</b>
              </div>
              <div className="curvas-tooltip-row">
                <i style={{ backgroundColor: '#16a34a' }} />
                <span>Realizado do mês:</span>
                <b>{formatPercent(monthlyData[hoverIndex].actualMonthly)}</b>
              </div>
              {monthlyData[hoverIndex].variationMonthly !== null && (
                <div className="curvas-tooltip-row">
                  <i
                    style={{
                      backgroundColor:
                        monthlyData[hoverIndex].variationMonthly! >= 0 ? '#16a34a' : '#dc2626',
                    }}
                  />
                  <span>Variação do mês:</span>
                  <b className={monthlyData[hoverIndex].variationMonthly! < 0 ? 'negative' : 'positive'}>
                    {formatSignedPercent(monthlyData[hoverIndex].variationMonthly)}
                  </b>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. BOTTOM CHART: LINE CHART (Variação do Previsto e do Realizado no Mês) */}
      <div className="curvas-monthly-card">
        <div className="curvas-deviation-header">
          <div className="curvas-deviation-titles">
            <span className="curvas-chart-sublabel">VARIAÇÃO MENSAL ({perspectiveLabel.toUpperCase()})</span>
            <h4>Variação do Mês (Realizado do Mês − Previsto do Mês)</h4>
          </div>
          <div className="curvas-deviation-meta">
            <span className="curvas-variation-hint">
              Valores acima de 0% indicam que o avanço do mês superou o planejado.
            </span>
          </div>
        </div>

        <div className="curvas-chart-wrap" style={{ height: varChartHeight }}>
          <svg
            className="curvas-chart"
            viewBox={`0 0 ${W} ${varChartHeight}`}
            role="img"
            aria-label="Gráfico de Variação Mensal"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <rect x="0" y="0" width={W} height={varChartHeight} fill="#ffffff" />

            {/* Grid lines */}
            {varGridTicks.map((v) => {
              const gy = yVar(v)
              const isZero = Math.abs(v) < 0.0001
              return (
                <g key={`var-grid-${v}`}>
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
                    {formatSignedPercent(v)}
                  </text>
                </g>
              )
            })}

            {/* X-axis Month Ticks */}
            {windowMonths.map((m, i) => {
              const mx = x(i)
              const showMonth = i % labelStride === 0 || i === windowMonths.length - 1
              return (
                <g key={`var-x-tick-${m}`}>
                  {showMonth && (
                    <line
                      className="curvas-grid-line vertical"
                      x1={mx}
                      x2={mx}
                      y1={MARGIN.top}
                      y2={varChartHeight - MARGIN.bottom}
                      stroke="#f8fafc"
                    />
                  )}
                  <line
                    className="curvas-axis-tick"
                    x1={mx}
                    x2={mx}
                    y1={varChartHeight - MARGIN.bottom}
                    y2={varChartHeight - MARGIN.bottom + 4}
                    stroke="#94a3b8"
                  />
                  {showMonth && (
                    <text
                      className="curvas-axis-label curvas-axis-month"
                      x={mx}
                      y={varChartHeight - MARGIN.bottom + 16}
                      textAnchor="end"
                      transform={`rotate(-45 ${mx} ${varChartHeight - MARGIN.bottom + 16})`}
                    >
                      {formatMonth(m)}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Shaded area */}
            {varAreaPolygon && (
              <path d={varAreaPolygon} fill="rgba(37, 99, 235, 0.10)" className="curvas-variation-area" />
            )}

            {/* Zero line */}
            <line
              x1={MARGIN.left}
              x2={W - MARGIN.right}
              y1={zeroVarY}
              y2={zeroVarY}
              stroke="#64748b"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />

            {/* Line connecting variations */}
            {varLinePath && (
              <path
                d={varLinePath}
                fill="none"
                stroke="#0284c7"
                strokeWidth={2.4}
                className="curvas-variation-line"
              />
            )}

            {/* Points & badges */}
            {monthlyData.map((d) => {
              if (d.variationMonthly === null) return null
              const cx = x(d.index)
              const cy = yVar(d.variationMonthly)
              const isPos = d.variationMonthly >= 0
              const dotColor = isPos ? '#16a34a' : '#dc2626'
              const label = formatSignedPercent(d.variationMonthly)
              const badgeWidth = Math.max(26, label.length * 5.2 + 8)
              const badgeY = isPos ? cy - 18 : cy + 6

              return (
                <g key={`var-pt-${d.month}`}>
                  <circle cx={cx} cy={cy} r={3.6} fill={dotColor} stroke="#ffffff" strokeWidth={1.5} />
                  {showValues && (
                    <g className="curvas-point-label">
                      <rect
                        x={cx - badgeWidth / 2}
                        y={badgeY}
                        width={badgeWidth}
                        height={14}
                        rx={2}
                        fill={dotColor}
                      />
                      <text
                        x={cx}
                        y={badgeY + 10}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={8.5}
                        fontWeight={700}
                      >
                        {label}
                      </text>
                    </g>
                  )}
                </g>
              )
            })}

            {/* Hover crosshair */}
            {hoverIndex !== null && (
              <line
                className="curvas-crosshair"
                x1={x(hoverIndex)}
                x2={x(hoverIndex)}
                y1={MARGIN.top}
                y2={varChartHeight - MARGIN.bottom}
                stroke="#64748b"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
          </svg>
        </div>
      </div>
    </div>
  )
}
