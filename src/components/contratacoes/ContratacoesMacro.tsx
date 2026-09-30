import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, type Macro, type Sinal, type Tipo } from './contratacoes-api'
import { ContratacoesMicro } from './ContratacoesMicro'
import './ContratacoesMacro.css'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const pctFmt = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const dataFmt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')
const SINAIS: Record<Sinal, string> = {
  ATRASADO: 'Atrasado', ATENCAO: 'Atenção', PENDENCIA: 'Rever projeção/dados', NO_PRAZO: 'No prazo',
  SEM_DATA: 'Sem data no cronograma', SEM_PROJECAO: 'Sem custo projetado', CONCLUIDO: 'Concluído',
}
const TIPOS: Record<Tipo, string> = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de obra' }
const limiteTexto = (d: number | null) => (d === null ? '' : d < 0 ? `há ${-d} dias` : d === 0 ? 'hoje' : `em ${d} dias`)

export function ContratacoesMacro({ projectId, onConfigurar }: { projectId: string; onConfigurar: () => void }) {
  const [macro, setMacro] = useState<Macro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Sinal | null>(null)
  const [aberto, setAberto] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    setMacro(null); setErro(null); setFiltro(null); setAberto(null)
    api.macro(projectId).then((m) => { if (vivo) setMacro(m) }).catch((e) => { if (vivo) setErro((e as Error).message) })
    return () => { vivo = false }
  }, [projectId])

  const linhas = useMemo(() => (macro?.grupos || []).filter((g) => !filtro || g.sinal === filtro), [macro, filtro])

  if (erro) return <div className="cm-card"><p className="cm-erro">{erro}</p></div>
  if (!macro) return <div className="cm-card"><p className="cm-muted">Carregando contratações…</p></div>
  if (!macro.obra) return <div className="cm-card"><p>{macro.motivo}</p></div>
  if (!macro.grupos.length) {
    return (
      <div className="cm-card">
        <p>Nenhum grupo de contratação configurado para esta obra.</p>
        <button type="button" className="cm-btn" onClick={onConfigurar}>Abrir configuração</button>
      </div>
    )
  }

  return (
    <div className="cm-card">
      {!macro.importacao && (
        <p className="cm-aviso">
          Importe o custo projetado em Configurações → Contratações para ver os percentuais.
          <button type="button" className="cm-btn cm-link" onClick={onConfigurar}>Abrir configuração</button>
        </p>
      )}
      <div className="cm-resumo">
        <div><span>Projetado</span><strong>{moeda.format(macro.resumo.projetado)}</strong></div>
        <div><span>Lançado</span><strong>{moeda.format(macro.resumo.lancado)}</strong></div>
        <div><span>Falta lançar</span><strong>{moeda.format(macro.resumo.falta)}</strong></div>
        <div className="cm-fichas">
          {(Object.keys(SINAIS) as Sinal[]).filter((s) => macro.resumo.porSinal[s]).map((s) => (
            <button type="button" key={s} className={`cm-sinal cm-${s} ${filtro === s ? 'ativo' : ''}`} aria-pressed={filtro === s}
              onClick={() => setFiltro(filtro === s ? null : s)}>
              {SINAIS[s]} · {macro.resumo.porSinal[s]}
            </button>
          ))}
        </div>
        <button type="button" className="cm-btn cm-link" onClick={onConfigurar}>Configurar</button>
      </div>
      {(['MATERIAL', 'MAO_DE_OBRA'] as Tipo[]).map((tipo) => {
        const doTipo = linhas.filter((g) => g.tipo === tipo)
        if (!doTipo.length) return null
        return (
          <div key={tipo} className="cm-bloco">
            <h4>{TIPOS[tipo]}</h4>
            <div className="cm-rolagem">
              <table className="cm-tabela">
                <thead>
                  <tr>
                    <th>Grupo</th><th className="cm-num">Projetado</th><th className="cm-num">Solicitado</th>
                    <th className="cm-num">Pedido</th><th className="cm-num">Contratado</th><th className="cm-num">Realizado</th>
                    <th className="cm-num">Falta lançar</th><th>Início</th><th>Limite solicitação</th><th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {doTipo.map((g) => (
                    <Fragment key={g.id}>
                    <tr className="cm-linha" onClick={() => setAberto(aberto === g.id ? null : g.id)} aria-expanded={aberto === g.id}>
                      <td><span aria-hidden="true">{aberto === g.id ? '▾' : '▸'}</span> {g.item}{g.insumos ? <span className="cm-muted"> · {g.insumos}</span> : null}</td>
                      <td className="cm-num">{g.projetado ? moeda.format(g.projetado) : '—'}</td>
                      <td className="cm-num">{pctFmt(g.pct.solicitado)}</td>
                      <td className="cm-num">{pctFmt(g.pct.pedido)}</td>
                      <td className="cm-num">{pctFmt(g.pct.contratado)}</td>
                      <td className="cm-num">{pctFmt(g.pct.realizado)}</td>
                      <td className="cm-num">{g.projetado ? moeda.format(g.falta) : '—'}</td>
                      <td>{dataFmt(g.inicio)}</td>
                      <td>{dataFmt(g.limite)} <span className="cm-muted">{limiteTexto(g.dias_ate_limite)}</span></td>
                      <td><span className={`cm-sinal cm-${g.sinal}`}>{SINAIS[g.sinal]}</span></td>
                    </tr>
                    {aberto === g.id && (
                      <tr className="cm-sub"><td colSpan={10}><ContratacoesMicro projectId={projectId} grupoId={g.id} /></td></tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
