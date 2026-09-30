import { useEffect, useState } from 'react'
import { api, type Regras } from './contratacoes-api'

// Quantas aprovações cada passo do Approvo exige nesta obra (spec seção 12).
// Só números: os nomes dos aprovadores não entram na regra.
const CAMPOS: { campo: keyof Regras; label: string }[] = [
  { campo: 'solicitacao', label: 'Solicitação de obra' },
  { campo: 'estouro', label: 'Estouro de orçamento' },
  { campo: 'estouro_minimo', label: 'Estouro exige aprovação acima de (R$)' },
  { campo: 'mapa', label: 'Mapa de cotação' },
  { campo: 'compra_ate', label: 'Pedido/contrato até a alçada' },
  { campo: 'compra_acima', label: 'Pedido/contrato acima da alçada' },
  { campo: 'alcada_valor', label: 'Valor da alçada (R$)' },
  { campo: 'aditivo', label: 'Aditivo de contrato' },
  { campo: 'medicao', label: 'Medição de contrato' },
]

export function ContratacoesAprovacoes({ projectId }: { projectId: string }) {
  const [regras, setRegras] = useState<Regras | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    setRegras(null); setErro(null); setAviso(null)
    api.regras(projectId).then((r) => { if (vivo) setRegras(r) }).catch((e) => { if (vivo) setErro((e as Error).message) })
    return () => { vivo = false }
  }, [projectId])

  if (!regras) return <div className="cc-secao">{erro ? <p className="cc-erro">{erro}</p> : <p className="cc-muted">Carregando…</p>}</div>

  const salvar = async () => {
    if (CAMPOS.some(({ campo }) => !Number.isInteger(regras[campo]) || regras[campo] < 0)) { setErro('Preencha todos os campos com números inteiros.'); return }
    setOcupado(true); setErro(null); setAviso(null)
    try { setRegras(await api.salvarRegras(projectId, regras)); setAviso('Aprovações salvas.') }
    catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  return (
    <div className="cc-secao">
      <p className="cc-muted">Quantas pessoas diferentes precisam aprovar cada passo no Approvo. Uma reprovação zera o passo.</p>
      <div className="cc-regras">
        {CAMPOS.map(({ campo, label }) => (
          <label key={campo}>
            <span>{label}</span>
            <input type="number" min={0} step={1} value={Number.isNaN(regras[campo]) ? '' : regras[campo]}
              onChange={(e) => setRegras({ ...regras, [campo]: e.target.value === '' ? NaN : Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <div className="cc-acoes">
        <button type="button" className="cc-btn cc-primario" disabled={ocupado} onClick={salvar}>Salvar aprovações</button>
        {aviso && <span className="cc-muted">{aviso}</span>}
        {erro && <span className="cc-erro">{erro}</span>}
      </div>
    </div>
  )
}
