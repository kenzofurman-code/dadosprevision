import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import './Diario.css'
import { diarioApi, type IndicadoresDiario, type ObraDiario } from './diario-api'
import { BarrasDia, BarrasHorizontais } from './graficos'
import { fmtInteiro, fmtNumero } from './formatos'

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

function somarDias(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function Cartao({ rotulo, valor, detalhe, alerta = false }: { rotulo: string; valor: string; detalhe?: string; alerta?: boolean }) {
  return (
    <div className={`dd-cartao ${alerta ? 'alerta' : ''}`}>
      <span>{rotulo}</span>
      <strong>{valor}</strong>
      {detalhe && <small>{detalhe}</small>}
    </div>
  )
}

export function DiarioIndicadores() {
  const [obras, setObras] = useState<ObraDiario[]>([])
  const [obra, setObra] = useState('')
  const [dataFim, setDataFim] = useState(hoje())
  const [dataInicio, setDataInicio] = useState(somarDias(hoje(), -30))
  const [dados, setDados] = useState<IndicadoresDiario | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    diarioApi.obras().then(setObras).catch((e: Error) => setErro(e.message))
  }, [])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    diarioApi.indicadores({ obra, dataInicio, dataFim })
      .then((d) => { if (vivo) setDados(d) })
      .catch((e: Error) => { if (vivo) { setDados(null); setErro(e.message) } })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [obra, dataInicio, dataFim])

  function periodo(dias: number | null) {
    if (dias === null) { setDataInicio(''); setDataFim(''); return }
    setDataFim(hoje())
    setDataInicio(somarDias(hoje(), -dias))
  }

  const semDados = dados && dados.preenchimento.totais.relatorios === 0

  return (
    <div className="gestao-card dd-indicadores">
      <div className="dd-filtros">
        <label>
          <span>Obra do Diário</span>
          <select value={obra} onChange={(e) => setObra(e.target.value)}>
            <option value="">Todas as obras ({obras.length})</option>
            {obras.map((o) => <option key={o.obra_id} value={o.obra_id}>{o.nome}</option>)}
          </select>
        </label>
        <label><span>De</span><input type="date" value={dataInicio} max={dataFim || undefined} onChange={(e) => setDataInicio(e.target.value)} /></label>
        <label><span>Até</span><input type="date" value={dataFim} min={dataInicio || undefined} onChange={(e) => setDataFim(e.target.value)} /></label>
        <button type="button" className="dd-btn" onClick={() => periodo(30)}>30 dias</button>
        <button type="button" className="dd-btn" onClick={() => periodo(90)}>90 dias</button>
        <button type="button" className="dd-btn" onClick={() => periodo(null)}>Tudo</button>
        {carregando && <RefreshCw size={16} className="spin" />}
      </div>

      {erro && <p className="dd-erro">{erro}</p>}
      {!erro && dados && semDados && <p className="dd-vazio">Sem dados no período para a seleção atual.</p>}

      {dados && !semDados && (
        <>
          <div className="dd-cartoes">
            <Cartao rotulo="Homens-dia" valor={fmtInteiro(dados.efetivo.homensDia)} detalhe={`média ${fmtNumero(dados.efetivo.mediaPorDia)} por dia com efetivo`} />
            <Cartao rotulo="Diários" valor={fmtInteiro(dados.preenchimento.totais.relatorios)} detalhe={`${fmtInteiro(dados.preenchimento.totais.aprovados)} aprovados`} />
            <Cartao rotulo="Dias parados" valor={fmtInteiro(dados.clima.totais.parados)} detalhe="tag PARALISAÇÃO" alerta={dados.clima.totais.parados > 0} />
            <Cartao rotulo="Dias chuvosos" valor={fmtInteiro(dados.clima.totais.chuvosos)} detalhe={`${fmtNumero(dados.clima.totais.chuvaMm)} mm registrados`} />
            <Cartao rotulo="Dias impraticáveis" valor={fmtInteiro(dados.clima.totais.impraticaveis)} />
            <Cartao rotulo="Ocorrências" valor={fmtInteiro(dados.ocorrencias.total)} detalhe={`em ${fmtInteiro(dados.ocorrencias.relatorios)} diários`} />
            <Cartao rotulo="Pendentes há +7 dias" valor={fmtInteiro(dados.preenchimento.totais.pendentesAntigos)} detalhe="não aprovados" alerta={dados.preenchimento.totais.pendentesAntigos > 0} />
            <Cartao rotulo="Dias sem diário" valor={fmtInteiro(dados.preenchimento.totais.semDiario)} detalhe="corridos, informativo" />
          </div>

          <div className="dd-grade-graficos">
            <div className="dd-bloco">
              <h4>Efetivo por dia (homens-dia)</h4>
              <BarrasDia dados={dados.efetivo.porDia} />
            </div>
            <div className="dd-bloco">
              <h4>Efetivo por empreiteira (top 15)</h4>
              <BarrasHorizontais itens={dados.efetivo.porEmpreiteira.map((e) => ({ rotulo: e.rotulo, total: e.total }))} />
            </div>
            <div className="dd-bloco">
              <h4>Efetivo por função (top 15)</h4>
              <BarrasHorizontais itens={dados.efetivo.porFuncao} />
            </div>
            <div className="dd-bloco">
              <h4>Ocorrências por tag (top 15)</h4>
              <BarrasHorizontais itens={dados.ocorrencias.porTag.map((t) => ({ rotulo: t.tag, total: t.total }))} />
            </div>
          </div>

          <div className="dd-bloco">
            <h4>Clima e dias parados por obra</h4>
            <table className="dd-tabela">
              <thead>
                <tr><th>Obra</th><th className="dd-num">Diários</th><th className="dd-num">Chuvosos</th><th className="dd-num">Impraticáveis</th><th className="dd-num">Parados</th><th className="dd-num">Chuva (mm)</th></tr>
              </thead>
              <tbody>
                {dados.clima.porObra.map((o) => (
                  <tr key={o.obraId}>
                    <td>{o.obraNome}</td><td className="dd-num">{fmtInteiro(o.relatorios)}</td><td className="dd-num">{fmtInteiro(o.chuvosos)}</td>
                    <td className="dd-num">{fmtInteiro(o.impraticaveis)}</td><td className="dd-num">{fmtInteiro(o.parados)}</td><td className="dd-num">{fmtNumero(o.chuvaMm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dd-bloco">
            <h4>Preenchimento dos diários por obra</h4>
            <table className="dd-tabela">
              <thead>
                <tr><th>Obra</th><th className="dd-num">Diários</th><th className="dd-num">Aprovados</th><th className="dd-num">Em revisão</th><th className="dd-num">Preenchendo</th><th className="dd-num">Pendentes +7d</th><th className="dd-num">Sem diário / corridos</th></tr>
              </thead>
              <tbody>
                {dados.preenchimento.porObra.map((o) => (
                  <tr key={o.obraId}>
                    <td>{o.obraNome}</td><td className="dd-num">{fmtInteiro(o.relatorios)}</td><td className="dd-num">{fmtInteiro(o.aprovados)}</td>
                    <td className="dd-num">{fmtInteiro(o.emRevisao)}</td><td className="dd-num">{fmtInteiro(o.preenchendo)}</td>
                    <td className="dd-num">{fmtInteiro(o.pendentesAntigos)}</td><td className="dd-num">{fmtInteiro(o.semDiario)} / {fmtInteiro(o.corridos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
