import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent } from "react"
import {
  achaDef,
  larguraDe,
  tracoDe,
  fmt,
  rotMes,
  type DefCurva,
  type Ponto,
} from "../../lib/curvas-utils"

interface Props {
  disp: Record<string, Ponto[]>
  defs: DefCurva[]
  meses: string[]
  versoesOn: Set<string>
  versaoFoco: string | null
  mostrarMarcas: boolean
  mostrarValores: boolean
  onToggleFoco: (v: string | null) => void
  onZoom: (de: number, ate: number) => void
  onResetZoom: () => void
}

const M = { t: 32, r: 36, b: 64, l: 56 }
const LIMIAR_ARRASTO = 6

interface Serie {
  v: string
  pts: Ponto[]
  cor: string
}

interface Geo {
  W: number
  H: number
  ix: Record<string, number>
  topo: number
  X: (i: number) => number
  Y: (p: number) => number
}

export function AdvanceChartSvg({
  disp,
  defs,
  meses,
  versoesOn,
  versaoFoco,
  mostrarMarcas,
  mostrarValores,
  onToggleFoco,
  onZoom,
  onResetZoom,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ W: 0, H: 0 })
  const [hover, setHover] = useState<{ i: number; y: number; noEixo: boolean } | null>(null)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const inicioRef = useRef<number | null>(null)
  const arrastouRef = useRef(false)

  useLayoutEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const r0 = node.getBoundingClientRect()
    if (r0.width && r0.height) setSize({ W: r0.width, H: r0.height })
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ W: r.width, H: r.height })
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setHover(null)
  }, [disp, meses, versoesOn, mostrarMarcas, mostrarValores])

  const series: Serie[] = useMemo(() => {
    const dentro = new Set(meses)
    return defs
      .filter((d) => versoesOn.has(d.nome) && disp[d.nome])
      .map((d) => ({ v: d.nome, pts: disp[d.nome].filter((p) => dentro.has(p[0])), cor: d.cor }))
      .filter((s) => s.pts.length > 0)
  }, [disp, defs, meses, versoesOn])

  const geo = useMemo<Geo | null>(() => {
    const { W, H } = size
    if (!W || !H || !series.length || !meses.length) return null
    const ix = Object.fromEntries(meses.map((m, i) => [m, i]))
    const maxV = Math.max(...series.flatMap((s) => s.pts.map((p) => p[1])), 0.05)
    const topo = Math.min(1.05, Math.ceil(maxV * 10) / 10 + (maxV > 0.95 ? 0.05 : 0.02))
    const X = (i: number) => M.l + (meses.length < 2 ? 0 : (i * (W - M.l - M.r)) / (meses.length - 1))
    const Y = (p: number) => M.t + (1 - p / topo) * (H - M.t - M.b)
    return { W, H, ix, topo, X, Y }
  }, [size, series, meses])

  const indiceEm = useCallback(
    (x: number) => {
      if (!geo || meses.length < 2) return 0
      const larg = geo.W - M.l - M.r
      if (larg <= 0) return 0
      const i = Math.round(((x - M.l) * (meses.length - 1)) / larg)
      return Math.min(Math.max(i, 0), meses.length - 1)
    },
    [geo, meses],
  )

  const handleMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (!geo) return
      const { W, H, X } = geo
      const svg = svgRef.current
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top

      if (inicioRef.current !== null) {
        if (Math.abs(x - inicioRef.current) >= LIMIAR_ARRASTO) arrastouRef.current = true
        if (arrastouRef.current) {
          setHover(null)
          setSel({ a: indiceEm(inicioRef.current), b: indiceEm(x) })
        }
        return
      }

      if (x < M.l - 14 || x > W - M.r + 14 || y > H - 2) {
        setHover(null)
        return
      }
      let i = 0
      let melhor = Number.POSITIVE_INFINITY
      meses.forEach((_, k) => {
        const d = Math.abs(X(k) - x)
        if (d < melhor) {
          melhor = d
          i = k
        }
      })
      setHover({ i, y, noEixo: y >= H - M.b })
    },
    [geo, meses, indiceEm],
  )

  function iniciaArrasto(e: PointerEvent<SVGSVGElement>) {
    arrastouRef.current = false
    if (!geo || meses.length < 2 || e.button !== 0) return
    const svg = svgRef.current
    if (!svg) return
    const x = e.clientX - svg.getBoundingClientRect().left
    if (x < M.l - 14 || x > geo.W - M.r + 14) return
    inicioRef.current = x
    try {
      svg.setPointerCapture(e.pointerId)
    } catch {
      // continua sem captura
    }
  }

  function terminaArrasto(e: PointerEvent<SVGSVGElement>) {
    const inicio = inicioRef.current
    inicioRef.current = null
    const svg = svgRef.current
    if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId)
    const faixa = sel
    setSel(null)
    if (inicio === null || !arrastouRef.current || !faixa) return
    const de = Math.min(faixa.a, faixa.b)
    const ate = Math.max(faixa.a, faixa.b)
    if (ate > de) onZoom(de, ate)
  }

  return (
    <div ref={wrapRef} className="curvas-plot-body">
      <svg
        ref={svgRef}
        className="curvas-chart-svg"
        role="img"
        aria-label="Gráfico de Curvas de Avanço Físico-Financeiro"
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
        onPointerDown={iniciaArrasto}
        onPointerUp={terminaArrasto}
        onPointerCancel={terminaArrasto}
        onDoubleClick={onResetZoom}
        onClick={() => {
          if (arrastouRef.current) return
          if (versaoFoco) onToggleFoco(null)
        }}
      >
        {geo && <ChartGrid geo={geo} meses={meses} hover={hover} />}
        {geo && (
          <ChartLines
            geo={geo}
            series={series}
            defs={defs}
            versaoFoco={versaoFoco}
            mostrarMarcas={mostrarMarcas}
            mostrarValores={mostrarValores}
            onToggleFoco={onToggleFoco}
          />
        )}
        {geo && hover && <CrosshairOverlay geo={geo} series={series} meses={meses} hover={hover} />}
        {geo && sel && sel.a !== sel.b && (
          <rect
            className="curvas-brush"
            x={Math.min(geo.X(sel.a), geo.X(sel.b))}
            width={Math.abs(geo.X(sel.b) - geo.X(sel.a))}
            y={M.t}
            height={Math.max(0, geo.H - M.t - M.b)}
          />
        )}
      </svg>
      {geo && hover && !hover.noEixo && (
        <ReadoutCard geo={geo} series={series} defs={defs} meses={meses} hover={hover} />
      )}
      {!series.length && (
        <div className="curvas-empty-state">
          Nenhuma curva selecionada.
          <br />
          Ligue ao menos uma versão no painel lateral à esquerda.
        </div>
      )}
    </div>
  )
}

function ChartGrid({
  geo,
  meses,
  hover,
}: {
  geo: Geo
  meses: string[]
  hover: { i: number } | null
}) {
  const { W, H, topo, X, Y } = geo
  const passo = topo <= 0.25 ? 0.05 : 0.1
  const linhasH: number[] = []
  for (let p = 0; p <= topo + 1e-9; p += passo) linhasH.push(p)

  const alvo = Math.max(4, Math.floor((W - M.l - M.r) / 78))
  const salto = Math.max(1, Math.ceil(meses.length / alvo))
  const denso = (W - M.l - M.r) / Math.max(1, meses.length - 1) < 11
  const yb = H - M.b

  return (
    <g className="curvas-grid-group">
      {linhasH.map((p, k) => (
        <g key={"h" + k}>
          <line className="curvas-gridline" x1={M.l} x2={W - M.r} y1={Y(p)} y2={Y(p)} />
          <text className="curvas-axis-text" x={M.l - 9} y={Y(p) + 4} textAnchor="end">
            {Math.round(p * 100)}%
          </text>
        </g>
      ))}
      {meses.map((m, i) => {
        const x = X(i)
        const mostra = !(i % salto) || i === meses.length - 1
        const ativo = hover?.i === i
        return (
          <g key={"x" + i}>
            <line className="curvas-tick" x1={x} x2={x} y1={yb} y2={yb + 5} />
            {mostra && <line className="curvas-gridline" x1={x} x2={x} y1={M.t} y2={yb} />}
            <text
              className={"curvas-axis-text vert" + (ativo ? " ativo" : "")}
              x={x}
              y={yb + 10}
              textAnchor="end"
              fontSize={denso ? 9 : 11}
              transform={`rotate(-90 ${x.toFixed(1)} ${yb + 10})`}
            >
              {rotMes(m)}
            </text>
          </g>
        )
      })}
      <line className="curvas-axis-line" x1={M.l} x2={W - M.r} y1={yb} y2={yb} />
    </g>
  )
}

function ChartLines({
  geo,
  series,
  defs,
  versaoFoco,
  mostrarMarcas,
  mostrarValores,
  onToggleFoco,
}: {
  geo: Geo
  series: Serie[]
  defs: DefCurva[]
  versaoFoco: string | null
  mostrarMarcas: boolean
  mostrarValores: boolean
  onToggleFoco: (v: string | null) => void
}) {
  const { W, ix, X, Y } = geo
  const passoPx = (W - M.l - M.r) / Math.max(1, Object.keys(ix).length - 1)
  const st = Math.max(1, Math.ceil(34 / Math.max(passoPx, 1)))

  return (
    <g className="curvas-lines-group">
      {series.map((s) => {
        const foco = versaoFoco === s.v
        const apagada = versaoFoco && !foco
        const d = s.pts.map((p, i) => (i ? "L" : "M") + X(ix[p[0]]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ")
        return (
          <g key={s.v}>
            <path
              className={"curvas-path" + (apagada ? " dim" : "")}
              d={d}
              stroke={s.cor}
              strokeDasharray={tracoDe(defs, s.v)}
              strokeWidth={larguraDe(defs, s.v) + (foco ? 1.5 : 0)}
            />
            {/* Linha invisivel mais grossa para clique facil */}
            <path
              className="curvas-click-target"
              d={d}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFoco(versaoFoco === s.v ? null : s.v)
              }}
            />
            {mostrarMarcas &&
              s.pts.map((p, i) => (
                <circle
                  key={"m" + i}
                  cx={X(ix[p[0]])}
                  cy={Y(p[1])}
                  r={foco ? 3.8 : 2.8}
                  fill={s.cor}
                />
              ))}
            {mostrarValores &&
              s.pts.map((p, i) => {
                if (i % st && i !== s.pts.length - 1) return null
                return (
                  <text
                    key={"v" + i}
                    className="curvas-point-label"
                    x={X(ix[p[0]])}
                    y={Y(p[1]) - 8}
                    textAnchor="middle"
                    fill={s.cor}
                  >
                    {(p[1] * 100).toFixed(1).replace(".", ",")}%
                  </text>
                )
              })}
          </g>
        )
      })}
    </g>
  )
}

function CrosshairOverlay({
  geo,
  series,
  meses,
  hover,
}: {
  geo: Geo
  series: Serie[]
  meses: string[]
  hover: { i: number }
}) {
  const { W, H, X, Y } = geo
  const i = hover.i
  const mes = meses[i]
  const px = Math.min(Math.max(X(i), M.l + 30), W - M.r - 30)

  const marcas: { y: number; cor: string; txt: string }[] = []
  series.forEach((s) => {
    const p = s.pts.find((p) => p[0] === mes)
    if (p) marcas.push({ y: Y(p[1]), cor: s.cor, txt: fmt(p[1]) })
  })
  marcas.sort((a, b) => a.y - b.y)
  for (let k = 1; k < marcas.length; k++) {
    if (marcas[k].y - marcas[k - 1].y < 14) marcas[k].y = marcas[k - 1].y + 14
  }
  const paraEsq = X(i) > W - M.r - 80

  return (
    <g className="curvas-crosshair">
      <line x1={X(i)} x2={X(i)} y1={M.t - 5} y2={H - M.b + 4} />
      <g className="curvas-pino">
        <rect x={px - 30} y={M.t - 22} width={60} height={18} rx={4} />
        <text x={px} y={M.t - 9} textAnchor="middle">
          {rotMes(mes)}
        </text>
      </g>
      {series.map((s) => {
        const p = s.pts.find((p) => p[0] === mes)
        if (!p) return null
        return <circle key={"c" + s.v} cx={X(i)} cy={Y(p[1])} r={4.8} fill={s.cor} stroke="#fff" strokeWidth={1.5} />
      })}
      {marcas.map((m, k) => {
        const lx = paraEsq ? X(i) - 10 - 56 : X(i) + 10
        return (
          <g className="curvas-rot" key={"r" + k}>
            <rect x={lx} y={m.y - 8} width={56} height={16} rx={3} fill={m.cor} />
            <text className="curvas-rotval" x={lx + 28} y={m.y + 4} textAnchor="middle">
              {m.txt}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function ReadoutCard({
  geo,
  series,
  defs,
  meses,
  hover,
}: {
  geo: Geo
  series: Serie[]
  defs: DefCurva[]
  meses: string[]
  hover: { i: number; y: number }
}) {
  const { W, H, X } = geo
  const i = hover.i
  const mes = meses[i]

  const linhas = series.map((s) => {
    const p = s.pts.find((p) => p[0] === mes)
    return { v: s.v, val: p ? p[1] : null, cor: s.cor }
  })

  const valDe = (v: string) => linhas.find((l) => l.v === v)?.val ?? null

  const gaps = linhas.map((l) => {
    const alvo = achaDef(defs, l.v)?.ref
    const ref = alvo ? valDe(alvo) : null
    if (l.val === null || ref == null) return null
    const d = ref - l.val
    return {
      txt: "(" + (d >= 0 ? "+" : "−") + fmt(Math.abs(d)) + ")",
      cls: d < -0.0001 ? "atraso" : d > 0.0001 ? "adianto" : "neutro",
    }
  })
  const temGap = gaps.some(Boolean)

  const rw = 250
  const rh = 36 + linhas.length * 22 + (temGap ? 26 : 0)
  let lx = X(i) + 20
  if (lx + rw > W - 10) lx = X(i) - rw - 20
  const ly = Math.max(10, Math.min(Math.max(hover.y - rh / 2, M.t), H - M.b - rh))

  return (
    <div className="curvas-readout" role="status" aria-live="polite" style={{ left: lx, top: ly }}>
      <div className="curvas-ro-date">{rotMes(mes)}</div>
      {linhas.map((l, k) => (
        <div className={"curvas-ro-row" + (l.val === null ? " gap" : "")} key={l.v}>
          <i style={{ background: l.cor }} />
          <span>{l.v}</span>
          <b>{l.val === null ? "—" : fmt(l.val)}</b>
          {gaps[k] && <em className={gaps[k]!.cls}>{gaps[k]!.txt}</em>}
        </div>
      ))}
      {temGap && <div className="curvas-ro-nota">( ) realizado − planejado</div>}
    </div>
  )
}
