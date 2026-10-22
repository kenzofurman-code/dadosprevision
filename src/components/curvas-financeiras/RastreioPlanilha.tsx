import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import {
  LINHAS, ROTULO_LINHA, rotuloMes, tracar, valoresDaEtapa,
  type Celula, type EtapaRastreio, type Linha, type Ligacao,
} from './rastreio'
import './RastreioPlanilha.css'

interface Props {
  etapas: EtapaRastreio[]
  hierarquia: Array<{ codigo: string; nome: string; nivel: number }>
  meses: string[]
  mostrarVazias: boolean
}

interface Selecao extends Celula {
  etapa: string
}

const COR = { MATERIAL: '#d97706', MAO_DE_OBRA: '#7c3aed' } as const
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const fmt = (v: number | undefined) => (!v || Math.abs(v) < 0.5 ? '' : inteiro.format(v))
const curto = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.', ',')} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : inteiro.format(v))
const reais = (v: number) => `R$ ${inteiro.format(v)}`
const chaveCel = (etapa: string, c: Celula) => `${etapa}|${c.linha}|${c.mes}`

interface Seta {
  d: string
  cor: string
  largura: number
  rotulo: string
  lx: number
  ly: number
  fraca: boolean
}

export function RastreioPlanilha({ etapas, hierarquia, meses, mostrarVazias }: Props) {
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Selecao | null>(null)
  const [hover, setHover] = useState<Selecao | null>(null)
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())
  const [setas, setSetas] = useState<Seta[]>([])
  const areaRef = useRef<HTMLDivElement | null>(null)

  const nomesMae = useMemo(() => new Map(hierarquia.map((h) => [h.codigo, h])), [hierarquia])

  // Etapas nível 5 com valores por linha e mês, filtradas (com valor / busca) e ordenadas pela EAP
  const blocos = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return etapas
      .map((et) => {
        const codigo = et.codigo_prevision || et.codigo_etapa
        const valores = valoresDaEtapa(et)
        const total = LINHAS.reduce((s, l) => s + [...valores[l.id].values()].reduce((a, b) => a + Math.abs(b), 0), 0)
        return { et, codigo, valores, total }
      })
      .filter((b) => mostrarVazias || b.total >= 0.5)
      .filter((b) => !termo || b.codigo.toLowerCase().includes(termo) || b.et.nome.toLowerCase().includes(termo))
      .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
  }, [etapas, busca, mostrarVazias])

  const etapaPorCodigo = useMemo(() => new Map(blocos.map((b) => [b.codigo, b.et])), [blocos])

  const tracoSel = useMemo(() => {
    const et = sel && etapaPorCodigo.get(sel.etapa)
    return et && sel ? tracar(et, sel) : null
  }, [sel, etapaPorCodigo])

  const tracoHover = useMemo(() => {
    if (!hover || (sel && chaveCel(sel.etapa, sel) === chaveCel(hover.etapa, hover))) return null
    const et = etapaPorCodigo.get(hover.etapa)
    return et ? tracar(et, hover) : null
  }, [hover, sel, etapaPorCodigo])

  // Células destacadas: a selecionada (vermelho) e as de origem/destino (cor do tipo)
  const destaques = useMemo(() => {
    const m = new Map<string, string>()
    if (sel && tracoSel) {
      for (const l of tracoSel.ligacoes) {
        m.set(chaveCel(sel.etapa, l.de), COR[l.tipo])
        m.set(chaveCel(sel.etapa, l.para), COR[l.tipo])
      }
      m.set(chaveCel(sel.etapa, sel), '#b3261e')
    }
    return m
  }, [sel, tracoSel])

  // Desenha as setas medindo as células no DOM (coordenadas relativas à área da tabela)
  const medir = useCallback(() => {
    const area = areaRef.current
    if (!area) return
    const base = area.getBoundingClientRect()
    const desenhar = (etapa: string, ligacoes: Ligacao[], fraca: boolean, valorRef: number): Seta[] => {
      const maior = Math.max(...ligacoes.map((l) => l.valor), 1)
      return ligacoes
        .filter((l) => l.valor >= valorRef * 0.01)
        .flatMap((l) => {
          const a = area.querySelector<HTMLElement>(`[data-cel="${chaveCel(etapa, l.de)}"]`)
          const b = area.querySelector<HTMLElement>(`[data-cel="${chaveCel(etapa, l.para)}"]`)
          if (!a || !b) return []
          const ra = a.getBoundingClientRect()
          const rb = b.getBoundingClientRect()
          const x1 = ra.left - base.left + ra.width / 2
          const y1 = ra.top - base.top + ra.height / 2
          const x2 = rb.left - base.left + rb.width / 2
          const y2 = rb.top - base.top + rb.height / 2
          const cx = (x1 + x2) / 2 + (y2 - y1) * 0.25
          const cy = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.15
          return [{
            d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`,
            cor: COR[l.tipo],
            largura: 1.5 + 2.5 * (l.valor / maior),
            rotulo: curto(l.valor),
            lx: (x1 + 2 * cx + x2) / 4,
            ly: (y1 + 2 * cy + y2) / 4,
            fraca,
          }]
        })
    }
    const valorDe = (s: Selecao | null) => {
      if (!s) return 0
      const b = blocos.find((x) => x.codigo === s.etapa)
      return b?.valores[s.linha].get(s.mes) || 0
    }
    setSetas([
      ...(sel && tracoSel ? desenhar(sel.etapa, tracoSel.ligacoes, false, valorDe(sel)) : []),
      ...(hover && tracoHover ? desenhar(hover.etapa, tracoHover.ligacoes, true, valorDe(hover)) : []),
    ])
  }, [sel, tracoSel, hover, tracoHover, blocos])

  useLayoutEffect(() => {
    medir()
  }, [medir, recolhidos, meses])

  useEffect(() => {
    window.addEventListener('resize', medir)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('keydown', onKey)
    }
  }, [medir])

  // Linhas da tabela: cabeçalhos das etapas-mãe (quando mudam) + blocos de 5 linhas por etapa
  const linhasTabela = useMemo(() => {
    const itens: Array<{ tipo: 'mae'; codigo: string; nome: string; nivel: number } | { tipo: 'etapa'; bloco: (typeof blocos)[number] }> = []
    const vistas = new Set<string>()
    for (const b of blocos) {
      const segs = b.codigo.split('.')
      let oculto = false
      for (let k = 1; k < segs.length; k++) {
        const cod = segs.slice(0, k).join('.')
        const mae = nomesMae.get(cod)
        if (!mae) continue
        if (!oculto && !vistas.has(cod)) {
          vistas.add(cod)
          itens.push({ tipo: 'mae', codigo: cod, nome: mae.nome, nivel: Number(mae.nivel) })
        }
        if (recolhidos.has(cod)) oculto = true
      }
      if (!oculto) itens.push({ tipo: 'etapa', bloco: b })
    }
    return itens
  }, [blocos, nomesMae, recolhidos])

  const alternarMae = (cod: string) =>
    setRecolhidos((r) => {
      const n = new Set(r)
      if (n.has(cod)) n.delete(cod)
      else n.add(cod)
      return n
    })

  const valorSel = sel ? blocos.find((b) => b.codigo === sel.etapa)?.valores[sel.linha].get(sel.mes) || 0 : 0
  const nomeSel = sel ? etapaPorCodigo.get(sel.etapa)?.nome : ''

  return (
    <div className="rp-wrap">
      <div className="rp-topo">
        <input
          type="search"
          placeholder="Buscar etapa (código ou nome)…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <span className="rp-legenda">
          <span style={{ color: COR.MATERIAL }}>■ Material</span> <span style={{ color: COR.MAO_DE_OBRA }}>■ Mão de obra</span>
          {' · '}Passe o mouse para ver, clique para fixar · Esc limpa
        </span>
      </div>

      <div className="rp-corpo">
        <div className="rp-scroll">
          <div className="rp-area" ref={areaRef}>
            <table className="rp-tabela">
              <thead>
                <tr>
                  <th className="rp-fixa rp-c1">Etapa</th>
                  <th className="rp-fixa rp-c2"></th>
                  {meses.map((m) => <th key={m}>{rotuloMes(m)}</th>)}
                </tr>
              </thead>
              <tbody>
                {linhasTabela.length === 0 && (
                  <tr><td colSpan={meses.length + 2} className="rp-vazio">Nenhuma etapa com valor para o filtro atual.</td></tr>
                )}
                {linhasTabela.map((item) => {
                  if (item.tipo === 'mae') {
                    const recolhido = recolhidos.has(item.codigo)
                    return (
                      <tr key={`m-${item.codigo}`} className={`rp-mae rp-n${item.nivel}`} onClick={() => alternarMae(item.codigo)}>
                        <td className="rp-fixa rp-c1" colSpan={2} style={{ paddingLeft: 4 + (item.nivel - 1) * 10 }}>
                          {recolhido ? <ChevronRight size={11} /> : <ChevronDown size={11} />} <span className="rp-cod">{item.codigo}</span> {item.nome}
                        </td>
                        <td colSpan={meses.length}></td>
                      </tr>
                    )
                  }
                  const { bloco } = item
                  return (
                    <Fragment key={bloco.codigo}>
                      {LINHAS.map((l, i) => (
                        <tr key={l.id} className={`rp-l-${l.id} ${i === LINHAS.length - 1 ? 'rp-fim' : ''}`}>
                          {i === 0 && (
                            <td className="rp-fixa rp-c1 rp-nome" rowSpan={LINHAS.length} title={`${bloco.codigo} ${bloco.et.nome}`}>
                              <span className="rp-cod">{bloco.codigo}</span>
                              <br />
                              {bloco.et.nome}
                            </td>
                          )}
                          <td className="rp-fixa rp-c2">{l.rotulo}</td>
                          {meses.map((m) => {
                            const cel: Selecao = { etapa: bloco.codigo, linha: l.id as Linha, mes: m }
                            const k = chaveCel(bloco.codigo, cel)
                            const v = bloco.valores[l.id].get(m)
                            const cor = destaques.get(k)
                            return (
                              <td
                                key={m}
                                data-cel={k}
                                className={v ? 'rp-val' : ''}
                                style={cor ? { outline: `2px solid ${cor}`, outlineOffset: -2, fontWeight: 700 } : undefined}
                                onMouseEnter={() => v && setHover(cel)}
                                onMouseLeave={() => setHover(null)}
                                onClick={() => v && setSel(cel)}
                              >
                                {fmt(v)}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <svg className="rp-svg" width="100%" height="100%">
              <defs>
                {Object.entries(COR).map(([t, c]) => (
                  <marker key={t} id={`rp-ponta-${t}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill={c} />
                  </marker>
                ))}
              </defs>
              {setas.map((s, i) => (
                <g key={i} opacity={s.fraca ? 0.35 : 1}>
                  <path
                    d={s.d}
                    stroke={s.cor}
                    strokeWidth={s.largura}
                    fill="none"
                    markerEnd={`url(#rp-ponta-${s.cor === COR.MATERIAL ? 'MATERIAL' : 'MAO_DE_OBRA'})`}
                  />
                  {!s.fraca && (
                    <text x={s.lx} y={s.ly} fill={s.cor} className="rp-rotulo">{s.rotulo}</text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        </div>

        {sel && tracoSel && (
          <aside className="rp-painel">
            <div className="rp-painel-topo">
              <div>
                <strong>{ROTULO_LINHA[sel.linha]} · {rotuloMes(sel.mes)}</strong>
                <div className="rp-sub">{sel.etapa} {nomeSel}</div>
                <div className="rp-valor">{reais(valorSel)}</div>
              </div>
              <button type="button" className="rp-fechar" onClick={() => setSel(null)} title="Limpar (Esc)">
                <X size={14} />
              </button>
            </div>
            {tracoSel.secoes.map((s) => (
              <div key={s.titulo} className="rp-secao">
                <div className="rp-secao-titulo">{s.titulo}</div>
                <table>
                  <tbody>
                    {s.linhas.map((l, i) => (
                      <tr
                        key={i}
                        className={l.alvo ? 'rp-clicavel' : ''}
                        onClick={() => l.alvo && setSel({ etapa: sel.etapa, ...l.alvo })}
                        title={l.alvo ? 'Clique para continuar o rastreio' : undefined}
                      >
                        <td>
                          {l.tipo && <span className="rp-ponto" style={{ background: COR[l.tipo] }} />}
                          {l.texto}
                          <div className="rp-motivo">{l.motivo}</div>
                        </td>
                        <td className="rp-num">{reais(l.valor)}</td>
                      </tr>
                    ))}
                    <tr className="rp-total">
                      <td>Total</td>
                      <td className="rp-num">
                        {reais(s.total)}{' '}
                        {Math.abs(s.total - valorSel) <= 1 ? '✓ fecha' : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  )
}
