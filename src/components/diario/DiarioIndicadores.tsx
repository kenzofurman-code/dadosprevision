import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import './Diario.css'
import { diarioApi, type IndicadoresDiario, type ObraDiario } from './diario-api'
import { BarrasHorizontais, GraficoClimaChuva, SecaoPreenchimentoDiario } from './graficos'
import { fmtInteiro, fmtNumero, somarDias } from './formatos'

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

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
      {/* Barra de Filtros */}
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
          {/* SEÇÃO 1: PREENCHIMENTO DOS DIÁRIOS — DIAGRAMA CIRCULAR E DIAS ÚTEIS */}
          <div className="dd-secao-indicador">
            <div className="dd-secao-cabecalho">
              <h3>Adesão e Preenchimento dos Diários de Obra</h3>
              <p>Conformidade em dias úteis (segunda a sexta), relatórios aprovados, em análise e faltantes</p>
            </div>

            <SecaoPreenchimentoDiario
              obraId={obra}
              totais={dados.preenchimento.totais}
              obras={dados.preenchimento.porObra}
              onSelecionarObra={setObra}
            />
          </div>

          {/* TABELA DE PREENCHIMENTO POR OBRA */}
          <div className="dd-bloco dd-bloco-largo">
            <h4>Detalhamento de preenchimento por obra</h4>
            <table className="dd-tabela">
              <thead>
                <tr>
                  <th>Obra</th>
                  <th className="dd-num">Diários</th>
                  <th className="dd-num">Aprovados</th>
                  <th className="dd-num">Em revisão</th>
                  <th className="dd-num">Preenchendo</th>
                  <th className="dd-num">Pendentes +7d</th>
                  <th className="dd-num">Sem diário (úteis)</th>
                  <th className="dd-num">Sem aprovado (úteis)</th>
                  <th className="dd-num">Sem diário (corridos)</th>
                </tr>
              </thead>
              <tbody>
                {dados.preenchimento.porObra.map((o) => (
                  <tr key={o.obraId} className={obra === o.obraId ? 'dd-linha-ativa' : ''}>
                    <td>
                      <button
                        type="button"
                        className="dd-link-tabela"
                        onClick={() => setObra(o.obraId === obra ? '' : o.obraId)}
                        title="Filtrar esta obra"
                      >
                        {o.obraNome}
                      </button>
                    </td>
                    <td className="dd-num">{fmtInteiro(o.relatorios)}</td>
                    <td className="dd-num">{fmtInteiro(o.aprovados)}</td>
                    <td className="dd-num">{fmtInteiro(o.emRevisao)}</td>
                    <td className="dd-num">{fmtInteiro(o.preenchendo)}</td>
                    <td className="dd-num">{fmtInteiro(o.pendentesAntigos)}</td>
                    <td className="dd-num">{fmtInteiro(o.semDiarioUteis)} / {fmtInteiro(o.diasUteis)}</td>
                    <td className="dd-num">{fmtInteiro(o.semAprovadoUteis)} / {fmtInteiro(o.diasUteis)}</td>
                    <td className="dd-num">{fmtInteiro(o.semDiario)} / {fmtInteiro(o.corridos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* SEÇÃO 2: CLIMA, DIAS PARADOS / IMPRATICÁVEIS E CHUVA */}
          <div className="dd-secao-indicador">
            <div className="dd-secao-cabecalho">
              <h3>Clima, Dias Impraticáveis e Precipitação</h3>
              <p>Impacto meteorológico no avanço das obras e comparação com pluviometria</p>
            </div>

            <div className="dd-cartoes">
              <Cartao rotulo="Dias impraticáveis" valor={fmtInteiro(dados.clima.totais.impraticaveis)} detalhe={`${fmtInteiro(dados.clima.totais.parados)} dias parados`} alerta={dados.clima.totais.impraticaveis > 0} />
              <Cartao rotulo="Dias chuvosos" valor={fmtInteiro(dados.clima.totais.chuvosos)} detalhe={`${fmtNumero(dados.clima.totais.chuvaMm)} mm acumulados`} />
              <Cartao rotulo="Chuva acumulada" valor={`${fmtNumero(dados.clima.totais.chuvaMm)} mm`} detalhe="pluviometria no período" />
              <Cartao rotulo="Ocorrências" valor={fmtInteiro(dados.ocorrencias.total)} detalhe={`em ${fmtInteiro(dados.ocorrencias.relatorios)} diários`} alerta={dados.ocorrencias.total > 0} />
            </div>

            <div className="dd-bloco dd-bloco-largo">
              <h4>Clima, dias parados / impraticáveis e chuva (escala dupla)</h4>
              <GraficoClimaChuva porObra={dados.clima.porObra} porDia={dados.clima.porDia} />
            </div>

            <div className="dd-grade-graficos">
              <div className="dd-bloco">
                <h4>Clima e dias parados por obra</h4>
                <table className="dd-tabela">
                  <thead>
                    <tr>
                      <th>Obra</th>
                      <th className="dd-num">Diários</th>
                      <th className="dd-num">Chuvosos</th>
                      <th className="dd-num">Impraticáveis</th>
                      <th className="dd-num">Parados</th>
                      <th className="dd-num">Chuva (mm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.clima.porObra.map((o) => (
                      <tr key={o.obraId}>
                        <td>{o.obraNome}</td>
                        <td className="dd-num">{fmtInteiro(o.relatorios)}</td>
                        <td className="dd-num">{fmtInteiro(o.chuvosos)}</td>
                        <td className="dd-num">{fmtInteiro(o.impraticaveis)}</td>
                        <td className="dd-num">{fmtInteiro(o.parados)}</td>
                        <td className="dd-num">{fmtNumero(o.chuvaMm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="dd-bloco">
                <h4>Ocorrências por tag (top 15)</h4>
                <BarrasHorizontais itens={dados.ocorrencias.porTag.map((t) => ({ rotulo: t.tag, total: t.total }))} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
