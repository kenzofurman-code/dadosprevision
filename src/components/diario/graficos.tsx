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
  emAprovacaoUteis?: number
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
          const pendentesUteis = d.emAprovacaoUteis ?? Math.max(0, d.comDiarioUteis - d.aprovadosUteis)
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

// -------------------------------------------------------------
// DIAGRAMA CIRCULAR (DONUT) DE PREENCHIMENTO EM DIAS ÚTEIS
// -------------------------------------------------------------
export interface DonutPreenchimentoProps {
  aprovados: number
  emAprovacao: number
  semDiario: number
  totalDiasUteis: number
  tamanho?: 'grande' | 'pequeno'
}

export function DonutPreenchimento({
  aprovados,
  emAprovacao,
  semDiario,
  totalDiasUteis,
  tamanho = 'grande',
}: DonutPreenchimentoProps) {
  const isGrande = tamanho === 'grande'
  const viewBoxSize = isGrande ? 160 : 120
  const cx = viewBoxSize / 2
  const cy = viewBoxSize / 2
  const r = isGrande ? 56 : 42
  const strokeWidth = isGrande ? 17 : 13
  const C = 2 * Math.PI * r

  const baseTotal = totalDiasUteis > 0 ? totalDiasUteis : Math.max(1, aprovados + emAprovacao + semDiario)
  const seguroTotal = Math.max(1, baseTotal)

  const fracAprov = Math.max(0, aprovados) / seguroTotal
  const fracEmAprov = Math.max(0, emAprovacao) / seguroTotal
  const fracSemDiario = Math.max(0, semDiario) / seguroTotal

  const lAprov = fracAprov * C
  const lEmAprov = fracEmAprov * C
  const lSemDiario = fracSemDiario * C

  const pctAprovado = Math.min(100, Math.round(fracAprov * 100))

  return (
    <div className={`dd-donut-wrapper ${isGrande ? 'dd-donut-lg' : 'dd-donut-sm'}`}>
      <svg
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        className="dd-donut-svg"
        role="img"
        aria-label={`Diagrama circular: ${aprovados} aprovados, ${emAprovacao} em aprovação, ${semDiario} sem diário de ${baseTotal} dias úteis`}
      >
        {/* Trilho base de fundo */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="var(--border, rgba(0, 0, 0, 0.1))"
          strokeWidth={strokeWidth}
          fill="none"
          opacity={0.35}
        />

        {/* Fatias circulares em SVG iniciadas no topo (12h) */}
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {/* Segmento 1: Aprovados (Verde) */}
          {lAprov > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              stroke="#16a34a"
              strokeWidth={strokeWidth}
              strokeDasharray={`${lAprov} ${C - lAprov}`}
              strokeDashoffset={0}
              fill="none"
              className="dd-donut-seg dd-donut-seg-aprovado"
            >
              <title>{`Aprovados: ${aprovados} dias úteis (${Math.round(fracAprov * 100)}%)`}</title>
            </circle>
          )}

          {/* Segmento 2: Em Aprovação (Amarelo) */}
          {lEmAprov > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              stroke="#f59e0b"
              strokeWidth={strokeWidth}
              strokeDasharray={`${lEmAprov} ${C - lEmAprov}`}
              strokeDashoffset={-lAprov}
              fill="none"
              className="dd-donut-seg dd-donut-seg-revisao"
            >
              <title>{`Em aprovação: ${emAprovacao} dias úteis (${Math.round(fracEmAprov * 100)}%)`}</title>
            </circle>
          )}

          {/* Segmento 3: Sem Diário (Vermelho) */}
          {lSemDiario > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={r}
              stroke="#ef4444"
              strokeWidth={strokeWidth}
              strokeDasharray={`${lSemDiario} ${C - lSemDiario}`}
              strokeDashoffset={-(lAprov + lEmAprov)}
              fill="none"
              className="dd-donut-seg dd-donut-seg-sem-diario"
            >
              <title>{`Sem diário: ${semDiario} dias úteis (${Math.round(fracSemDiario * 100)}%)`}</title>
            </circle>
          )}
        </g>

        {/* Centro do Diagrama */}
        <text
          x={cx}
          y={isGrande ? cy - 3 : cy - 2}
          textAnchor="middle"
          className={isGrande ? 'dd-donut-pct-lg' : 'dd-donut-pct-sm'}
        >
          {pctAprovado}%
        </text>
        <text
          x={cx}
          y={isGrande ? cy + 13 : cy + 11}
          textAnchor="middle"
          className="dd-donut-rotulo-centro"
        >
          aprovado
        </text>
        {isGrande && (
          <text
            x={cx}
            y={cy + 25}
            textAnchor="middle"
            className="dd-donut-dias-centro"
          >
            {aprovados}/{baseTotal} úteis
          </text>
        )}
      </svg>
    </div>
  )
}

// -------------------------------------------------------------
// SEÇÃO DE PREENCHIMENTO DOS DIÁRIOS (INDIVIDUAL OU CONSOLIDADA)
// -------------------------------------------------------------
export function SecaoPreenchimentoDiario({
  obraId,
  totais,
  obras,
  onSelecionarObra,
}: {
  obraId: string
  totais: {
    diasUteis: number
    aprovadosUteis: number
    emAprovacaoUteis: number
    semDiarioUteis: number
    pendentesAntigos: number
    relatorios?: number
  }
  obras: PreenchimentoObraItem[]
  onSelecionarObra?: (obraId: string) => void
}) {
  // CASO 1: SE UMA OBRA ESTIVER SELECIONADA
  if (obraId) {
    const o = obras.find((item) => item.obraId === obraId) || obras[0]
    if (!o) return <p className="dd-vazio">Sem dados de preenchimento para a obra selecionada.</p>

    const emAprov = o.emAprovacaoUteis ?? Math.max(0, o.comDiarioUteis - o.aprovadosUteis)
    const baseUteis = o.diasUteis > 0 ? o.diasUteis : Math.max(1, o.relatorios)
    const pctAprov = Math.round((o.aprovadosUteis / baseUteis) * 100)
    const pctEmAprov = Math.round((emAprov / baseUteis) * 100)
    const pctSemDiario = Math.round((o.semDiarioUteis / baseUteis) * 100)

    return (
      <div className="dd-preench-destaque-obra">
        <div className="dd-destaque-donut-col">
          <DonutPreenchimento
            aprovados={o.aprovadosUteis}
            emAprovacao={emAprov}
            semDiario={o.semDiarioUteis}
            totalDiasUteis={o.diasUteis}
            tamanho="grande"
          />
          <div className="dd-legenda dd-legenda-col">
            <span className="dd-legenda-item">
              <span className="dd-legenda-swatch dd-sw-aprovado" />
              <strong>{o.aprovadosUteis}</strong> aprovados ({pctAprov}%)
            </span>
            <span className="dd-legenda-item">
              <span className="dd-legenda-swatch dd-sw-revisao" />
              <strong>{emAprov}</strong> em aprovação ({pctEmAprov}%)
            </span>
            <span className="dd-legenda-item">
              <span className="dd-legenda-swatch dd-sw-sem-diario" />
              <strong>{o.semDiarioUteis}</strong> sem diário ({pctSemDiario}%)
            </span>
          </div>
        </div>

        <div className="dd-destaque-info-col">
          <div className="dd-destaque-header">
            <h4>{o.obraNome}</h4>
            <span className="dd-destaque-badge">
              Adesão aos dias úteis: <strong>{pctAprov}%</strong>
            </span>
          </div>

          <div className="dd-cartoes-preench-grid">
            <div className="dd-cartao dd-cartao-info">
              <span>Dias úteis</span>
              <strong>{o.diasUteis}</strong>
              <small>segunda a sexta no período</small>
            </div>

            <div className="dd-cartao dd-cartao-aprovado">
              <span>Aprovados</span>
              <strong>{o.aprovadosUteis}</strong>
              <small>{pctAprov}% dos dias úteis</small>
            </div>

            <div className="dd-cartao dd-cartao-revisao">
              <span>Em aprovação</span>
              <strong>{emAprov}</strong>
              <small>diário feito aguardando</small>
            </div>

            <div className={`dd-cartao ${o.semDiarioUteis > 0 ? 'dd-cartao-alerta' : ''}`}>
              <span>Sem diário</span>
              <strong>{o.semDiarioUteis}</strong>
              <small>{o.semDiarioUteis > 0 ? 'dias úteis faltantes' : 'nenhum dia faltante'}</small>
            </div>
          </div>

          {o.pendentesAntigos > 0 && (
            <div className="dd-aviso-pendencia">
              <span>⚠️ <strong>{o.pendentesAntigos}</strong> diário(s) pendente(s) de aprovação há mais de 7 dias.</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // CASO 2: TODAS AS OBRAS SELECIONADAS
  const totalEsperado = (totais.diasUteis * obras.length) || 1
  const pctGlobal = Math.round((totais.aprovadosUteis / totalEsperado) * 100)

  return (
    <div className="dd-secao-preenchimento-todas">
      {/* 1ª Linha: Cards Numéricos Consolidados */}
      <div className="dd-cartoes dd-cartoes-preench">
        <div className="dd-cartao dd-cartao-info">
          <span>Dias úteis no período</span>
          <strong>{totais.diasUteis}</strong>
          <small>{totalEsperado} relatórios esperados ({obras.length} obras)</small>
        </div>

        <div className="dd-cartao dd-cartao-aprovado">
          <span>Aprovados (todas)</span>
          <strong>{totais.aprovadosUteis}</strong>
          <small>{pctGlobal}% de conformidade global</small>
        </div>

        <div className="dd-cartao dd-cartao-revisao">
          <span>Em aprovação</span>
          <strong>{totais.emAprovacaoUteis}</strong>
          <small>diários em análise</small>
        </div>

        <div className={`dd-cartao ${totais.semDiarioUteis > 0 ? 'dd-cartao-alerta' : ''}`}>
          <span>Dias úteis sem diário</span>
          <strong>{totais.semDiarioUteis}</strong>
          <small>{totais.semDiarioUteis > 0 ? 'faltantes somando as obras' : 'tudo preenchido'}</small>
        </div>

        <div className={`dd-cartao ${totais.pendentesAntigos > 0 ? 'dd-cartao-alerta' : ''}`}>
          <span>Pendentes há +7 dias</span>
          <strong>{totais.pendentesAntigos}</strong>
          <small>não aprovados há +1 semana</small>
        </div>
      </div>

      {/* 2ª Linha: Grade de Diagramas Circulares por Obra */}
      <div className="dd-bloco dd-bloco-largo">
        <div className="dd-grafico-cabecalho">
          <div>
            <h4>Preenchimento por Obra — Diagramas Circulares</h4>
            <p className="dd-subtitulo-bloco">Acompanhe a aderência e aprovações de cada gestor (clique no card para filtrar)</p>
          </div>
          <div className="dd-legenda">
            <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-aprovado" />Aprovados</span>
            <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-revisao" />Em aprovação</span>
            <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-sem-diario" />Sem diário</span>
          </div>
        </div>

        <div className="dd-grade-circulos">
          {obras.map((o) => {
            const emAprov = o.emAprovacaoUteis ?? Math.max(0, o.comDiarioUteis - o.aprovadosUteis)
            const baseUteis = o.diasUteis > 0 ? o.diasUteis : Math.max(1, o.relatorios)
            const pctAprov = Math.round((o.aprovadosUteis / baseUteis) * 100)

            return (
              <div
                key={o.obraId}
                className="dd-card-obra-circulo"
                onClick={() => onSelecionarObra && onSelecionarObra(o.obraId)}
                title={`Clique para filtrar ${o.obraNome}`}
                role="button"
                tabIndex={0}
              >
                <div className="dd-card-obra-topo">
                  <span className="dd-card-obra-titulo" title={o.obraNome}>{o.obraNome}</span>
                  {o.pendentesAntigos > 0 && (
                    <span className="dd-card-obra-badge-alerta" title={`${o.pendentesAntigos} diários pendentes há +7d`}>
                      ! {o.pendentesAntigos}
                    </span>
                  )}
                </div>

                <DonutPreenchimento
                  aprovados={o.aprovadosUteis}
                  emAprovacao={emAprov}
                  semDiario={o.semDiarioUteis}
                  totalDiasUteis={o.diasUteis}
                  tamanho="pequeno"
                />

                <div className="dd-card-obra-stats">
                  <span className="dd-obra-stat-val dd-cor-aprovado" title="Aprovados">
                    <strong>{o.aprovadosUteis}</strong> apr
                  </span>
                  <span className="dd-obra-stat-val dd-cor-revisao" title="Em aprovação">
                    <strong>{emAprov}</strong> aguard
                  </span>
                  <span className="dd-obra-stat-val dd-cor-sem-diario" title="Sem diário">
                    <strong>{o.semDiarioUteis}</strong> falt
                  </span>
                </div>

                <div className="dd-card-obra-rodape">
                  <small>de {o.diasUteis} úteis ({pctAprov}%)</small>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------------
// GRÁFICO ROBUSTO DE EVOLUÇÃO DIÁRIA DO EFETIVO COM LINHA DE MÉDIA
// -------------------------------------------------------------
export function GraficoEvolucaoEfetivo({
  dados,
  mediaGeral = 0,
  fim,
}: {
  dados: { data: string; total: number }[]
  mediaGeral?: number
  fim: string | null
}) {
  const [zoom, setZoom] = useState<'14' | '30' | 'tudo'>('30')

  if (!dados.length) return <p className="dd-vazio">Sem dados no período.</p>

  const limiteDias = zoom === '14' ? 14 : zoom === '30' ? 30 : dados.length
  const ultimo = fim && fim < dados[dados.length - 1].data ? fim : dados[dados.length - 1].data
  const porData = new Map(dados.map((d) => [d.data, d.total]))

  const janela = Array.from({ length: Math.min(limiteDias, 90) }, (_, i) => {
    const data = somarDias(ultimo, i - (Math.min(limiteDias, 90) - 1))
    return { data, total: porData.get(data) ?? null }
  })

  const largura = 780
  const altura = 230
  const topo = 20
  const base = altura - 30
  const areaY = base - topo
  const max = Math.max(...janela.map((d) => d.total ?? 0), mediaGeral, 1)
  const numBarras = janela.length
  const faixa = largura / numBarras

  const yMedia = base - (mediaGeral / max) * areaY

  return (
    <div className="dd-efetivo-grafico-container">
      <div className="dd-grafico-cabecalho">
        <div className="dd-legenda">
          <span className="dd-legenda-item"><span className="dd-legenda-swatch dd-sw-diario" />Pessoas presentes</span>
          {mediaGeral > 0 && (
            <span className="dd-legenda-item">
              <span className="dd-legenda-swatch dd-sw-media" />
              Linha de média ({fmtInteiro(mediaGeral)} pessoas/dia)
            </span>
          )}
        </div>
        <div className="dd-botoes-modo">
          <button type="button" className={`dd-btn-modo ${zoom === '14' ? 'ativo' : ''}`} onClick={() => setZoom('14')}>
            14 dias
          </button>
          <button type="button" className={`dd-btn-modo ${zoom === '30' ? 'ativo' : ''}`} onClick={() => setZoom('30')}>
            30 dias
          </button>
          <button type="button" className={`dd-btn-modo ${zoom === 'tudo' ? 'ativo' : ''}`} onClick={() => setZoom('tudo')}>
            Todo o período
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${largura} ${altura}`} className="dd-svg" role="img" aria-label="Evolução do Efetivo Diário">
        {/* Linha horizontal da Média */}
        {mediaGeral > 0 && (
          <g>
            <line x1={0} y1={yMedia} x2={largura} y2={yMedia} className="dd-linha-media" />
            <text x={largura - 8} y={yMedia - 4} textAnchor="end" className="dd-texto-media">
              Média: {fmtInteiro(mediaGeral)}
            </text>
          </g>
        )}

        {/* Linha de base X */}
        <line x1={0} y1={base} x2={largura} y2={base} className="dd-linha-eixo" />

        {/* Barras diárias */}
        {janela.map((d, i) => {
          const valor = d.total ?? 0
          const h = (valor / max) * areaY
          const x = i * faixa
          const largBarra = Math.max(3, faixa * 0.65)
          const xBarra = x + (faixa - largBarra) / 2

          return (
            <g key={d.data}>
              {d.total !== null && (
                <>
                  <rect
                    x={xBarra}
                    y={base - h}
                    width={largBarra}
                    height={h}
                    className="dd-barra"
                    rx={2}
                  >
                    <title>{`${fmtData(d.data)}: ${fmtInteiro(d.total)} pessoas`}</title>
                  </rect>
                  {(numBarras <= 20 || valor === max) && (
                    <text x={x + faixa / 2} y={base - h - 4} textAnchor="middle" className="dd-valor">
                      {fmtInteiro(valor)}
                    </text>
                  )}
                </>
              )}
              {/* Rótulo de data espaçado */}
              {(numBarras <= 16 || i % Math.ceil(numBarras / 15) === 0) && (
                <text x={x + faixa / 2} y={base + 15} textAnchor="middle" className="dd-eixo">
                  {fmtData(d.data).slice(0, 5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

