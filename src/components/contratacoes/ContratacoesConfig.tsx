import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { api, type Config, type Conflito, type Grupo, type Previa, type Tipo } from './contratacoes-api'
import { ContratacoesAprovacoes } from './ContratacoesAprovacoes'
import './ContratacoesConfig.css'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : moeda.format(v))
const TIPO_LABEL: Record<Tipo, string> = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de obra' }
type CampoPrazo = 'lead_time' | 'levantamento'
const PRAZOS: { campo: CampoPrazo; label: string }[] = [
  { campo: 'lead_time', label: 'Lead time' }, { campo: 'levantamento', label: 'Levantamento' },
]
const novoGrupo = (tipo: Tipo, ordem: number): Grupo => ({ tipo, item: '', insumos: null, pacote_servicos: null, ordem,
  lead_time: 45, levantamento: 15 })

type Aba = 'grupos' | 'pendencias' | 'custo' | 'insumos' | 'aprovacoes'

export function ContratacoesConfig({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aba, setAba] = useState<Aba>('grupos')
  const [aberto, setAberto] = useState<number | null>(null)
  const [editando, setEditando] = useState<Grupo | null>(null)
  const [confirmarRestaurar, setConfirmarRestaurar] = useState(false)
  const [excluindo, setExcluindo] = useState<number | null>(null)
  const [ramo, setRamo] = useState('')
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [grupoDestino, setGrupoDestino] = useState('')
  const [novoNome, setNovoNome] = useState('')
  const [tipoPend, setTipoPend] = useState<Tipo>('MATERIAL')
  const [conflitos, setConflitos] = useState<{ grupoId: number; codigos: string[]; lista: Conflito[] } | null>(null)
  const [arquivo, setArquivo] = useState<{ nome: string; matriz: unknown[][] } | null>(null)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [referencia, setReferencia] = useState(() => new Date().toISOString().slice(0, 7))
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    try { setErro(null); setConfig(await api.config(projectId)) } catch (e) { setErro((e as Error).message) }
  }, [projectId])

  useEffect(() => {
    setConfig(null); setSelecionadas(new Set()); setPrevia(null); setArquivo(null); setConflitos(null)
    carregar()
  }, [carregar])

  // Devolve true só se a ação deu certo, para não fechar formulários após erro.
  const executar = async (fn: () => Promise<unknown>, sucesso?: string) => {
    setOcupado(true); setErro(null)
    try { await fn(); if (sucesso) setAviso(sucesso); await carregar(); return true } catch (e) { setErro((e as Error).message); return false } finally { setOcupado(false) }
  }

  const pendenciasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (config?.pendencias[tipoPend] || []).filter((p) => !q || `${p.codigo_etapa} ${p.nome}`.toLowerCase().includes(q))
  }, [config, busca, tipoPend])

  // Nível 4 digitado: quantas etapas nível 5 fora de grupo ele inclui.
  const ramoValido = /^\d{2}(\.\d{2}){3}$/.test(ramo.trim())
  const ramoQtd = ramoValido ? (config?.pendencias[tipoPend] || []).filter((p) => p.codigo_etapa.startsWith(ramo.trim() + '.')).length : 0

  const atrelar = async (grupoId: number, codigos: string[], mover = false) => {
    setOcupado(true); setErro(null)
    try {
      const r = await api.atrelar(projectId, grupoId, codigos, mover)
      if (r.conflitos.length) { setConflitos({ grupoId, codigos, lista: r.conflitos }); return }
      setConflitos(null); setSelecionadas(new Set()); setAviso(`${r.inseridas} etapa(s) atrelada(s).`)
      await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  const criarGrupoComSelecionadas = async () => {
    if (!novoNome.trim()) { setErro('Informe o nome do novo grupo.'); return }
    setOcupado(true); setErro(null)
    try {
      const { id } = await api.salvarGrupo(projectId, { ...novoGrupo(tipoPend, (config?.grupos.length || 0) + 1), item: novoNome.trim() })
      setNovoNome('')
      await atrelar(id, [...selecionadas])
    } catch (e) { setErro((e as Error).message); setOcupado(false) }
  }

  const lerInsumos = async (file: File) => {
    setOcupado(true); setErro(null)
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
      const r = await api.importarInsumos(matriz)
      setAviso(`Classificação da empresa importada: ${r.insumos} insumos.`)
      await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  const lerArquivo = async (file: File) => {
    setOcupado(true); setErro(null); setPrevia(null)
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      // Usa a primeira aba que tenha as colunas "CÓDIGO"/"ETAPA" e "CUSTO PROJETADO..." no cabeçalho
      // (ex.: aba PROJEÇÃO da planilha de projeção de custo, ou CUSTOS).
      const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
      const matrizDe = (nome: string) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, raw: true, defval: null })
      const temColunas = (m: unknown[][]) => m.slice(0, 20).some((linha) =>
        linha.some((c) => norm(c).startsWith('CUSTO PROJETADO')) && linha.some((c) => ['CODIGO', 'ETAPA'].includes(norm(c))))
      const nomeAba = wb.SheetNames.find((n) => temColunas(matrizDe(n)))
      if (!nomeAba) throw new Error('Nenhuma aba da planilha tem as colunas "CÓDIGO" e "CUSTO PROJETADO".')
      const matriz = matrizDe(nomeAba)
      setArquivo({ nome: `${file.name} · aba ${nomeAba}`, matriz })
      setPrevia(await api.previa(projectId, matriz))
    } catch (e) { setErro((e as Error).message) } finally { setOcupado(false) }
  }

  if (!config) return <div className="cc-card">{erro ? <p className="cc-erro">{erro}</p> : <p className="cc-muted">Carregando configuração…</p>}</div>

  if (!config.aplicado) {
    return (
      <div className="cc-card cc-vazio">
        <h3>Grupos de contratação desta obra</h3>
        <p>A obra ainda não tem grupos. Aplique o padrão (grupos da planilha do Nizza, com prazos) e depois ajuste o que for preciso.</p>
        <button type="button" className="cc-btn cc-primario" disabled={ocupado}
          onClick={() => executar(async () => {
            const r = await api.aplicarPadrao(projectId)
            setAviso(`Padrão aplicado: ${r.grupos} grupos, ${r.vinculos} etapas atreladas (${r.sugeridos} para confirmar).`)
          })}>
          Aplicar padrão
        </button>
        {erro && <p className="cc-erro">{erro}</p>}
      </div>
    )
  }

  const sugeridas = config.grupos.reduce((s, g) => s + (g.etapas || []).filter((e) => e.situacao === 'SUGERIDO').length, 0)

  return (
    <div className="cc-card">
      <div className="cc-topo">
        <div className="cc-abas" role="tablist">
          <button type="button" role="tab" aria-selected={aba === 'grupos'} onClick={() => setAba('grupos')}>
            Grupos ({config.grupos.length}){sugeridas ? ` · ${sugeridas} a confirmar` : ''}
          </button>
          <button type="button" role="tab" aria-selected={aba === 'pendencias'} onClick={() => setAba('pendencias')}>
            Etapas fora de grupo ({config.pendencias.MATERIAL.length} mat. · {config.pendencias.MAO_DE_OBRA.length} MO)
          </button>
          <button type="button" role="tab" aria-selected={aba === 'custo'} onClick={() => setAba('custo')}>
            Custo projetado{config.importacao ? ` · ${config.importacao.referencia.slice(0, 7)}` : ' · não importado'}
          </button>
          <button type="button" role="tab" aria-selected={aba === 'insumos'} onClick={() => setAba('insumos')}>
            Insumos{config.classificacao.sem_classificacao.length ? ` · ${config.classificacao.sem_classificacao.length} sem classificação` : ''}
          </button>
          <button type="button" role="tab" aria-selected={aba === 'aprovacoes'} onClick={() => setAba('aprovacoes')}>
            Aprovações
          </button>
        </div>
        {aviso && <p className="cc-aviso" onClick={() => setAviso(null)}>{aviso}</p>}
        {erro && <p className="cc-erro">{erro}</p>}
      </div>

      {aba === 'aprovacoes' && <ContratacoesAprovacoes projectId={projectId} />}

      {aba === 'grupos' && (
        <div className="cc-secao">
          <div className="cc-acoes">
            <button type="button" className="cc-btn" onClick={() => setEditando(novoGrupo('MATERIAL', config.grupos.length + 1))}>Novo grupo</button>
            {!confirmarRestaurar
              ? <button type="button" className="cc-btn cc-sutil" onClick={() => setConfirmarRestaurar(true)}>Restaurar padrão</button>
              : (
                <span className="cc-confirma">
                  Isso apaga os ajustes desta obra.
                  <button type="button" className="cc-btn cc-perigo" disabled={ocupado}
                    onClick={() => executar(() => api.aplicarPadrao(projectId, true), 'Padrão restaurado.').then((ok) => ok && setConfirmarRestaurar(false))}>
                    Restaurar
                  </button>
                  <button type="button" className="cc-btn cc-sutil" onClick={() => setConfirmarRestaurar(false)}>Cancelar</button>
                </span>
              )}
          </div>

          {editando && (
            <form className="cc-form" onSubmit={(e) => { e.preventDefault(); executar(() => api.salvarGrupo(projectId, editando), 'Grupo salvo.').then((ok) => ok && setEditando(null)) }}>
              <label>Tipo
                <select id="cc-edit-tipo" value={editando.tipo} onChange={(e) => setEditando({ ...editando, tipo: e.target.value as Tipo })}>
                  <option value="MATERIAL">Material</option><option value="MAO_DE_OBRA">Mão de obra</option>
                </select>
              </label>
              <label>Grupo<input id="cc-edit-item" value={editando.item} onChange={(e) => setEditando({ ...editando, item: e.target.value })} required /></label>
              <label>Insumos<input id="cc-edit-insumos" value={editando.insumos || ''} onChange={(e) => setEditando({ ...editando, insumos: e.target.value })} /></label>
              <label>Pacote de serviços<input id="cc-edit-pacote" value={editando.pacote_servicos || ''} onChange={(e) => setEditando({ ...editando, pacote_servicos: e.target.value })} /></label>
              {PRAZOS.map((p) => (
                <label key={p.campo}>{p.label} (dias)
                  <input id={`cc-edit-${p.campo}`} type="number" min={0} value={editando[p.campo]}
                    onChange={(e) => setEditando({ ...editando, [p.campo]: Number(e.target.value) })} />
                </label>
              ))}
              <div className="cc-acoes">
                <button type="submit" className="cc-btn cc-primario" disabled={ocupado}>Salvar</button>
                <button type="button" className="cc-btn cc-sutil" onClick={() => setEditando(null)}>Cancelar</button>
              </div>
            </form>
          )}

          {(['MATERIAL', 'MAO_DE_OBRA'] as Tipo[]).map((tipo) => (
            <div key={tipo} className="cc-bloco">
              <h4>{TIPO_LABEL[tipo]}</h4>
              <table className="cc-tabela">
                <thead><tr><th>Grupo</th><th>Pacote</th><th className="cc-num">Lead time (dias)</th><th className="cc-num">Etapas</th><th className="cc-num">Projetado</th><th></th></tr></thead>
                <tbody>
                  {config.grupos.filter((g) => g.tipo === tipo).map((g) => {
                    const etapas = g.etapas || []
                    const projetado = etapas.reduce((s, e) => s + (e.custo_projetado || 0), 0)
                    const aConfirmar = etapas.filter((e) => e.situacao === 'SUGERIDO').length
                    return (
                      <Fragment key={g.id}>
                        <tr className="cc-linha-grupo" onClick={() => setAberto(aberto === g.id ? null : g.id ?? null)}>
                          <td>
                            <span aria-hidden="true">{aberto === g.id ? '▾' : '▸'}</span> {g.item}
                            {g.insumos ? <span className="cc-muted"> · {g.insumos}</span> : null}
                            {aConfirmar ? <span className="cc-chip cc-sugerido">{aConfirmar} a confirmar</span> : null}
                          </td>
                          <td>{g.pacote_servicos || '—'}</td>
                          <td className="cc-num">{g.lead_time}</td>
                          <td className="cc-num">{etapas.length || <span className="cc-chip cc-alerta">sem etapas</span>}</td>
                          <td className="cc-num">{config.importacao ? fmt(projetado) : '—'}</td>
                          <td className="cc-acoes-linha" onClick={(e) => e.stopPropagation()}>
                            <button type="button" className="cc-btn cc-sutil" onClick={() => setEditando(g)}>Editar</button>
                            {excluindo !== g.id
                              ? <button type="button" className="cc-btn cc-sutil" onClick={() => setExcluindo(g.id ?? null)}>Excluir</button>
                              : (
                                <span className="cc-confirma">
                                  Excluir o grupo? As etapas voltam para as pendências.
                                  <button type="button" className="cc-btn cc-perigo" disabled={ocupado}
                                    onClick={() => executar(() => api.excluirGrupo(projectId, g.id!), 'Grupo excluído; as etapas voltaram para as pendências.').then((ok) => ok && setExcluindo(null))}>
                                    Excluir
                                  </button>
                                  <button type="button" className="cc-btn cc-sutil" onClick={() => setExcluindo(null)}>Cancelar</button>
                                </span>
                              )}
                          </td>
                        </tr>
                        {aberto === g.id && (
                          <tr>
                            <td colSpan={6}>
                              {etapas.length === 0 ? <p className="cc-muted">Nenhuma etapa. Atrele pela aba "Etapas fora de grupo".</p> : (
                                <table className="cc-tabela cc-interna"><tbody>
                                  {etapas.map((e) => (
                                    <tr key={e.codigo_etapa}>
                                      <td className="cc-mono">{e.codigo_etapa}{e.origem_nivel4 ? <span className="cc-muted"> (via {e.origem_nivel4})</span> : null}</td>
                                      <td>{e.nome_obra}{e.situacao === 'SUGERIDO' ? <span className="cc-muted"> · no padrão: “{e.nome_padrao}”</span> : null}</td>
                                      <td className="cc-num">{fmt(e.custo_projetado)}</td>
                                      <td className="cc-acoes-linha">
                                        {e.situacao === 'SUGERIDO' && (
                                          <button type="button" className="cc-btn cc-primario" onClick={() => executar(() => api.confirmar(projectId, e.codigo_etapa, g.id!), 'Vínculo confirmado.')}>Confirmar</button>
                                        )}
                                        <button type="button" className="cc-btn cc-sutil" onClick={() => executar(() => api.soltar(projectId, e.codigo_etapa, g.id!), 'Etapa solta.')}>Soltar</button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody></table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {aba === 'pendencias' && (
        <div className="cc-secao">
          <div className="cc-abas" role="tablist">
            {(['MATERIAL', 'MAO_DE_OBRA'] as Tipo[]).map((t) => (
              <button type="button" role="tab" key={t} aria-selected={tipoPend === t}
                onClick={() => { setTipoPend(t); setSelecionadas(new Set()); setGrupoDestino(''); setConflitos(null) }}>
                {TIPO_LABEL[t]} ({config.pendencias[t].length})
              </button>
            ))}
          </div>
          <p className="cc-muted">
            Etapas sem grupo de {TIPO_LABEL[tipoPend].toLowerCase()}
            {config.importacao && !config.projecaoSemInsumo ? ` e com custo projetado de ${TIPO_LABEL[tipoPend].toLowerCase()}` : ''}.
            Uma etapa pode ter um grupo de material e um de mão de obra.
          </p>
          <div className="cc-acoes">
            <input id="cc-busca" type="search" placeholder="Buscar código ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <span className="cc-muted">{selecionadas.size} selecionada(s)</span>
            <select id="cc-grupo-destino" value={grupoDestino} onChange={(e) => setGrupoDestino(e.target.value)}>
              <option value="">Atrelar a grupo existente…</option>
              {config.grupos.filter((g) => g.tipo === tipoPend).map((g) => (
                <option key={g.id} value={g.id}>{g.item}{g.insumos ? ` · ${g.insumos}` : ''}</option>
              ))}
            </select>
            <button type="button" className="cc-btn cc-primario" disabled={!grupoDestino || !selecionadas.size || ocupado}
              onClick={() => atrelar(Number(grupoDestino), [...selecionadas])}>
              Atrelar
            </button>
            <input id="cc-ramo" placeholder="ou nível 4 (ex.: 01.03.02.02)" value={ramo} onChange={(e) => setRamo(e.target.value)} />
            {ramoValido && <span className="cc-muted">{ramoQtd} etapa(s) fora de grupo neste ramo</span>}
            <button type="button" className="cc-btn" disabled={!grupoDestino || !ramoValido || ocupado}
              onClick={() => atrelar(Number(grupoDestino), [ramo.trim()]).then(() => setRamo(''))}>
              Atrelar ramo inteiro
            </button>
            <span className="cc-separador">ou</span>
            <input id="cc-novo-grupo-nome" placeholder={`Novo grupo de ${TIPO_LABEL[tipoPend].toLowerCase()}`} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
            <button type="button" className="cc-btn" disabled={!selecionadas.size || ocupado} onClick={criarGrupoComSelecionadas}>
              Criar grupo com as selecionadas
            </button>
          </div>
          {conflitos && (
            <div className="cc-confirma cc-bloco">
              <p>{conflitos.lista.length} etapa(s) já estão em outro grupo: {conflitos.lista.map((c) => `${c.codigo_etapa} (${c.item})`).join(', ')}.</p>
              <button type="button" className="cc-btn cc-primario" onClick={() => atrelar(conflitos.grupoId, conflitos.codigos, true)}>Mover para o grupo escolhido</button>
              <button type="button" className="cc-btn cc-sutil" onClick={() => setConflitos(null)}>Cancelar</button>
            </div>
          )}
          <table className="cc-tabela">
            <thead><tr>
              <th>
                <input id="cc-sel-todas" type="checkbox" aria-label="Selecionar todas"
                  checked={pendenciasFiltradas.length > 0 && pendenciasFiltradas.every((p) => selecionadas.has(p.codigo_etapa))}
                  onChange={(e) => setSelecionadas(e.target.checked ? new Set(pendenciasFiltradas.map((p) => p.codigo_etapa)) : new Set())} />
              </th>
              <th>Etapa</th><th>Nome no orçamento</th><th className="cc-num">Projetado</th><th>Sugestão</th>
            </tr></thead>
            <tbody>
              {pendenciasFiltradas.map((p) => (
                <tr key={p.codigo_etapa}>
                  <td>
                    <input type="checkbox" aria-label={`Selecionar ${p.codigo_etapa}`} checked={selecionadas.has(p.codigo_etapa)}
                      onChange={(e) => {
                        const s = new Set(selecionadas)
                        if (e.target.checked) s.add(p.codigo_etapa); else s.delete(p.codigo_etapa)
                        setSelecionadas(s)
                      }} />
                  </td>
                  <td className="cc-mono">{p.codigo_etapa}</td>
                  <td>{p.nome}</td>
                  <td className="cc-num">{fmt(p.custo_projetado)}</td>
                  <td>
                    {p.sugestao
                      ? <button type="button" className="cc-btn cc-sutil" onClick={() => atrelar(p.sugestao!.grupo_id, [p.codigo_etapa])}>Atrelar a “{p.sugestao.item}” (padrão {p.sugestao.codigo_padrao})</button>
                      : <span className="cc-muted">—</span>}
                  </td>
                </tr>
              ))}
              {pendenciasFiltradas.length === 0 && (
                <tr><td colSpan={5} className="cc-muted">Nenhuma etapa fora de grupo{busca ? ' com essa busca' : ''}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'insumos' && (
        <div className="cc-secao">
          <p className="cc-muted">
            Classificação da empresa (planilha com "Cód.Item", "Descrição do Item" e "Definição Item"): SE = mão de obra; MT, EQ e OU = material.
            "Itens fora de orçamento" contam sempre como material. Importar de novo substitui a classificação da empresa, que vale para todas as obras.
          </p>
          <p>Insumos classificados na empresa: <strong>{config.classificacao.empresa}</strong></p>
          <div className="cc-acoes">
            <input id="cc-insumos" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) lerInsumos(f) }} />
          </div>
          <h4>Sem classificação nesta obra ({config.classificacao.sem_classificacao.length})</h4>
          <p className="cc-muted">Insumos da projeção que não estão na planilha da empresa. Até serem marcados, contam como mão de obra se começarem com "MO ", senão como material.</p>
          {config.classificacao.sem_classificacao.length > 0 && (
            <table className="cc-tabela">
              <thead><tr><th>Insumo</th><th className="cc-num">Projetado</th><th>Hoje conta como</th><th></th></tr></thead>
              <tbody>
                {config.classificacao.sem_classificacao.map((i) => (
                  <tr key={i.descricao}>
                    <td>{i.descricao}</td><td className="cc-num">{fmt(i.projetado)}</td><td>{TIPO_LABEL[i.tipo]}</td>
                    <td className="cc-acoes-linha">
                      {(['MATERIAL', 'MAO_DE_OBRA'] as Tipo[]).map((t) => (
                        <button key={t} type="button" className="cc-btn" disabled={ocupado}
                          onClick={() => executar(() => api.classificarInsumo(projectId, i.descricao, t), 'Insumo classificado nesta obra.')}>
                          {TIPO_LABEL[t]}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h4>Ajustes desta obra ({config.classificacao.obra.length})</h4>
          {config.classificacao.obra.length > 0 && (
            <table className="cc-tabela">
              <tbody>
                {config.classificacao.obra.map((o) => (
                  <tr key={o.descricao}>
                    <td>{o.descricao}</td><td>{TIPO_LABEL[o.tipo]}</td>
                    <td className="cc-acoes-linha">
                      <button type="button" className="cc-btn cc-sutil" disabled={ocupado}
                        onClick={() => executar(() => api.classificarInsumo(projectId, o.descricao, null), 'Ajuste removido.')}>
                        Remover ajuste
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {aba === 'custo' && (
        <div className="cc-secao">
          <p className="cc-muted">
            Envie a planilha de custo projetado (.xlsx, .xlsm ou .csv). A aba com as colunas certas é encontrada sozinha.
            Precisa das colunas "CÓDIGO" (ou "ETAPA") e "CUSTO PROJETADO". Só as etapas de nível 5 entram.
          </p>
          {config.projecaoSemInsumo && (
            <p className="cc-alerta-texto">A última importação não guardou as linhas por insumo. Importe a projeção de novo para separar material e mão de obra.</p>
          )}
          {config.importacao && (
            <p>
              Última importação: referência <strong>{config.importacao.referencia.slice(0, 7)}</strong>,
              total <strong>{fmt(Number(config.importacao.total))}</strong>{config.importacao.arquivo ? ` (${config.importacao.arquivo})` : ''}.
            </p>
          )}
          <div className="cc-acoes">
            <input id="cc-arquivo" type="file" accept=".xlsx,.xlsm,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) lerArquivo(f) }} />
            <label>Mês de referência <input id="cc-referencia" type="month" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
          </div>
          {previa && arquivo && (
            <div className="cc-bloco">
              <p>
                <strong>{previa.itens.length}</strong> etapas lidas, total <strong>{fmt(previa.total)}</strong>
                {previa.totalAnterior !== null ? <> · anterior {fmt(previa.totalAnterior)} (diferença {fmt(previa.total - previa.totalAnterior)})</> : null}
                {previa.ignoradas ? <> · {previa.ignoradas} linha(s) sem valor ignoradas</> : null}
              </p>
              {previa.foraDoOrcamento.length > 0 && (
                <p className="cc-alerta-texto">
                  {previa.foraDoOrcamento.length} etapa(s) não existem no orçamento desta obra: {previa.foraDoOrcamento.slice(0, 12).join(', ')}{previa.foraDoOrcamento.length > 12 ? '…' : ''}
                </p>
              )}
              {previa.erros.length > 0 && (
                <ul className="cc-erro">{previa.erros.slice(0, 20).map((er) => <li key={`${er.linha}-${er.motivo}`}>Linha {er.linha}: {er.motivo}</li>)}</ul>
              )}
              <button type="button" className="cc-btn cc-primario" disabled={ocupado || previa.erros.length > 0 || previa.itens.length === 0}
                onClick={() => executar(async () => {
                  const r = await api.importar(projectId, referencia, arquivo.nome, arquivo.matriz)
                  setAviso(`Custo projetado importado: ${r.itens} etapas, total ${fmt(r.total)}.`)
                  setPrevia(null); setArquivo(null)
                })}>
                Confirmar importação
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
