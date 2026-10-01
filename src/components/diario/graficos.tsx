import { useState } from 'react'
import './Diario.css'
import { fmtData, fmtInteiro, fmtNumero, somarDias } from './formatos'

// Uma barra por dia corrido nos últimos `dias` dias até `fim` (dia sem diário fica vazio), com o valor no topo e dd/mm embaixo.
export function BarrasUltimosDias({ dados, fim, dias = 14 }: { dados: { data: string; total: number }[]; fim: string | null; dias?: number }) {
  if (!dados.length) return <p className="dd-vazio">Sem dados no período.</p>
  const ultimo = fim && fim < dados[dados.length - 1].data ? fim : dados[dados.length - 1].data
  const porData = new Map(dados.map((d) => [d.data, d.total]))
  const janela = Array.from({ length: dias }, (_, i) => {
    const data = somarDias(ultimo, i - (dias - 1))
    return { data, total: porData.get(data) ?? null }
  })
  const largura = 720
  const areaBarras = 150
  const topo = 18
  const max = Math.max(...janela.map((d) => d.total ?? 0), 1)
  const faixa = largura / dias
  return (
    <svg viewBox={`0 0 ${largura} ${topo + areaBarras + 22}`} className="dd-svg" role="img" aria-label={`Efetivo por dia, últimos ${dias} dias`}>
      <line x1={0} y1={topo + areaBarras} x2={largura} y2={topo + areaBarras} className="dd-linha-eixo" />
      {janela.map((d, i) => {
        const altura = ((d.total ?? 0) / max) * areaBarras
        const x = i * faixa
        return (
          <g key={d.data}>
            {d.total !== null && (
              <>
                <rect x={x + faixa * 0.15} y={topo + areaBarras - altura} width={faixa * 0.7} height={altura} className="dd-barra">
                  <title>{`${fmtData(d.data)}: ${fmtInteiro(d.total)} pessoas`}</title>
                </rect>
                <text x={x + faixa / 2} y={topo + areaBarras - altura - 4} textAnchor="middle" className="dd-valor">{fmtInteiro(d.total)}</text>
              </>
            )}
            <text x={x + faixa / 2} y={topo + areaBarras + 15} textAnchor="middle" className="dd-eixo">{fmtData(d.data).slice(0, 5)}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function BarrasHorizontais({ itens, formato = fmtInteiro }: { itens: { rotulo: string; total: number }[]; formato?: (v: number) => string }) {
  if (!itens.length) return <p className="dd-vazio">Sem dados no período.</p>
  const max = Math.max(...itens.map((i) => i.total), 1)
  return (
    <div>
      {itens.map((i) => (
        <div className="dd-hbar-linha" key={i.rotulo}>
          <span className="dd-hbar-rotulo" title={i.rotulo}>{i.rotulo}</span>
          <div className="dd-hbar-trilho"><div className="dd-hbar-barra" style={{ width: `${(i.total / max) * 100}%` }} /></div>
          <span className="dd-hbar-valor">{formato(i.total)}</span>
        </div>
      ))}
    </div>
  )
}

export interface ClimaObraItem {
  obraId: string
  obraNome: string
  relatorios: number
  chuvosos: number
  impraticaveis: number
  parados: number
  chuvaMm: number
}

export interface ClimaDiaItem {
  data: string
  totalObras: number
  chuvosos: number
  impraticaveis: number
  parados: number
  chuvaMediaMm: number
  chuvaMaxMm: number
}

// Gráfico de Clima, Dias Parados e Chuva com Eixo Duplo (escala secundária para mm de chuva)
export function GraficoClimaChuva({
  porObra,
  porDia = [],
}: {
  porObra: ClimaObraItem[]
  porDia?: ClimaDiaItem[]
}) {
  const [visao, setVisao] = useState<'obra' | 'dia'>('obra')

  if (!porObra.length) return <p className="dd-vazio">Sem dados no período.</p>

  const largura = 780
  const altura = 240
  const margemEsq = 36
  const margemDir = 48
  const topo = 24
  const base = altura - 32
  const areaY = base - topo
  const areaX = largura - margemEsq - margemDir

  // --- VISÃO 1: COMPARATIVO POR OBRA ---
  const maxDiasObra = Math.max(1, ...porObra.map((o) => Math.max(o.relatorios, o.impraticaveis, o.parados, o.chuvosos)))
  const maxChuvaObra = Math.max(1, ...porObra.map((o) => o.chuvaMm))
  const faixaObra = areaX / porObra.length

  const pontosChuvaObra = porObra.map((o, i) => {
    const cx = margemEsq + (i + 0.5) * faixaObra
    const cy = base - (o.chuvaMm / maxChuvaObra) * areaY
    return { cx, cy, mm: o.chuvaMm }
  })
  const polylineObra = pontosChuvaObra.map((p) => `${p.cx},${p.cy}`).join(' ')

  // --- VISÃO 2: LINHA DO TEMPO DIA A DIA ---
  const maxDiasDia = Math.max(1, ...(porDia.length ? porDia.map((d) => Math.max(d.impraticaveis, d.parados, d.chuvosos)) : [1]))
  const maxChuvaDia = Math.max(1, ...(porDia.length ? porDia.map((d) => d.chuvaMaxMm || d.chuvaMediaMm) : [1]))
  const faixaDia = porDia.length > 0 ? areaX / porDia.length : areaX

  const pontosChuvaDia = porDia.map((d, i) => {
    const cx = margemEsq + (i + 0.5) * faixaDia
    const valor = d.chuvaMaxMm || d.chuvaMediaMm
    const cy = base - (valor / maxChuvaDia) * areaY
    return { cx, cy, mm: valor, data: d.data }
  })
  const polylineDia = pontosChuvaDia.map((p) => `${p.cx},${p.cy}`).join(' ')

  return (
    <div className="dd-clima-grafico-container">
      <div className="dd-grafico-cabecalho">
        <div className="dd-legenda">
          <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-diario" />Diários</span>
          <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-imprat" />Impraticáveis</span>
          <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-parado" />Parados</span>
          <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-chuva-linha" />—●— Chuva mm (eixo dir.)</span>
        </div>
        {porDia.length > 0 && (
          <div className="dd-botoes-modo">
            <button
              type="button"
              className={`dd-btn-modo ${visao === 'obra' ? 'ativo' : ''}`}
              onClick={() => setVisao('obra')}
            >
              Por Obra
            </button>
            <button
              type="button"
              className={`dd-btn-modo ${visao === 'dia' ? 'ativo' : ''}`}
              onClick={() => setVisao('dia')}
            >
              Dia a Dia ({porDia.length}d)
            </button>
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${largura} ${altura}`} className="dd-svg" role="img" aria-label="Gráfico de Clima, Dias Parados e Chuva">
        {/* Linhas de grade horizontais e escalas */}
        {[0, 0.5, 1].map((frac) => {
          const y = base - frac * areaY
          const valorEsq = Math.round(frac * (visao === 'obra' ? maxDiasObra : maxDiasDia))
          const valorDir = Math.round(frac * (visao === 'obra' ? maxChuvaObra : maxChuvaDia))
          return (
            <g key={frac}>
              <line x1={margemEsq} y1={y} x2={largura - margemDir} y2={y} className="dd-linha-grade" />
              <text x={margemEsq - 6} y={y + 3.5} textAnchor="end" className="dd-eixo-escala">{valorEsq}d</text>
              <text x={largura - margemDir + 6} y={y + 3.5} textAnchor="start" className="dd-eixo-escala dd-eixo-chuva">{valorDir}mm</text>
            </g>
          )
        })}

        {/* Linha de base */}
        <line x1={margemEsq} y1={base} x2={largura - margemDir} y2={base} className="dd-linha-eixo" />

        {visao === 'obra' ? (
          // RENDERIZAÇÃO POR OBRA
          <>
            {porObra.map((o, i) => {
              const xCentro = margemEsq + (i + 0.5) * faixaObra
              const largBarra = Math.max(3, Math.min(10, faixaObra * 0.18))
              const espaco = 2

              const hRel = (o.relatorios / maxDiasObra) * areaY
              const hImp = (o.impraticaveis / maxDiasObra) * areaY
              const hPar = (o.parados / maxDiasObra) * areaY

              const xRel = xCentro - largBarra * 1.5 - espaco
              const xImp = xCentro - largBarra * 0.5
              const xPar = xCentro + largBarra * 0.5 + espaco

              return (
                <g key={o.obraId}>
                  {/* Barra Diários */}
                  {o.relatorios > 0 && (
                    <rect x={xRel} y={base - hRel} width={largBarra} height={hRel} className="dd-barra-diario" rx={2}>
                      <title>{`${o.obraNome}: ${o.relatorios} diários`}</title>
                    </rect>
                  )}
                  {/* Barra Impraticáveis */}
                  {o.impraticaveis > 0 && (
                    <rect x={xImp} y={base - hImp} width={largBarra} height={hImp} className="dd-barra-impraticavel" rx={2}>
                      <title>{`${o.obraNome}: ${o.impraticaveis} dias impraticáveis`}</title>
                    </rect>
                  )}
                  {/* Barra Parados */}
                  {o.parados > 0 && (
                    <rect x={xPar} y={base - hPar} width={largBarra} height={hPar} className="dd-barra-parado" rx={2}>
                      <title>{`${o.obraNome}: ${o.parados} dias parados`}</title>
                    </rect>
                  )}
                  {/* Rótulo da obra no eixo X */}
                  <text
                    x={xCentro}
                    y={base + 14}
                    textAnchor="middle"
                    className="dd-eixo-obra"
                  >
                    <title>{o.obraNome}</title>
                    {o.obraNome.length > 9 ? `${o.obraNome.slice(0, 8)}…` : o.obraNome}
                  </text>
                </g>
              )
            })}

            {/* Linha de chuva conectando as obras no eixo secundário */}
            {pontosChuvaObra.length > 1 && (
              <polyline points={polylineObra} className="dd-linha-chuva" />
            )}
            {pontosChuvaObra.map((p, i) => (
              <g key={i}>
                <circle cx={p.cx} cy={p.cy} r={3.5} className="dd-ponto-chuva">
                  <title>{`${porObra[i].obraNome}: ${fmtNumero(p.mm)} mm de chuva`}</title>
                </circle>
                {p.mm > 0 && (
                  <text x={p.cx} y={p.cy - 6} textAnchor="middle" className="dd-valor-chuva">
                    {Math.round(p.mm)}
                  </text>
                )}
              </g>
            ))}
          </>
        ) : (
          // RENDERIZAÇÃO DIA A DIA (Linha do Tempo)
          <>
            {porDia.map((d, i) => {
              const xCentro = margemEsq + (i + 0.5) * faixaDia
              const largBarra = Math.max(2, Math.min(8, faixaDia * 0.35))

              const hImp = (d.impraticaveis / maxDiasDia) * areaY
              const hPar = (d.parados / maxDiasDia) * areaY

              return (
                <g key={d.data}>
                  {d.impraticaveis > 0 && (
                    <rect x={xCentro - largBarra - 1} y={base - hImp} width={largBarra} height={hImp} className="dd-barra-impraticavel" rx={1}>
                      <title>{`${fmtData(d.data)}: ${d.impraticaveis} obras impraticáveis`}</title>
                    </rect>
                  )}
                  {d.parados > 0 && (
                    <rect x={xCentro + 1} y={base - hPar} width={largBarra} height={hPar} className="dd-barra-parado" rx={1}>
                      <title>{`${fmtData(d.data)}: ${d.parados} obras paradas`}</title>
                    </rect>
                  )}
                  {/* Data a cada N dias para não embolar */}
                  {(porDia.length <= 16 || i % 2 === 0) && (
                    <text x={xCentro} y={base + 14} textAnchor="middle" className="dd-eixo">
                      {fmtData(d.data).slice(0, 5)}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Linha de chuva dia a dia */}
            {pontosChuvaDia.length > 1 && (
              <polyline points={polylineDia} className="dd-linha-chuva" />
            )}
            {pontosChuvaDia.map((p, i) => (
              <g key={i}>
                <circle cx={p.cx} cy={p.cy} r={2.5} className="dd-ponto-chuva">
                  <title>{`${fmtData(p.data)}: ${fmtNumero(p.mm)} mm de chuva`}</title>
                </circle>
                {p.mm >= 10 && (
                  <text x={p.cx} y={p.cy - 5} textAnchor="middle" className="dd-valor-chuva">
                    {Math.round(p.mm)}
                  </text>
                )}
              </g>
            ))}
          </>
        )}
      </svg>
    </div>
  )
}

export interface PreenchimentoObraItem {
  obraId: string
  obraNome: string
  relatorios: number
  aprovados: number
  emRevisao: number
  preenchendo: number
  pendentesAntigos: number
  diasUteis: number
  comDiarioUteis: number
  semDiarioUteis: number
  aprovadosUteis: number
  semAprovadoUteis: number
  corridos: number
  semDiario: number
}

// Gráfico comparativo de preenchimento dos diários por obra (aderência aos dias úteis e aprovações)
export function GraficoPreenchimentoObras({
  dados,
}: {
  dados: PreenchimentoObraItem[]
}) {
  if (!dados.length) return <p className="dd-vazio">Sem dados no período.</p>

  return (
    <div className="dd-preench-grafico-container">
      <div className="dd-legenda">
        <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-aprovado" />Aprovados em dias úteis</span>
        <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-revisao" />Em revisão / Preenchendo</span>
        <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-sem-diario" />Dias úteis sem diário (faltantes)</span>
      </div>

      <div className="dd-preench-lista">
        {dados.map((d) => {
          const totalBase = d.diasUteis > 0 ? d.diasUteis : Math.max(1, d.relatorios)
          const pctAprovado = Math.min(100, Math.round((d.aprovadosUteis / totalBase) * 100))
          const pendentesUteis = Math.max(0, d.comDiarioUteis - d.aprovadosUteis)
          const pctPendentes = Math.min(100 - pctAprovado, Math.round((pendentesUteis / totalBase) * 100))
          const pctSemDiario = Math.max(0, 100 - pctAprovado - pctPendentes)

          return (
            <div className="dd-preench-linha" key={d.obraId}>
              <div className="dd-preench-info">
                <span className="dd-preench-nome" title={d.obraNome}>{d.obraNome}</span>
                <span className="dd-preench-resumo">
                  <strong>{d.aprovadosUteis}</strong>/{d.diasUteis} úteis aprovados ({pctAprovado}%)
                  {d.semDiarioUteis > 0 && <span className="dd-alerta-texto"> · {d.semDiarioUteis} úteis sem diário</span>}
                  {d.semAprovadoUteis > d.semDiarioUteis && (
                    <span className="dd-aviso-texto"> · {d.semAprovadoUteis - d.semDiarioUteis} aguardando aprovação</span>
                  )}
                </span>
              </div>

              <div className="dd-preench-trilho" title={`${d.obraNome}: ${d.aprovadosUteis} aprovados, ${pendentesUteis} em revisão, ${d.semDiarioUteis} sem diário de ${d.diasUteis} dias úteis`}>
                <div className="dd-preench-seg dd-seg-aprovado" style={{ width: `${pctAprovado}%` }} />
                <div className="dd-preench-seg dd-seg-revisao" style={{ width: `${pctPendentes}%` }} />
                <div className="dd-preench-seg dd-seg-sem-diario" style={{ width: `${pctSemDiario}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
