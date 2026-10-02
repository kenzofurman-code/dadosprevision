import { useMemo, useState } from 'react'
import { api, type Config, type Conflito, type Tipo } from './contratacoes-api'

const tipos: Tipo[] = ['MATERIAL', 'MAO_DE_OBRA']
const labels: Record<Tipo, string> = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de obra' }
const numero = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const mil = (valor: number | null) => valor === null ? '—' : numero.format(valor / 1000)
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const vazio = (): Record<Tipo, Set<string>> => ({ MATERIAL: new Set(), MAO_DE_OBRA: new Set() })

export function ContratacoesVinculos({ projectId, config, onChanged }: {
  projectId: string; config: Config; onChanged: () => Promise<void>
}) {
  const [selecionadas, setSelecionadas] = useState(vazio)
  const [destinos, setDestinos] = useState<Record<Tipo, number | null>>({ MATERIAL: null, MAO_DE_OBRA: null })
  const [filtros, setFiltros] = useState<Record<Tipo, boolean>>({ MATERIAL: true, MAO_DE_OBRA: true })
  const [busca, setBusca] = useState('')
  const [buscaEtapas, setBuscaEtapas] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [conflito, setConflito] = useState<{ tipo: Tipo; grupoId: number; codigos: string[]; lista: Conflito[] } | null>(null)

  const vinculos = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const grupo of config.grupos) {
      for (const etapa of grupo.etapas || []) mapa.set(`${etapa.codigo_etapa}|${grupo.tipo}`, grupo.item)
    }
    return mapa
  }, [config.grupos])
  const etapas = config.etapas.filter((e) => normalizar(`${e.codigo_etapa} ${e.nome}`).includes(normalizar(buscaEtapas)))
  const termos = normalizar(busca).split(/\s+/).filter(Boolean)
  const grupos = config.grupos.filter((g) => filtros[g.tipo] && termos.every((termo) =>
    normalizar(`${g.item} ${g.insumos || ''} ${g.pacote_servicos || ''}`).includes(termo)))
  const ativos = tipos.filter((t) => selecionadas[t].size > 0)
  const destinosValidos = ativos.every((t) => config.grupos.some((g) => g.id === destinos[t] && g.tipo === t))
  const temSelecao = ativos.length > 0 && tipos.some((t) => destinos[t] !== null)
  const totalProjetado = config.importacao ? etapas.reduce((soma, etapa) =>
    soma + (etapa.custos.MATERIAL || 0) + (etapa.custos.MAO_DE_OBRA || 0), 0) : null

  const marcar = (tipo: Tipo, codigo: string, checked: boolean) => {
    setSelecionadas((atual) => {
      const proxima = new Set(atual[tipo])
      if (checked) proxima.add(codigo); else proxima.delete(codigo)
      return { ...atual, [tipo]: proxima }
    })
    setConflito(null); setAviso(null)
  }

  const vincular = async (mover = false) => {
    setOcupado(true); setErro(null); setAviso(null)
    // Cada tipo usa a mesma API e a mesma proteção contra substituição de vínculos.
    const tarefas = mover && conflito ? [conflito] : ativos.map((tipo) => ({ tipo, grupoId: destinos[tipo]!, codigos: [...selecionadas[tipo]] }))
    try {
      for (const tarefa of tarefas) {
        const resultado = await api.atrelar(projectId, tarefa.grupoId, tarefa.codigos, mover)
        if (resultado.conflitos.length) {
          setConflito({ ...tarefa, lista: resultado.conflitos })
          return
        }
        setSelecionadas((atual) => ({ ...atual, [tarefa.tipo]: new Set<string>() }))
        setConflito(null)
        setAviso(`Vínculos de ${labels[tarefa.tipo].toLowerCase()} salvos. ${resultado.inseridas} etapa(s).`)
      }
    } catch (e) { setErro((e as Error).message) }
    finally { await onChanged(); setOcupado(false) }
  }

  return (
    <div className="cc-vinculacao">
      <p className="cc-muted">Marque Material e/ou Mão de obra nas etapas e escolha um grupo de destino para cada tipo.</p>
      {config.projecaoSemInsumo && <p className="cc-alerta-texto">Reimporte o custo projetado para separar os valores de Material e Mão de obra.</p>}
      <div className="cc-vinculo-paineis">
        <section className="cc-vinculo-painel" aria-label="Etapas da EAP">
          <div className="cc-vinculo-cabecalho">
            <h4>Etapas da EAP <span className="cc-muted">({etapas.length})</span></h4>
            <div className="cc-vinculo-filtros">
              <span className="cc-custo-resumo">Custo projetado<strong>{mil(totalProjetado)} R$ mil</strong></span>
              <input type="search" aria-label="Buscar etapas da EAP" placeholder="Buscar código ou etapa" value={buscaEtapas} onChange={(e) => setBuscaEtapas(e.target.value)} />
            </div>
          </div>
          <div className="cc-vinculo-lista">
            <table className="cc-tabela cc-eap">
              <thead><tr><th>Etapa</th><th>Material<br />R$ mil</th><th>Mão de obra<br />R$ mil</th></tr></thead>
              <tbody>{etapas.map((etapa) => (
                <tr key={etapa.codigo_etapa}>
                  <td><span className="cc-mono">{etapa.codigo_etapa}</span><strong title={etapa.nome}>{etapa.nome}</strong></td>
                  {tipos.map((tipo) => {
                    const grupo = vinculos.get(`${etapa.codigo_etapa}|${tipo}`)
                    return <td key={tipo}>
                      <label className="cc-etapa-flag">
                        <input type="checkbox" disabled={ocupado} checked={selecionadas[tipo].has(etapa.codigo_etapa)}
                          aria-label={`${labels[tipo]} da etapa ${etapa.codigo_etapa} ${etapa.nome}`}
                          onChange={(e) => marcar(tipo, etapa.codigo_etapa, e.target.checked)} />
                        <span>{mil(etapa.custos[tipo])}</span>
                      </label>
                      <small className="cc-vinculo-atual" title={grupo}>{grupo || 'Sem vínculo'}</small>
                    </td>
                  })}
                </tr>
              ))}</tbody>
            </table>
            {etapas.length === 0 && <p className="cc-muted cc-vinculo-vazio">Nenhuma etapa encontrada.</p>}
          </div>
        </section>
        <section className="cc-vinculo-painel" aria-label="Grupos de contratação">
          <div className="cc-vinculo-cabecalho">
            <h4>Grupos de contratação <span className="cc-muted">({grupos.length})</span></h4>
            <div className="cc-vinculo-filtros">
              {tipos.map((tipo) => <label key={tipo}><input type="checkbox" checked={filtros[tipo]} onChange={(e) => setFiltros({ ...filtros, [tipo]: e.target.checked })} />{labels[tipo]}</label>)}
              <input type="search" aria-label="Filtrar grupos por texto" placeholder="Buscar grupo, insumo ou pacote" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
          </div>
          <div className="cc-vinculo-lista cc-grupos-lista">
            {grupos.map((grupo) => (
              <label key={grupo.id} className={`cc-grupo-opcao ${destinos[grupo.tipo] === grupo.id ? 'cc-grupo-selecionado' : ''}`}>
                <input type="checkbox" disabled={ocupado} checked={destinos[grupo.tipo] === grupo.id}
                  onChange={(e) => { setDestinos({ ...destinos, [grupo.tipo]: e.target.checked ? grupo.id! : null }); setConflito(null) }} />
                <span><small className="cc-chip cc-alerta">{labels[grupo.tipo]}</small><strong>{grupo.item}</strong>
                  {grupo.insumos && <small className="cc-muted">{grupo.insumos}</small>}
                  {grupo.pacote_servicos && <small className="cc-muted">{grupo.pacote_servicos}</small>}
                  <small className="cc-muted">{grupo.etapas?.length || 0} etapa(s) vinculada(s)</small>
                </span>
              </label>
            ))}
            {grupos.length === 0 && <p className="cc-muted cc-vinculo-vazio">Nenhum grupo encontrado com esses filtros.</p>}
          </div>
        </section>
      </div>
      {temSelecao && <div className="cc-vinculo-rodape">
        <div>{ativos.map((tipo) => <p key={tipo}>{selecionadas[tipo].size} etapa(s) de {labels[tipo].toLowerCase()} → <strong>{config.grupos.find((g) => g.id === destinos[tipo])?.item || 'Selecione um grupo deste tipo'}</strong></p>)}</div>
        <button type="button" className="cc-btn cc-primario" disabled={ocupado || !destinosValidos || !!conflito} onClick={() => vincular()}>{ocupado ? 'Vinculando…' : 'Vincular etapas aos grupos'}</button>
      </div>}
      {conflito && <div className="cc-confirma cc-bloco" role="alert">
        <p>Estas etapas já têm grupo de {labels[conflito.tipo].toLowerCase()}: {conflito.lista.map((c) => `${c.codigo_etapa} (${c.item})`).join(', ')}. Deseja substituir esses vínculos?</p>
        <div className="cc-acoes">
          <button type="button" className="cc-btn cc-primario" disabled={ocupado} onClick={() => vincular(true)}>Mover para o grupo escolhido</button>
          <button type="button" className="cc-btn" disabled={ocupado} onClick={() => setConflito(null)}>Cancelar</button>
        </div>
      </div>}
      {erro && <p className="cc-erro" role="alert">{erro}</p>}
      {aviso && <p className="cc-aviso" role="status">{aviso}</p>}
    </div>
  )
}
