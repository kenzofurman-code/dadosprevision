import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, type EstadoFlag, type Fase, type Macro, type Sinal, type Tipo } from './contratacoes-api'
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
const FASES: Record<Fase, string> = { LEVANTAMENTO: 'Lev', SOLICITACAO: 'Sol', MAPA: 'Mapa', PEDIDO_CONTRATO: 'Ped/Ctr' }
const FASES_LONGO: Record<Fase, string> = { LEVANTAMENTO: 'Levantamento (lembrete)', SOLICITACAO: 'Solicitação', MAPA: 'Mapa de cotação', PEDIDO_CONTRATO: 'Pedido/Contrato' }
const ESTADOS: Record<EstadoFlag, string> = { FEITO: 'feito', ATRASADO: 'atrasado', ATENCAO: 'atenção', NO_PRAZO: 'no prazo', LEMBRETE: 'começar', SEM_DATA: 'sem data' }
const limiteTexto = (d: number | null) => (d === null ? '' : d < 0 ? `há ${-d} dias` : d === 0 ? 'hoje' : `em ${d} dias`)

export function ContratacoesMacro({ projectId, onConfigurar }: { projectId: string; onConfigurar: () => void }) {
  const [macro, setMacro] = useState<Macro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tipo, setTipo] = useState<Tipo>('MATERIAL')
  const [filtro, setFiltro] = useState<Sinal | null>(null)
  const [aberto, setAberto] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    setMacro(null); setErro(null); setFiltro(null); setAberto(null)
    api.macro(projectId).then((m) => { if (vivo) setMacro(m) }).catch((e) => { if (vivo) setErro((e as Error).message) })
    return () => { vivo = false }
  }, [projectId])

  const linhas = useMemo(() => (macro?.grupos || []).filter((g) => g.tipo === tipo && (!filtro || g.sinal === filtro)), [macro, tipo, filtro])

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
  const r = macro.resumo[tipo]

  return (
    <div className="cm-card">
      {!macro.importacao && (
        <p className="cm-aviso">
          Importe o custo projetado em Configurações → Contratações para ver os percentuais.
          <button type="button" className="cm-btn cm-link" onClick={onConfigurar}>Abrir configuração</button>
        </p>
      )}
      {macro.importacao && (macro.projecaoSemInsumo || !macro.classificacaoEmpresa) && (
        <p className="cm-aviso">
          {!macro.classificacaoEmpresa ? 'Importe a planilha de insumos da empresa (Configurar → Insumos) para separar material e mão de obra. ' : ''}
          {macro.projecaoSemInsumo ? 'A projeção importada não tem as linhas por insumo: importe de novo para separar material e mão de obra.' : ''}
          <button type="button" className="cm-btn cm-link" onClick={onConfigurar}>Abrir configuração</button>
        </p>
      )}
      <div className="cm-abas" role="tablist">
        {(['MATERIAL', 'MAO_DE_OBRA'] as Tipo[]).map((t) => (
          <button type="button" role="tab" key={t} aria-selected={tipo === t}
            onClick={() => { setTipo(t); setFiltro(null); setAberto(null) }}>
            {TIPOS[t]} · {moeda.format(macro.resumo[t].projetado_obra)}
          </button>
        ))}
        <span className="cm-muted cm-total">Total da obra {moeda.format(macro.resumo.total_obra)}</span>
      </div>
      <div className="cm-resumo">
        <div><span>Projetado ({TIPOS[tipo].toLowerCase()})</span><strong>{moeda.format(r.projetado_obra)}</strong></div>
        <div><span>Em grupos</span><strong>{moeda.format(r.projetado_grupos)}</strong></div>
        <div><span>Fora de grupos</span><strong>{moeda.format(r.fora_grupos)}</strong></div>
        <div><span>Comprometido</span><strong>{moeda.format(r.comprometido)}</strong></div>
        <div><span>Falta fechar</span><strong>{moeda.format(r.falta_fechar)}</strong></div>
        <div><span>Falta solicitar</span><strong>{moeda.format(r.falta_solicitar)}</strong></div>
        <div className="cm-fichas">
          {(Object.keys(SINAIS) as Sinal[]).filter((s) => r.porSinal[s]).map((s) => (
            <button type="button" key={s} className={`cm-sinal cm-${s} ${filtro === s ? 'ativo' : ''}`} aria-pressed={filtro === s}
              onClick={() => setFiltro(filtro === s ? null : s)}>
              {SINAIS[s]} · {r.porSinal[s]}
            </button>
          ))}
        </div>
        <button type="button" className="cm-btn cm-link" onClick={onConfigurar}>Configurar</button>
      </div>
      {!linhas.length ? <p className="cm-muted">Nenhum grupo de {TIPOS[tipo].toLowerCase()}{filtro ? ' com esse filtro' : ''}. Crie em Configurar.</p> : (
        <div className="cm-rolagem">
          <table className="cm-tabela">
            <thead>
              <tr>
                <th>Grupo</th><th className="cm-num">Projetado</th><th className="cm-num">Solicitado</th>
                <th className="cm-num">Pedido</th><th className="cm-num">Contrato</th><th className="cm-num">Comprometido</th>
                <th className="cm-num">Realizado</th><th className="cm-num">Falta solicitar</th><th className="cm-num">Falta fechar</th>
                <th>Início</th><th>Limite solicitação</th><th>Fases</th><th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((g) => (
                <Fragment key={g.id}>
                  <tr className="cm-linha" onClick={() => setAberto(aberto === g.id ? null : g.id)} aria-expanded={aberto === g.id}>
                    <td><span aria-hidden="true">{aberto === g.id ? '▾' : '▸'}</span> {g.item}{g.insumos ? <span className="cm-muted"> · {g.insumos}</span> : null}</td>
                    <td className="cm-num">{g.projetado ? moeda.format(g.projetado) : '—'}</td>
                    <td className="cm-num">{pctFmt(g.pct.solicitado)}</td>
                    <td className="cm-num">{pctFmt(g.pct.pedido)}</td>
                    <td className="cm-num">{pctFmt(g.pct.contrato)}</td>
                    <td className="cm-num"><strong>{pctFmt(g.pct.comprometido)}</strong></td>
                    <td className="cm-num">{pctFmt(g.pct.realizado)}</td>
                    <td className="cm-num">{g.projetado ? moeda.format(g.falta_solicitar) : '—'}</td>
                    <td className="cm-num">{g.projetado ? moeda.format(g.falta_fechar) : '—'}</td>
                    <td>{dataFmt(g.inicio)}</td>
                    <td>{dataFmt(g.limite)} <span className="cm-muted">{limiteTexto(g.dias_ate_limite)}</span></td>
                    <td className="cm-flags">
                      {g.flags.map((f) => (
                        <span key={f.fase} className={`cm-flag cm-f-${f.estado}`}
                          title={`${FASES_LONGO[f.fase]}: ${ESTADOS[f.estado]}${f.limite ? ` · limite ${dataFmt(f.limite)} ${limiteTexto(f.dias)}` : ''}`}>
                          {FASES[f.fase]}
                        </span>
                      ))}
                    </td>
                    <td><span className={`cm-sinal cm-${g.sinal}`}>{SINAIS[g.sinal]}</span></td>
                  </tr>
                  {aberto === g.id && (
                    <tr className="cm-sub"><td colSpan={13}><ContratacoesMicro projectId={projectId} grupoId={g.id} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
