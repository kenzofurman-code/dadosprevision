import './Diario.css'
import { fmtData, fmtInteiro, somarDias } from './formatos'

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
