import { Fragment, useEffect, useState } from 'react'
import { api, type ItemMicro, type Passo, type StatusPasso } from './contratacoes-api'

const NOMES: Record<string, string> = {
  SOLICITACAO: 'Solicitação', ESTOURO: 'Estouro', MAPA: 'Mapa de cotação', PEDIDO: 'Pedido',
  CONTRATO: 'Contrato', ADITIVO: 'Aditivo', MEDICAO: 'Medição', COMPRA: 'Pedido/Contrato',
}
const STATUS: Record<StatusPasso, string> = { NAO_INICIADO: 'Não iniciado', PENDENTE: 'Pendente', APROVADO: 'Aprovado', REPROVADO: 'Reprovado', DISPENSADO: 'Dispensado' }
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const moedaUnit = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const FONTE: Record<ItemMicro['valor_fonte'], string> = { PEDIDO: 'pedido', CONTRATO: 'contrato', SOLICITACAO: 'solicitação' }
// Horário já vem no fuso das obras (AAAA-MM-DDTHH:MM); só reordena.
const dataHora = (d: string | null) => (d ? `${d.slice(0, 10).split('-').reverse().join('/')}${d.length > 10 ? ` ${d.slice(11, 16)}` : ''}` : '')

// Um passo numa célula: status, aprovações x/y e quem aprovou (no title).
// Passo que já tem documento posterior conta como aprovado com o que teve.
function Celula({ p }: { p: Passo | undefined }) {
  if (!p) return <span className="cm-muted">—</span>
  const titulo = [p.implicito ? 'Seguiu adiante: já existe documento posterior' : '', p.aprovadores.join(', '), dataHora(p.ultimo)]
  return (
    <span className={`cm-cel cm-p-${p.status}`} title={titulo.filter(Boolean).join(' · ')}>
      {p.numero != null && <small>{p.numero} </small>}
      {STATUS[p.status]}
      {p.implicito ? (p.feitas ? ` (${p.feitas} aprov.)` : '') : p.exigidas ? ` ${p.feitas}/${p.exigidas}` : ''}
      {p.status === 'NAO_INICIADO' && p.numero != null && <small> · sem registro no Approvo</small>}
    </span>
  )
}

function Medicoes({ it }: { it: ItemMicro }) {
  const [aberto, setAberto] = useState(false)
  const r = it.resumo_medicoes
  if (!r.total) return <span className="cm-muted">—</span>
  return (
    <span>
      <button type="button" className="cm-btn cm-link" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        {r.aprovadas}/{r.total} aprovadas
        {r.pendente ? ` · ${r.pendente.numero} pendente${r.pendente.dias !== null ? ` há ${r.pendente.dias} dias` : ''}` : ''}
        {r.reprovadas ? ` · ${r.reprovadas} reprovada(s)` : ''}
      </button>
      {aberto && (
        <ul className="cm-medicoes">
          {it.medicoes.map((m) => <li key={m.numero}><Celula p={m} /></li>)}
        </ul>
      )}
    </span>
  )
}

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

  // Agrupa as linhas consecutivas da mesma solicitação (o servidor já ordena assim).
  const grupos: ItemMicro[][] = []
  for (const it of itens) {
    const ult = grupos[grupos.length - 1]
    if (ult && ult[0].solicitacao === it.solicitacao) ult.push(it); else grupos.push([it])
  }
  const passo = (it: ItemMicro, ...nomes: string[]) => it.passos.find((p) => nomes.includes(p.passo))

  return (
    <div className="cm-rolagem">
      <table className="cm-tabela cm-micro">
        <thead>
          <tr>
            <th>Solicitação</th><th>Insumo</th><th>Etapa</th><th>Fornecedor</th><th className="cm-num">Qtde</th><th className="cm-num">Unitário</th><th className="cm-num">Total</th>
            <th>Mapa</th><th>Pedido/Contrato</th><th>Medições</th><th>Parado em</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((linhas) => (
            <Fragment key={linhas[0].solicitacao}>
              {linhas.map((it, i) => (
                <tr key={`${it.solicitacao}-${it.sequencia}`} className={i === linhas.length - 1 ? 'cm-fim-sol' : ''}>
                  {i === 0 && (
                    <td rowSpan={linhas.length} className="cm-sol">
                      <strong>{it.solicitacao}</strong><br /><Celula p={passo(it, 'SOLICITACAO')} />
                      {passo(it, 'ESTOURO') && <><br /><small>Estouro: </small><Celula p={passo(it, 'ESTOURO')} /></>}
                    </td>
                  )}
                  <td>
                    <small className="cm-muted">{it.sequencia} · </small>{it.insumo || it.descricao}
                    {it.alerta && <div className="cm-alerta-linha">{it.alerta}</div>}
                  </td>
                  <td title={it.etapas.map((e) => `${e.codigo} ${e.nome ?? ''}`).join('\n')}>{it.etapas.map((e) => e.codigo).join(', ')}</td>
                  <td>{it.fornecedor ?? '—'}</td>
                  <td className="cm-num">{it.qtde ?? '—'}</td>
                  <td className="cm-num">{it.valor_unitario != null ? moedaUnit.format(it.valor_unitario) : '—'}</td>
                  <td className="cm-num">{moeda.format(it.valor)}<br /><small className="cm-muted">{FONTE[it.valor_fonte]}</small></td>
                  <td><Celula p={passo(it, 'MAPA')} /></td>
                  <td>
                    <Celula p={passo(it, 'PEDIDO', 'CONTRATO', 'COMPRA')} />
                    {passo(it, 'ADITIVO') && <><br /><small>Aditivo: </small><Celula p={passo(it, 'ADITIVO')} /></>}
                  </td>
                  <td><Medicoes it={it} /></td>
                  <td>{it.parado_em
                    ? <span className="cm-parado">{NOMES[it.parado_em.passo]}{it.parado_em.passo === 'MEDICAO' ? ` ${it.parado_em.numero}` : ''}{it.dias_parado !== null ? ` há ${it.dias_parado} dias` : ''}</span>
                    : <span className="cm-muted">—</span>}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
