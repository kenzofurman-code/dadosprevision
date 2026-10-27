import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { AlertCircle, RefreshCw, Upload } from 'lucide-react'
import './RealizadoProjecao.css'

type Escopo = 'todos' | 'material' | 'mao_de_obra'
type Medida = 'competencia' | 'financeiro'
type Modo = 'acumulado_reais' | 'acumulado_pct' | 'mensal_reais' | 'mensal_pct'

interface Serie {
  mes: string
  realizado: boolean
  competenciaMaterial: number
  competenciaMaoDeObra: number
  competenciaForaCronograma: number
  financeiroMaterial: number
  financeiroMaoDeObra: number
  financeiroForaCronograma: number
  teoricoCompetenciaMaterial: number
  teoricoCompetenciaMaoDeObra: number
  teoricoFinanceiroMaterial: number
  teoricoFinanceiroMaoDeObra: number
}

interface EtapaResumo {
  codigo_etapa: string
  nome: string
  projetado: number
  realizado: number
  saldoProjetado: number
  excedente: number
  pendente: number
  alerta: 'excedente' | 'pendente' | null
}

interface Resposta {
  obra: string | null
  motivo?: string
  corte: string
  cortePadrao: string
  seriesMensal?: Serie[]
  etapas?: EtapaResumo[]
  kpis?: {
    base: number
    realizadoAteCorte: number
    realizadoFinanceiroAteCorte: number
    teoricoAteCorte: number
    desvio: number
    desvioPct: number
    saldoProjetado: number
    excedente: number
    pendente: number
    foraDoCronograma: number
    custoFinalEstimado: number
    inicioTeorico: string | null
  }
  avisos?: string[]
  pagamentos?: { importado_em: string; arquivo: string | null } | null
}

interface Props {
  projectId: string
  scopeFilter: Escopo
}

const moeda = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0)
const pct = (v: number, casas = 1) => `${(v || 0).toFixed(casas).replace('.', ',')}%`
const rotuloMes = (m: string) => {
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${nomes[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`
}
const mesAnterior = (m: string) => {
  const [y, mm] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mm - 2, 15)).toISOString().slice(0, 7)
}

const COR_REAL = { competencia: '#f59e0b', financeiro: '#10b981' }
const COR_TEORICA = '#94a3b8'

export function RealizadoProjecao({ projectId, scopeFilter }: Props) {
  const [dados, setDados] = useState<Resposta | null>(null)
  const [corte, setCorte] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [medida, setMedida] = useState<Medida>('competencia')
  const [modo, setModo] = useState<Modo>('acumulado_reais')
  const [mostrarTeorica, setMostrarTeorica] = useState(true)
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const arquivoRef = useRef<HTMLInputElement | null>(null)

  const carregar = useCallback(async (mes?: string) => {
    setCarregando(true)
    setErro(null)
    try {
      const qs = new URLSearchParams({ projectId })
      if (mes) qs.set('corte', mes)
      const res = await fetch(`/api/curvas-financeiras/realizado?${qs}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Falha ao calcular o realizado.')
      setDados(json)
      setCorte(json.corte)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setCarregando(false)
    }
  }, [projectId])

  useEffect(() => {
    setDados(null)
    setCorte('')
    void carregar()
  }, [carregar])

  const enviarPlanilha = async (arquivo: File) => {
    setEnviando(true)
    setErro(null)
    try {
      const wb = XLSX.read(await arquivo.arrayBuffer())
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
      const res = await fetch('/api/curvas-financeiras/pagamentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, arquivo: arquivo.name, matriz }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Falha ao importar a planilha.')
      await carregar(corte || undefined)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviando(false)
      if (arquivoRef.current) arquivoRef.current.value = ''
    }
  }

  // Valores mensais do escopo e da medida escolhidos, com acumulados
  const linhas = useMemo(() => {
    const series = dados?.seriesMensal || []
    const valor = (s: Serie, teorico: boolean) => {
      const pre = teorico ? (medida === 'competencia' ? 'teoricoCompetencia' : 'teoricoFinanceiro') : medida
      const mat = s[`${pre}Material` as keyof Serie] as number
      const mo = s[`${pre}MaoDeObra` as keyof Serie] as number
      return scopeFilter === 'material' ? mat : scopeFilter === 'mao_de_obra' ? mo : mat + mo
    }
    let acR = 0
    let acT = 0
    return series.map((s) => {
      const real = valor(s, false)
      const teo = valor(s, true)
      acR += real
      acT += teo
      return { mes: s.mes, realizado: s.realizado, real, teo, acR, acT }
    })
  }, [dados, medida, scopeFilter])

  const base = dados?.kpis?.base || 0
  const emPct = modo.endsWith('pct')
  const acumulado = modo.startsWith('acumulado')
  const ponto = (l: (typeof linhas)[number], teorico: boolean) => {
    const v = acumulado ? (teorico ? l.acT : l.acR) : teorico ? l.teo : l.real
    return emPct ? (base ? (v / base) * 100 : 0) : v
  }

  const grafico = (() => {
    if (!linhas.length) return null
    const W = 1000
    const H = 360
    const padLeft = 86
    const padRight = 20
    const padTop = 20
    const padBottom = 40
    const plotW = W - padLeft - padRight
    const plotH = H - padTop - padBottom
    const valores = linhas.flatMap((l) => [ponto(l, false), ...(mostrarTeorica ? [ponto(l, true)] : [])])
    const maxY = Math.max(1, ...valores) * 1.05
    const getX = (i: number) => padLeft + (linhas.length === 1 ? plotW / 2 : (i * plotW) / (linhas.length - 1))
    const getY = (v: number) => padTop + plotH * (1 - v / maxY)
    const caminho = (idx: number[], teorico: boolean) =>
      idx.map((i, k) => `${k ? 'L' : 'M'}${getX(i).toFixed(1)},${getY(ponto(linhas[i], teorico)).toFixed(1)}`).join(' ')
    const iCorte = linhas.reduce((acc, l, i) => (l.realizado ? i : acc), -1)
    const todos = linhas.map((_, i) => i)
    return {
      W, H, padLeft, padTop, plotW, plotH, maxY, getX, getY, iCorte,
      teorica: caminho(todos, true),
      cheia: iCorte >= 0 ? caminho(todos.slice(0, iCorte + 1), false) : '',
      tracejada: caminho(todos.slice(Math.max(0, iCorte)), false),
    }
  })()

  const rotuloY = (v: number) => (emPct ? pct(v, acumulado ? 0 : 1) : moeda(v))

  const aoMover = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (!grafico || !svgRef.current) return
    const r = svgRef.current.getBoundingClientRect()
    const x = ((ev.clientX - r.left) / r.width) * grafico.W
    const i = Math.round(((x - grafico.padLeft) / grafico.plotW) * (linhas.length - 1))
    setHover(Math.max(0, Math.min(linhas.length - 1, i)))
  }

  if (dados && !dados.obra) {
    return (
      <section className="rpj-painel">
        <div className="rpj-aviso"><AlertCircle size={16} /> {dados.motivo}</div>
      </section>
    )
  }

  const k = dados?.kpis
  const corMedida = COR_REAL[medida]
  const realizadoKpi = k ? (medida === 'financeiro' ? k.realizadoFinanceiroAteCorte : k.realizadoAteCorte) : 0
  const alertas = (dados?.etapas || [])
    .filter((e) => e.alerta)
    .sort((a, b) => b.excedente + b.pendente - (a.excedente + a.pendente))
  const minCorte = k?.inicioTeorico ? mesAnterior(k.inicioTeorico) : undefined
  const l = hover !== null ? linhas[hover] : null

  return (
    <section className="rpj-painel">
      <div className="rpj-topo">
        <label className="rpj-campo">
          Realizado até
          <input
            type="month"
            value={corte}
            min={minCorte}
            max={dados?.cortePadrao}
            onChange={(e) => setCorte(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="curvas-fin-btn curvas-fin-btn-primary"
          onClick={() => void carregar(corte || undefined)}
          disabled={carregando}
        >
          <RefreshCw size={14} className={carregando ? 'spin' : ''} />
          Recalcular
        </button>
        {dados?.cortePadrao && corte !== dados.cortePadrao && (
          <button type="button" className="curvas-fin-btn curvas-fin-btn-secondary" onClick={() => void carregar(dados.cortePadrao)}>
            Último mês fechado
          </button>
        )}
        <div className="rpj-espaco" />
        <span className="rpj-carga">
          {dados?.pagamentos
            ? `Pagamentos: ${dados.pagamentos.arquivo || 'planilha'} (${new Date(dados.pagamentos.importado_em).toLocaleDateString('pt-BR')})`
            : 'Pagamentos: planilha não carregada'}
        </span>
        <input
          ref={arquivoRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => e.target.files?.[0] && void enviarPlanilha(e.target.files[0])}
        />
        <button
          type="button"
          className="curvas-fin-btn curvas-fin-btn-secondary"
          onClick={() => arquivoRef.current?.click()}
          disabled={enviando}
          title="Relatório Conciliação Financeira do Mega (xlsx)"
        >
          <Upload size={14} />
          {enviando ? 'Enviando…' : 'Carregar Conciliação Financeira'}
        </button>
      </div>

      {erro && <div className="rpj-aviso rpj-erro"><AlertCircle size={16} /> {erro}</div>}
      {(dados?.avisos || []).map((a) => (
        <div key={a} className="rpj-aviso"><AlertCircle size={16} /> {a}</div>
      ))}

      {k && (
        <div className="curvas-fin-kpis-grid">
          <div className="curvas-fin-kpi-card accent-amber">
            <div className="curvas-fin-kpi-label">Realizado até {rotuloMes(dados!.corte)}</div>
            <div className="curvas-fin-kpi-val">{moeda(realizadoKpi)}</div>
            <div className="curvas-fin-kpi-sub">
              {pct(base ? (realizadoKpi / base) * 100 : 0)} do custo projetado · {medida === 'financeiro' ? 'pago (conciliação)' : 'apropriado (Mega)'}
            </div>
          </div>
          <div className="curvas-fin-kpi-card accent-blue">
            <div className="curvas-fin-kpi-label">Teórico até o corte</div>
            <div className="curvas-fin-kpi-val">{moeda(k.teoricoAteCorte)}</div>
            <div className={`curvas-fin-kpi-sub ${k.desvio > 0 ? 'rpj-vermelho' : ''}`}>
              Desvio {moeda(k.desvio)} ({pct(k.desvioPct)})
            </div>
          </div>
          <div className="curvas-fin-kpi-card accent-emerald">
            <div className="curvas-fin-kpi-label">Saldo a projetar</div>
            <div className="curvas-fin-kpi-val">{moeda(k.saldoProjetado)}</div>
            <div className="curvas-fin-kpi-sub">Custo final estimado {moeda(k.custoFinalEstimado)}</div>
          </div>
          <div className={`curvas-fin-kpi-card ${k.excedente + k.pendente > 0 ? 'rpj-card-alerta' : 'accent-teal'}`}>
            <div className="curvas-fin-kpi-label">Excedente / pendente</div>
            <div className={`curvas-fin-kpi-val ${k.excedente + k.pendente > 0 ? 'rpj-vermelho' : ''}`}>
              {moeda(k.excedente)} / {moeda(k.pendente)}
            </div>
            <div className="curvas-fin-kpi-sub">Fora do cronograma {moeda(k.foraDoCronograma)}</div>
          </div>
        </div>
      )}

      {grafico && (
        <div className="curvas-fin-chart-panel">
          <div className="rpj-controles">
            <div className="curvas-fin-toggle-pill">
              {(['competencia', 'financeiro'] as Medida[]).map((m) => (
                <button key={m} type="button" className={`curvas-fin-pill-btn ${medida === m ? 'active' : ''}`} onClick={() => setMedida(m)}>
                  {m === 'competencia' ? 'Competência' : 'Financeiro'}
                </button>
              ))}
            </div>
            <div className="curvas-fin-toggle-pill">
              {([
                ['acumulado_reais', 'Acumulado (R$)'],
                ['acumulado_pct', 'Acumulado (%)'],
                ['mensal_reais', 'Mensal (R$)'],
                ['mensal_pct', 'Mensal (%)'],
              ] as [Modo, string][]).map(([m, rotulo]) => (
                <button key={m} type="button" className={`curvas-fin-pill-btn ${modo === m ? 'active' : ''}`} onClick={() => setModo(m)}>
                  {rotulo}
                </button>
              ))}
            </div>
            <label className="rpj-check">
              <input type="checkbox" checked={mostrarTeorica} onChange={(e) => setMostrarTeorica(e.target.checked)} />
              Mostrar teórica
            </label>
          </div>

          <div className="rpj-legenda">
            <span><i style={{ background: corMedida }} /> Realizado (até o corte)</span>
            <span><i className="rpj-tracejado" style={{ borderColor: corMedida }} /> Projeção</span>
            {mostrarTeorica && <span><i style={{ background: COR_TEORICA }} /> Teórica</span>}
            {l && (
              <span className="rpj-hover">
                <strong>{rotuloMes(l.mes)}</strong> · {l.realizado ? 'realizado' : 'projeção'} {rotuloY(ponto(l, false))} · teórica{' '}
                {rotuloY(ponto(l, true))}
              </span>
            )}
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${grafico.W} ${grafico.H}`}
            className="curvas-fin-chart-svg"
            onMouseMove={aoMover}
            onMouseLeave={() => setHover(null)}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((p) => {
              const y = grafico.padTop + grafico.plotH * (1 - p)
              return (
                <g key={p}>
                  <line x1={grafico.padLeft} x2={grafico.padLeft + grafico.plotW} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="4 4" />
                  <text x={grafico.padLeft - 8} y={y + 4} textAnchor="end" fontSize="10.5" fill="currentColor" opacity="0.55">
                    {rotuloY(grafico.maxY * p)}
                  </text>
                </g>
              )
            })}
            {linhas.map((ln, i) => {
              const passo = Math.max(1, Math.ceil(linhas.length / 16))
              if (i % passo !== 0 && i !== linhas.length - 1) return null
              return (
                <text key={ln.mes} x={grafico.getX(i)} y={grafico.padTop + grafico.plotH + 20} textAnchor="middle" fontSize="10.5" fill="currentColor" opacity="0.6">
                  {rotuloMes(ln.mes)}
                </text>
              )
            })}
            {grafico.iCorte >= 0 && (
              <g>
                <line
                  x1={grafico.getX(grafico.iCorte)} x2={grafico.getX(grafico.iCorte)}
                  y1={grafico.padTop} y2={grafico.padTop + grafico.plotH}
                  stroke="#dc2626" strokeOpacity="0.6" strokeDasharray="2 3"
                />
                <text x={grafico.getX(grafico.iCorte) + 4} y={grafico.padTop + 12} fontSize="10.5" fill="#dc2626">
                  Realizado até {rotuloMes(linhas[grafico.iCorte].mes)}
                </text>
              </g>
            )}
            {mostrarTeorica && <path d={grafico.teorica} fill="none" stroke={COR_TEORICA} strokeWidth="2" />}
            {grafico.cheia && <path d={grafico.cheia} fill="none" stroke={corMedida} strokeWidth="3" />}
            <path d={grafico.tracejada} fill="none" stroke={corMedida} strokeWidth="2.5" strokeDasharray="7 5" />
            {hover !== null && (
              <line
                x1={grafico.getX(hover)} x2={grafico.getX(hover)}
                y1={grafico.padTop} y2={grafico.padTop + grafico.plotH}
                stroke="currentColor" strokeOpacity="0.35"
              />
            )}
          </svg>
        </div>
      )}

      {alertas.length > 0 && (
        <div className="rpj-bloco">
          <h4 className="rpj-vermelho">Etapas em alerta ({alertas.length})</h4>
          <table className="rpj-tabela">
            <thead>
              <tr><th>Etapa</th><th>Situação</th><th>Projetado</th><th>Realizado</th><th>Excedente</th><th>Pendente</th></tr>
            </thead>
            <tbody>
              {alertas.map((e) => (
                <tr key={e.codigo_etapa} className="rpj-linha-alerta">
                  <td><code>{e.codigo_etapa}</code> {e.nome}</td>
                  <td>{e.alerta === 'excedente' ? 'Gastou mais que o projetado' : 'Saldo sem físico pela frente'}</td>
                  <td>{moeda(e.projetado)}</td>
                  <td>{moeda(e.realizado)}</td>
                  <td>{e.excedente ? moeda(e.excedente) : '–'}</td>
                  <td>{e.pendente ? moeda(e.pendente) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {linhas.length > 0 && (
        <div className="rpj-bloco">
          <h4>Teórico x realizado + projeção ({medida === 'competencia' ? 'competência' : 'financeiro'})</h4>
          <div className="rpj-rolagem">
            <table className="rpj-tabela">
              <thead>
                <tr>
                  <th>Mês</th><th>Teórico</th><th>Realizado / projeção</th><th>Teórico acum.</th><th>Realizado acum.</th>
                  <th>Diferença acum.</th><th>Dif. % do custo</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((ln) => {
                  const dif = ln.acR - ln.acT
                  return (
                    <tr key={ln.mes} className={ln.mes === dados?.corte ? 'rpj-linha-corte' : ln.realizado ? '' : 'rpj-linha-projecao'}>
                      <td>{rotuloMes(ln.mes)}</td>
                      <td>{moeda(ln.teo)}</td>
                      <td>{moeda(ln.real)}</td>
                      <td>{moeda(ln.acT)}</td>
                      <td>{moeda(ln.acR)}</td>
                      <td className={dif > 0.5 ? 'rpj-vermelho' : ''}>{moeda(dif)}</td>
                      <td>{pct(base ? (dif / base) * 100 : 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
