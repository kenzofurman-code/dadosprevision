import { useCallback, useEffect, useMemo, useState } from 'react'
import './PainelTeorico.css'

interface Linha {
  codigo: string
  descricao: string
  nivel: number
  orcamento_reajustado: number | null
  apropriado_reajustado: number
  saldo_contratos: number
  saldo_pedidos: number
  comprometido: number
  custo_projetado: number | null
  resultado: number | null
  evolucao_financeira: number | null
  medicao_fisica: number
  resultado_teorico: number | null
  regua_a: number | null
  regua_b: number | null
}

interface Painel {
  obra: string | null
  importacao: { referencia: string; arquivo: string | null } | null
  apropriadoSemEtapa: number
  reajuste: {
    indice: string
    mes_base: string | null
    fator: number | null
    ultimo_mes: string | null
    meses: Array<{ mes: string; variacao: number }>
  }
  linhas: Linha[]
  ranking: { A: string[]; B: string[] }
}

type Regua = 'A' | 'B'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const din = (v: number | null) => (v === null ? '—' : moeda.format(v))
const pct = (v: number | null, casas = 2) => (v === null ? '—' : `${(v * 100).toFixed(casas).replace('.', ',')}%`)
const pp = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(2).replace('.', ',')} p.p.`)
const mesFmt = (m: string | null) => (m ? m.split('-').reverse().join('/') : '—')
const REGUAS: Record<Regua, string> = { A: 'Evolução financeira − Medição física', B: 'Teórico x Projeção' }
// Régua A positiva = gastou mais do que andou; régua B negativa = teórico abaixo da projeção.
const ruim = (regua: Regua, v: number | null) => v !== null && (regua === 'A' ? v > 0 : v < 0)

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(json.error || `Erro ${res.status}`)
  return json as T
}

export function PainelTeorico({ projectId }: { projectId: string }) {
  const [painel, setPainel] = useState<Painel | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [modo, setModo] = useState<'eap' | 'maiores'>('maiores')
  const [regua, setRegua] = useState<Regua>('A')
  const [n, setN] = useState(15)
  const [mesBase, setMesBase] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    try {
      const p = await chamar<Painel>(`/api/painel-teorico?projectId=${encodeURIComponent(projectId)}`)
      setPainel(p)
      setMesBase(p.reajuste.mes_base || '')
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [projectId])

  useEffect(() => {
    setPainel(null)
    carregar()
  }, [carregar])

  async function salvarMesBase() {
    setOcupado(true)
    try {
      await chamar('/api/painel-teorico/mes-base', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, mes_base: mesBase }),
      })
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  async function atualizarIndices() {
    setOcupado(true)
    try {
      await chamar('/api/incc/sincronizar', { method: 'POST' })
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  // Maiores variações: as N etapas nível 5 do ranking + todos os níveis acima delas (cascata)
  const { visiveis, posicao } = useMemo(() => {
    const todas = painel?.linhas || []
    if (modo === 'eap') return { visiveis: todas, posicao: new Map<string, number>() }
    const selecionadas = (painel?.ranking[regua] || []).slice(0, n)
    const posicao = new Map(selecionadas.map((c, i) => [c, i + 1]))
    const visiveis = todas.filter((l) => selecionadas.some((s) => s === l.codigo || s.startsWith(`${l.codigo}.`)))
    return { visiveis, posicao }
  }, [painel, modo, regua, n])

  if (erro && !painel) return <div className="pt-card"><p className="pt-erro">{erro}</p></div>
  if (!painel) return <div className="pt-card"><p className="pt-muted">Carregando teórico x físico…</p></div>

  const { reajuste } = painel
  const semBase = !reajuste.mes_base

  return (
    <div className="pt-card">
      <div className="pt-incc">
        <div>
          <span>Mês-base do orçamento (Prevision)</span>
          <div className="pt-inline">
            <input type="month" value={mesBase} onChange={(e) => setMesBase(e.target.value)} disabled={ocupado} />
            <button type="button" className="pt-btn" onClick={salvarMesBase} disabled={ocupado || !mesBase || mesBase === reajuste.mes_base}>
              Salvar
            </button>
          </div>
        </div>
        <div>
          <span>Reajuste {reajuste.indice}</span>
          <strong>{reajuste.fator === null ? '—' : `${reajuste.fator.toFixed(4).replace('.', ',')} (${pct(reajuste.fator - 1)})`}</strong>
        </div>
        <div>
          <span>Índices até</span>
          <strong>{mesFmt(reajuste.ultimo_mes)}</strong>
        </div>
        <button type="button" className="pt-btn" onClick={atualizarIndices} disabled={ocupado}>
          Atualizar índices
        </button>
        {reajuste.meses.length > 0 && (
          <details className="pt-meses">
            <summary>{reajuste.meses.length} meses desde o mês-base</summary>
            <ul>
              {reajuste.meses.map((m) => (
                <li key={m.mes}>
                  {mesFmt(m.mes)}: {m.variacao.toFixed(2).replace('.', ',')}%
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {erro && <p className="pt-erro">{erro}</p>}
      {semBase && <p className="pt-aviso">Informe o mês-base do orçamento para calcular o orçamento reajustado e as variações.</p>}
      {!reajuste.ultimo_mes && <p className="pt-aviso">Ainda não há índices do INCC-DI gravados. Clique em “Atualizar índices”.</p>}
      {!painel.obra && <p className="pt-aviso">Este projeto não tem obra do Mega vinculada: apropriado e saldos aparecem zerados.</p>}
      {!painel.importacao && <p className="pt-aviso">Sem custo projetado importado: resultado e Teórico x Projeção ficam em branco.</p>}
      {painel.apropriadoSemEtapa > 0 && (
        <p className="pt-muted">Apropriado sem etapa no Mega (fora da tabela): {din(painel.apropriadoSemEtapa)} nominal.</p>
      )}

      <div className="pt-controles">
        <div className="pt-abas" role="tablist">
          <button type="button" role="tab" aria-selected={modo === 'maiores'} onClick={() => setModo('maiores')}>
            Maiores variações
          </button>
          <button type="button" role="tab" aria-selected={modo === 'eap'} onClick={() => setModo('eap')}>
            EAP inteira
          </button>
        </div>
        <label>
          Régua{' '}
          <select value={regua} onChange={(e) => setRegua(e.target.value as Regua)}>
            {(Object.keys(REGUAS) as Regua[]).map((r) => (
              <option key={r} value={r}>{REGUAS[r]}</option>
            ))}
          </select>
        </label>
        {modo === 'maiores' && (
          <label>
            Etapas nível 5{' '}
            <select value={n} onChange={(e) => setN(Number(e.target.value))}>
              <option value={15}>15 maiores</option>
              <option value={20}>20 maiores</option>
            </select>
          </label>
        )}
      </div>

      <div className="pt-rolagem">
        <table className="pt-tabela">
          <thead>
            <tr>
              <th>EAP</th>
              <th className="pt-num">Orç. reajustado</th>
              <th className="pt-num">Apropriado reaj.</th>
              <th className="pt-num">Saldo contratos</th>
              <th className="pt-num">Saldo pedidos</th>
              <th className="pt-num">Comprometido</th>
              <th className="pt-num">Custo projetado</th>
              <th className="pt-num">Resultado</th>
              <th className="pt-num">Evol. financeira</th>
              <th className="pt-num">Medição física</th>
              <th className="pt-num">Resultado teórico</th>
              <th className={`pt-num ${regua === 'A' ? 'pt-ativa' : ''}`}>Financ. − Físico</th>
              <th className={`pt-num ${regua === 'B' ? 'pt-ativa' : ''}`}>Teórico x Projeção</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr>
                <td colSpan={13} className="pt-muted">
                  {modo === 'maiores' ? 'Nenhuma etapa nível 5 com variação calculável para esta régua.' : 'EAP vazia.'}
                </td>
              </tr>
            )}
            {visiveis.map((l) => (
              <tr key={l.codigo} className={`pt-n${l.nivel}`}>
                <td style={{ paddingLeft: 8 + (l.nivel - 1) * 14 }}>
                  {posicao.has(l.codigo) && <span className="pt-pos">#{posicao.get(l.codigo)}</span>}
                  <span className="pt-cod">{l.codigo}</span> {l.descricao}
                </td>
                <td className="pt-num">{din(l.orcamento_reajustado)}</td>
                <td className="pt-num">{din(l.apropriado_reajustado)}</td>
                <td className="pt-num">{din(l.saldo_contratos)}</td>
                <td className="pt-num">{din(l.saldo_pedidos)}</td>
                <td className="pt-num">{din(l.comprometido)}</td>
                <td className="pt-num">{din(l.custo_projetado)}</td>
                <td className="pt-num">{din(l.resultado)}</td>
                <td className="pt-num">{pct(l.evolucao_financeira)}</td>
                <td className="pt-num">{pct(l.medicao_fisica)}</td>
                <td className="pt-num">{din(l.resultado_teorico)}</td>
                <td className={`pt-num ${ruim('A', l.regua_a) ? 'pt-ruim' : ''}`}>{pp(l.regua_a)}</td>
                <td className={`pt-num ${ruim('B', l.regua_b) ? 'pt-ruim' : ''}`}>{pct(l.regua_b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
