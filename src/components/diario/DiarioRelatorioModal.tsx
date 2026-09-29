import { Fragment, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import './Diario.css'
import { diarioApi, type RelatorioDetalhe } from './diario-api'
import { fmtData, fmtInteiro, fmtNumero } from './formatos'

type Comentario = { descricao: string; dataHora: string; usuario?: { nome?: string } }

export function DiarioRelatorioModal({ relatorioId, onClose }: { relatorioId: string | null; onClose: () => void }) {
  const [detalhe, setDetalhe] = useState<RelatorioDetalhe | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!relatorioId) return
    let vivo = true
    setDetalhe(null)
    setErro(null)
    diarioApi.relatorio(relatorioId)
      .then((d) => { if (vivo) setDetalhe(d) })
      .catch((e: Error) => { if (vivo) setErro(e.message) })
    return () => { vivo = false }
  }, [relatorioId])

  const efetivoPorEmpreiteira = useMemo(() => {
    const grupos = new Map<string, { rotulo: string; itens: { funcao: string | null; quantidade: number }[] }>()
    for (const m of detalhe?.maoObra ?? []) {
      const chave = m.empreiteira_norm ?? 'SEM EMPREITEIRA'
      const grupo = grupos.get(chave) ?? { rotulo: m.empreiteira || 'Sem empreiteira', itens: [] }
      grupo.itens.push(m)
      grupos.set(chave, grupo)
    }
    return [...grupos.entries()].map(([chave, { rotulo, itens }]) => ({
      chave,
      empreiteira: rotulo,
      itens,
      total: itens.reduce((t, i) => t + i.quantidade, 0),
    }))
  }, [detalhe])

  if (!relatorioId) return null
  const r = detalhe?.relatorio
  const comentarios = ((r?.raw?.comentarios ?? []) as Comentario[])

  return (
    <div className="mega-modal-overlay" onClick={onClose}>
      <div className="mega-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="mega-modal-header">
          <div className="mega-modal-title">
            <h3>{r ? `${r.obra_nome} — Relatório nº ${r.numero ?? '-'}` : 'Diário de obra'}</h3>
            <p>{r ? `${fmtData(r.data)} · ${r.dia_semana ?? ''} · ${r.status ?? ''}` : 'Carregando…'}</p>
          </div>
          <button type="button" className="mega-modal-close" onClick={onClose} title="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="dd-modal-corpo">
          {erro && <p className="dd-erro">{erro}</p>}
          {!detalhe && !erro && <p className="dd-vazio">Carregando diário…</p>}
          {detalhe && r && (
            <>
              <section className="dd-secao">
                <h4>Clima</h4>
                <table className="dd-tabela">
                  <thead><tr><th>Período</th><th>Clima</th><th>Condição</th></tr></thead>
                  <tbody>
                    <tr><td>Manhã</td><td>{r.clima_manha ?? '-'}</td><td>{r.condicao_manha ?? '-'}</td></tr>
                    <tr><td>Tarde</td><td>{r.clima_tarde ?? '-'}</td><td>{r.condicao_tarde ?? '-'}</td></tr>
                    <tr><td>Noite</td><td>{r.clima_noite ?? '-'}</td><td>{r.condicao_noite ?? '-'}</td></tr>
                  </tbody>
                </table>
                <div className="dd-grade-info" style={{ marginTop: 8 }}>
                  <div><span>Chuva (mm)</span><strong>{fmtNumero(r.indice_pluviometrico)}</strong></div>
                  <div><span>Criado por</span><strong>{r.criado_por ?? '-'}</strong></div>
                  <div><span>Modificado por</span><strong>{r.modificado_por ?? '-'}</strong></div>
                  <div><span>Modificado em</span><strong>{fmtData(r.modificado_em)}</strong></div>
                </div>
                {r.link_pdf && (
                  <p style={{ margin: '8px 0 0' }}><a href={r.link_pdf} target="_blank" rel="noreferrer">Abrir PDF do relatório</a></p>
                )}
              </section>

              <section className="dd-secao">
                <h4>Atividades ({detalhe.atividades.length})</h4>
                {detalhe.atividades.length === 0 ? <p className="dd-vazio">Nenhuma atividade.</p> : (
                  <table className="dd-tabela">
                    <thead><tr><th>Atividade</th><th>Status</th><th className="dd-num">Avanço (%)</th><th className="dd-num">Fotos</th></tr></thead>
                    <tbody>
                      {detalhe.atividades.map((a, i) => (
                        <tr key={i}>
                          <td>{a.descricao ?? '-'}{a.observacao ? <><br /><small>{a.observacao}</small></> : null}</td>
                          <td>{a.status ?? '-'}</td>
                          <td className="dd-num">{fmtNumero(a.porcentagem)}</td>
                          <td className="dd-num">{fmtInteiro(a.total_fotos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="dd-secao">
                <h4>Mão de obra ({fmtInteiro(detalhe.maoObra.reduce((t, m) => t + m.quantidade, 0))} pessoas)</h4>
                {efetivoPorEmpreiteira.length === 0 ? <p className="dd-vazio">Sem efetivo lançado.</p> : (
                  <table className="dd-tabela">
                    <thead><tr><th>Empreiteira / função</th><th className="dd-num">Quantidade</th></tr></thead>
                    <tbody>
                      {efetivoPorEmpreiteira.map((g) => (
                        <Fragment key={g.chave}>
                          <tr><td><strong>{g.empreiteira}</strong></td><td className="dd-num"><strong>{fmtInteiro(g.total)}</strong></td></tr>
                          {g.itens.map((i, idx) => (
                            <tr key={`${g.chave}-${idx}`}><td style={{ paddingLeft: 20 }}>{i.funcao ?? '-'}</td><td className="dd-num">{fmtInteiro(i.quantidade)}</td></tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="dd-secao">
                <h4>Equipamentos ({detalhe.equipamentos.length})</h4>
                {detalhe.equipamentos.length === 0 ? <p className="dd-vazio">Nenhum equipamento.</p> : (
                  <table className="dd-tabela">
                    <thead><tr><th>Equipamento</th><th className="dd-num">Quantidade</th></tr></thead>
                    <tbody>
                      {detalhe.equipamentos.map((e, i) => (
                        <tr key={i}><td>{e.descricao ?? '-'}</td><td className="dd-num">{fmtInteiro(e.quantidade)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="dd-secao">
                <h4>Ocorrências ({detalhe.ocorrencias.length})</h4>
                {detalhe.ocorrencias.length === 0 ? <p className="dd-vazio">Nenhuma ocorrência.</p> : (
                  <ul className="dd-lista">
                    {detalhe.ocorrencias.map((o, i) => (
                      <li key={i}>
                        {o.descricao ?? '-'}
                        <div className="dd-etiquetas">
                          {o.tags.map((t) => <span key={t} className={`dd-etiqueta ${o.paralisacao && t.toUpperCase().startsWith('PARALIS') ? 'alerta' : ''}`}>{t}</span>)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {comentarios.length > 0 && (
                <section className="dd-secao">
                  <h4>Comentários ({comentarios.length})</h4>
                  <ul className="dd-lista">
                    {comentarios.map((c, i) => (
                      <li key={i}>{c.descricao} <small>— {c.usuario?.nome ?? '-'}, {c.dataHora}</small></li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="dd-secao">
                <h4>Fotos ({detalhe.fotos.length})</h4>
                {detalhe.fotos.length === 0 ? <p className="dd-vazio">Sem fotos.</p> : (
                  <div className="dd-fotos">
                    {detalhe.fotos.map((f) => (
                      <a key={f.url} href={f.url} target="_blank" rel="noreferrer" title={f.descricao ?? ''}>
                        <img className="dd-foto" src={f.url_miniatura ?? f.url} alt={f.descricao ?? ''} loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
