import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import './Diario.css'
import { diarioApi, type IndicadoresDiario, type ObraDiario } from './diario-api'
import { BarrasHorizontais, GraficoEvolucaoEfetivo } from './graficos'
import { fmtData, fmtInteiro, fmtMedia, somarDias } from './formatos'

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

export function DiarioEfetivo() {
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

  const semDados = dados && dados.efetivo.diasComDiario === 0

  // Cálculo de pico no período
  const diasComTotal = dados?.efetivo.porDia.filter((d) => d.total > 0) || []
  const picoItem = diasComTotal.length > 0
    ? diasComTotal.reduce((max, d) => (d.total > max.total ? d : max), diasComTotal[0])
    : null

  const totalHomens = dados?.efetivo.totalHomensDia || dados?.efetivo.porDia.reduce((acc, d) => acc + d.total, 0) || 0

  return (
    <div className="gestao-card dd-indicadores dd-painel-efetivo">
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
      {!erro && dados && semDados && <p className="dd-vazio">Sem dados de efetivo no período para a seleção atual.</p>}

      {dados && !semDados && (
        <>
          {/* CARDS DE RESUMO DO EFETIVO */}
          <div className="dd-cartoes">
            <Cartao
              rotulo="Efetivo médio por dia"
              valor={fmtMedia(dados.efetivo.mediaPorDia)}
              detalhe={`pessoas/dia · ${fmtInteiro(dados.efetivo.diasComDiario)} dias com diário`}
            />
            <Cartao
              rotulo="Pico no período"
              valor={picoItem ? `${fmtInteiro(picoItem.total)} pessoas` : '-'}
              detalhe={picoItem ? `em ${fmtData(picoItem.data)}` : 'sem pico registrado'}
            />
            <Cartao
              rotulo="Total homens-dia"
              valor={fmtInteiro(totalHomens)}
              detalhe="presenças somadas no período"
            />
            <Cartao
              rotulo="Empreiteiras ativas"
              valor={fmtInteiro(dados.efetivo.porEmpreiteira.length)}
              detalhe="terceirizados no período"
            />
            <Cartao
              rotulo="Funções registradas"
              valor={fmtInteiro(dados.efetivo.porFuncao.length)}
              detalhe="especialidades ativas"
            />
          </div>

          {/* GRÁFICO PRINCIPAL: EVOLUÇÃO DIÁRIA DO EFETIVO */}
          <div className="dd-bloco dd-bloco-largo">
            <div className="dd-secao-cabecalho-bloco">
              <div>
                <h4>Evolução Diária do Efetivo de Obra</h4>
                <p className="dd-subtitulo-bloco">Contingente diário de pessoas presentes e linha de média da obra</p>
              </div>
            </div>
            <GraficoEvolucaoEfetivo
              dados={dados.efetivo.porDia}
              mediaGeral={dados.efetivo.mediaPorDia}
              fim={dataFim || null}
            />
          </div>

          {/* GRÁFICOS DE BARRAS HORIZONTAIS: EMPREITEIRAS E FUNÇÕES */}
          <div className="dd-grade-graficos">
            <div className="dd-bloco">
              <h4>Efetivo médio por empreiteira (pessoas/dia, top 15)</h4>
              <p className="dd-subtitulo-bloco">Média arredondada por dia com diário</p>
              <BarrasHorizontais
                itens={dados.efetivo.porEmpreiteira.map((e) => ({ rotulo: e.rotulo, total: e.media }))}
                formato={fmtMedia}
              />
            </div>

            <div className="dd-bloco">
              <h4>Efetivo médio por função (pessoas/dia, top 15)</h4>
              <p className="dd-subtitulo-bloco">Média arredondada por dia com diário</p>
              <BarrasHorizontais
                itens={dados.efetivo.porFuncao.map((f) => ({ rotulo: f.rotulo, total: f.media }))}
                formato={fmtMedia}
              />
            </div>
          </div>

          {/* TABELAS ANALÍTICAS: EMPREITEIRAS E FUNÇÕES */}
          <div className="dd-grade-graficos">
            {/* Tabela de Empreiteiras */}
            <div className="dd-bloco">
              <h4>Detalhamento por Empreiteira</h4>
              <table className="dd-tabela">
                <thead>
                  <tr>
                    <th>Empreiteira</th>
                    <th className="dd-num">Média (pes/dia)</th>
                    <th className="dd-num">Total homens-dia</th>
                    <th className="dd-num">% Partic.</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.efetivo.porEmpreiteira.map((e) => {
                    const totalEmp = e.total || 0
                    const pct = totalHomens > 0 ? Math.round((totalEmp / totalHomens) * 100) : 0
                    return (
                      <tr key={e.chave}>
                        <td>{e.rotulo}</td>
                        <td className="dd-num"><strong>{fmtMedia(e.media)}</strong></td>
                        <td className="dd-num">{fmtInteiro(totalEmp)}</td>
                        <td className="dd-num">{pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Tabela de Funções */}
            <div className="dd-bloco">
              <h4>Detalhamento por Função / Cargo</h4>
              <table className="dd-tabela">
                <thead>
                  <tr>
                    <th>Função</th>
                    <th className="dd-num">Média (pes/dia)</th>
                    <th className="dd-num">Total homens-dia</th>
                    <th className="dd-num">% Partic.</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.efetivo.porFuncao.map((f) => {
                    const totalFunc = f.total || 0
                    const pct = totalHomens > 0 ? Math.round((totalFunc / totalHomens) * 100) : 0
                    return (
                      <tr key={f.rotulo}>
                        <td>{f.rotulo}</td>
                        <td className="dd-num"><strong>{fmtMedia(f.media)}</strong></td>
                        <td className="dd-num">{fmtInteiro(totalFunc)}</td>
                        <td className="dd-num">{pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* TABELA COMPARATIVA DE EFETIVO POR OBRA (SE TODAS AS OBRAS SELECIONADAS) */}
          {!obra && dados.efetivo.porObra && dados.efetivo.porObra.length > 0 && (
            <div className="dd-bloco dd-bloco-largo">
              <h4>Efetivo comparativo por obra</h4>
              <p className="dd-subtitulo-bloco">Média diária de pessoas e contingente em cada canteiro</p>
              <table className="dd-tabela">
                <thead>
                  <tr>
                    <th>Obra</th>
                    <th className="dd-num">Média diária (pessoas)</th>
                    <th className="dd-num">Dias com diário</th>
                    <th className="dd-num">Total homens-dia</th>
                    <th className="dd-num">% do Efetivo Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.efetivo.porObra.map((o) => {
                    const pct = totalHomens > 0 ? Math.round((o.totalHomens / totalHomens) * 100) : 0
                    return (
                      <tr key={o.obraId}>
                        <td>
                          <button
                            type="button"
                            className="dd-link-tabela"
                            onClick={() => setObra(o.obraId)}
                            title="Filtrar esta obra"
                          >
                            {o.obraNome}
                          </button>
                        </td>
                        <td className="dd-num"><strong>{fmtMedia(o.mediaPorDia)}</strong></td>
                        <td className="dd-num">{fmtInteiro(o.diasComDiario)}</td>
                        <td className="dd-num">{fmtInteiro(o.totalHomens)}</td>
                        <td className="dd-num">{pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
