import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, type Fase, type LinhaMacro, type Macro, type Tipo } from './contratacoes-api'
import { ContratacoesMicro } from './ContratacoesMicro'
import './ContratacoesMacro.css'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const pctFmt = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const dataFmt = (d: string | null) => (d ? d.split('-').reverse().join('/') : '—')
// Situação do grupo na fase escolhida. Rever projeção, sem projeção e
// concluído valem para todas as fases; o resto vem da flag da fase.
type Situacao = 'ATRASADO' | 'ATENCAO' | 'PENDENCIA' | 'NO_PRAZO' | 'FEITO' | 'SEM_DATA' | 'SEM_PROJECAO' | 'CONCLUIDO'
const SITUACOES: Record<Situacao, string> = {
  ATRASADO: 'Atrasado', ATENCAO: 'Atenção', PENDENCIA: 'Rever projeção/dados', NO_PRAZO: 'No prazo', FEITO: 'Fase feita',
  SEM_DATA: 'Sem data no cronograma', SEM_PROJECAO: 'Sem custo projetado', CONCLUIDO: 'Concluído',
}
const ORDEM = Object.keys(SITUACOES) as Situacao[]
const flagDa = (g: LinhaMacro, fase: Fase) => g.flags.find((f) => f.fase === fase)
const situacao = (g: LinhaMacro, fase: Fase): Situacao =>
  g.sinal === 'PENDENCIA' || g.sinal === 'SEM_PROJECAO' || g.sinal === 'CONCLUIDO' ? g.sinal : flagDa(g, fase)?.estado ?? 'SEM_DATA'
const TIPOS: Record<Tipo, string> = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de obra' }
const FASES: Record<Fase, string> = { SOLICITACAO: 'Solicitação', MAPA: 'Mapa de cotação', PEDIDO_CONTRATO: 'Pedido/Contrato' }
const limiteTexto = (d: number | null) => (d === null ? '' : d < 0 ? `há ${-d} dias` : d === 0 ? 'hoje' : `em ${d} dias`)

export function ContratacoesMacro({ projectId, onConfigurar }: { projectId: string; onConfigurar: () => void }) {
  const [macro, setMacro] = useState<Macro | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tipo, setTipo] = useState<Tipo>('MATERIAL')
  const [fase, setFase] = useState<Fase>('SOLICITACAO')
  const [filtro, setFiltro] = useState<Situacao | null>(null)
  const [aberto, setAberto] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    setMacro(null); setErro(null); setFiltro(null); setAberto(null)
    api.macro(projectId).then((m) => { if (vivo) setMacro(m) }).catch((e) => { if (vivo) setErro((e as Error).message) })
    return () => { vivo = false }
  }, [projectId])

  const doTipo = useMemo(() => (macro?.grupos || []).filter((g) => g.tipo === tipo), [macro, tipo])
  const contagem = useMemo(() => {
    const c = Object.fromEntries(ORDEM.map((s) => [s, 0])) as Record<Situacao, number>
    for (const g of doTipo) c[situacao(g, fase)]++
    return c
  }, [doTipo, fase])
  const linhas = useMemo(() => doTipo.filter((g) => !filtro || situacao(g, fase) === filtro)
    .sort((a, b) => ORDEM.indexOf(situacao(a, fase)) - ORDEM.indexOf(situacao(b, fase))
      || String(flagDa(a, fase)?.limite ?? '9').localeCompare(String(flagDa(b, fase)?.limite ?? '9'))), [doTipo, filtro, fase])

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
        <span className="cm-separador" aria-hidden="true">|</span>
        {(Object.keys(FASES) as Fase[]).map((f) => (
          <button type="button" role="tab" key={f} aria-selected={fase === f} className="cm-fase"
            onClick={() => { setFase(f); setFiltro(null) }}>
            Limite {FASES[f].toLowerCase()}
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
          {ORDEM.filter((s) => contagem[s]).map((s) => (
            <button type="button" key={s} className={`cm-sinal cm-${s} ${filtro === s ? 'ativo' : ''}`} aria-pressed={filtro === s}
              onClick={() => setFiltro(filtro === s ? null : s)}>
              {SITUACOES[s]} · {contagem[s]}
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
                <th>Início</th><th>Limite {FASES[fase].toLowerCase()}</th><th>Situação</th>
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
                    <td>{dataFmt(flagDa(g, fase)?.limite ?? null)} <span className="cm-muted">{limiteTexto(flagDa(g, fase)?.dias ?? null)}</span></td>
                    <td><span className={`cm-sinal cm-${situacao(g, fase)}`}>{SITUACOES[situacao(g, fase)]}</span></td>
                  </tr>
                  {aberto === g.id && (
                    <tr className="cm-sub"><td colSpan={12}><ContratacoesMicro projectId={projectId} grupoId={g.id} /></td></tr>
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
