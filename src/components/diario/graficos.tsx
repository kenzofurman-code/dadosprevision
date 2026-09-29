import './Diario.css'
import { fmtData, fmtInteiro } from './formatos'

export function BarrasDia({ dados }: { dados: { data: string; total: number }[] }) {
  if (!dados.length) return <p className="dd-vazio">Sem dados no período.</p>
  const largura = 720
  const alturaBarras = 170
  const margemEsquerda = 34
  const max = Math.max(...dados.map((d) => d.total), 1)
  const faixa = (largura - margemEsquerda) / dados.length
  return (
    <svg viewBox={`0 0 ${largura} ${alturaBarras + 20}`} className="dd-svg" role="img" aria-label="Efetivo por dia">
      <text x={0} y={10} className="dd-eixo">{fmtInteiro(max)}</text>
      <line x1={margemEsquerda} y1={alturaBarras} x2={largura} y2={alturaBarras} className="dd-linha-eixo" />
      {dados.map((d, i) => {
        const altura = (d.total / max) * (alturaBarras - 14)
        return (
          <rect
            key={d.data}
            x={margemEsquerda + i * faixa + faixa * 0.1}
            y={alturaBarras - altura}
            width={Math.max(1, faixa * 0.8)}
            height={altura}
            className="dd-barra"
          >
            <title>{`${fmtData(d.data)}: ${fmtInteiro(d.total)}`}</title>
          </rect>
        )
      })}
      <text x={margemEsquerda} y={alturaBarras + 14} className="dd-eixo">{fmtData(dados[0].data)}</text>
      <text x={largura} y={alturaBarras + 14} textAnchor="end" className="dd-eixo">{fmtData(dados[dados.length - 1].data)}</text>
    </svg>
  )
}

export function BarrasHorizontais({ itens }: { itens: { rotulo: string; total: number }[] }) {
  if (!itens.length) return <p className="dd-vazio">Sem dados no período.</p>
  const max = Math.max(...itens.map((i) => i.total), 1)
  return (
    <div>
      {itens.map((i) => (
        <div className="dd-hbar-linha" key={i.rotulo}>
          <span className="dd-hbar-rotulo" title={i.rotulo}>{i.rotulo}</span>
          <div className="dd-hbar-trilho"><div className="dd-hbar-barra" style={{ width: `${(i.total / max) * 100}%` }} /></div>
          <span className="dd-hbar-valor">{fmtInteiro(i.total)}</span>
        </div>
      ))}
    </div>
  )
}
