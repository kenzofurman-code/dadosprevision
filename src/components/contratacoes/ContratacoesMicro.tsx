import { useEffect, useState } from 'react'
import { api, type ItemMicro, type StatusPasso } from './contratacoes-api'

const NOMES: Record<string, string> = {
  SOLICITACAO: 'Solicitação', ESTOURO: 'Estouro', MAPA: 'Mapa de cotação', PEDIDO: 'Pedido',
  CONTRATO: 'Contrato', ADITIVO: 'Aditivo', MEDICAO: 'Medição', COMPRA: 'Pedido/Contrato',
}
const STATUS: Record<StatusPasso, string> = { NAO_INICIADO: 'Não iniciado', PENDENTE: 'Pendente', APROVADO: 'Aprovado', REPROVADO: 'Reprovado', DISPENSADO: 'Dispensado' }
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
// Horário já vem no fuso das obras (AAAA-MM-DDTHH:MM); só reordena.
const dataHora = (d: string | null) => (d ? `${d.slice(0, 10).split('-').reverse().join('/')}${d.length > 10 ? ` ${d.slice(11, 16)}` : ''}` : '')

export function ContratacoesMicro({ projectId, grupoId }: { projectId: string; grupoId: number }) {
  const [itens, setItens] = useState<ItemMicro[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    api.micro(projectId, grupoId).then((r) => { if (vivo) setItens(r.itens) }).catch((e) => { if (vivo) setErro((e as Error).message) })
    return () => { vivo = false }
  }, [projectId, grupoId])
  if (erro) return <p className="cm-erro">{erro}</p>
  if (!itens) return <p className="cm-muted">Carregando itens…</p>
  if (!itens.length) return <p className="cm-muted">Nenhuma solicitação do Mega nas etapas deste grupo.</p>
  return (
    <div className="cm-micro">
      {itens.map((it) => (
        <div key={`${it.solicitacao}-${it.sequencia}`} className="cm-item">
          <div className="cm-item-cab">
            <strong>Sol. {it.solicitacao}/{it.sequencia}</strong> {it.descricao}
            <span className="cm-muted">{it.fornecedor ?? ''} · {moeda.format(it.valor)}</span>
            <span className="cm-muted">{it.etapas.map((e) => `${e.codigo} ${e.nome ?? ''}`).join(' · ')}</span>
            {it.parado_em && <span className="cm-parado">Parado em {NOMES[it.parado_em.passo]}{it.dias_parado !== null ? ` há ${it.dias_parado} dias` : ''}</span>}
          </div>
          <ol className="cm-trilha">
            {it.passos.map((p, i) => (
              <li key={i} className={`cm-passo cm-p-${p.status}`} title={p.aprovadores.join(', ')}>
                <span>{NOMES[p.passo]}{p.numero != null ? ` ${p.numero}` : ''}</span>
                <span>{STATUS[p.status]}{p.exigidas ? ` · ${p.feitas}/${p.exigidas}` : ''}</span>
                {p.aprovadores.length > 0 && <small>{p.aprovadores.join(', ')}</small>}
                {p.ultimo && <small>{dataHora(p.ultimo)}</small>}
                {p.status === 'NAO_INICIADO' && p.numero != null && <small>sem registro no Approvo</small>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}
