export type Tipo = 'MATERIAL' | 'MAO_DE_OBRA'
export interface EtapaGrupo { codigo_etapa: string; situacao: 'CONFIRMADO' | 'SUGERIDO'; nome_padrao: string | null; nome_obra: string | null; origem_nivel4: string | null; custo_projetado: number | null }
export interface Grupo { id?: number; tipo: Tipo; item: string; insumos: string | null; pacote_servicos: string | null; ordem: number; lead_time: number; levantamento: number; etapas?: EtapaGrupo[] }
export interface Pendencia { codigo_etapa: string; nome: string; custo_projetado: number | null; sugestao: { grupo_id: number; item: string; codigo_padrao: string } | null }
export interface InsumoSemClassificacao { descricao: string; tipo: Tipo; projetado: number }
export interface Config {
  etapas: { codigo_etapa: string; nome: string; custos: Record<Tipo, number | null> }[]
  aplicado: boolean; grupos: Grupo[]; pendencias: Record<Tipo, Pendencia[]>
  importacao: { referencia: string; total: string; importado_em: string; arquivo: string | null } | null; orcamentoTotal: number
  projecaoSemInsumo: boolean
  classificacao: { empresa: number; obra: { descricao: string; tipo: Tipo }[]; sem_classificacao: InsumoSemClassificacao[] }
}
export interface Previa { itens: { codigo_etapa: string; custo_projetado: number }[]; total: number; ignoradas: number; erros: { linha: number; motivo: string }[]; foraDoOrcamento: string[]; totalAnterior: number | null }
export interface Conflito { codigo_etapa: string; grupo_id: number; item: string }
export type Sinal = 'ATRASADO' | 'ATENCAO' | 'PENDENCIA' | 'NO_PRAZO' | 'SEM_DATA' | 'SEM_PROJECAO' | 'CONCLUIDO'
type Pct = { solicitado: number | null; pedido: number | null; contrato: number | null; comprometido: number | null; realizado: number | null }
export type Fase = 'SOLICITACAO' | 'MAPA' | 'PEDIDO_CONTRATO'
export type EstadoFlag = 'FEITO' | 'ATRASADO' | 'ATENCAO' | 'NO_PRAZO' | 'SEM_DATA'
export interface Flag { fase: Fase; limite: string | null; dias: number | null; estado: EstadoFlag }
export interface LinhaMacro {
  id: number; tipo: Tipo; item: string; insumos: string | null; lead_time: number; etapas: number
  projetado: number; solicitado: number; solicitado_efetivo: number; cotado: number; em_pedido: number; em_contrato: number
  pedido: number; contrato: number; comprometido: number; realizado: number; falta_solicitar: number; falta_fechar: number
  pct: Pct; inicio: string | null; limite: string | null; dias_ate_limite: number | null; sinal: Sinal; flags: Flag[]
}
export interface ResumoTipo { projetado_obra: number; projetado_grupos: number; fora_grupos: number; comprometido: number; falta_solicitar: number; falta_fechar: number; porSinal: Record<Sinal, number> }
export interface Macro {
  obra: string | null; motivo?: string; importacao: Config['importacao']; projecaoSemInsumo?: boolean; classificacaoEmpresa?: number
  grupos: LinhaMacro[]; resumo: { total_obra: number } & Record<Tipo, ResumoTipo>
}

export interface Regras { solicitacao: number; estouro: number; estouro_minimo: number; mapa: number; compra_ate: number; compra_acima: number; alcada_valor: number; aditivo: number; medicao: number }
export type StatusPasso = 'NAO_INICIADO' | 'PENDENTE' | 'APROVADO' | 'REPROVADO' | 'DISPENSADO'
export interface Passo { passo: string; numero: number | null; status: StatusPasso; exigidas: number; feitas: number; aprovadores: string[]; ultimo: string | null; valor: number | null; implicito?: boolean }
export interface ResumoMedicoes { total: number; aprovadas: number; reprovadas: number; pendente: { numero: number; dias: number | null } | null }
export interface ItemMicro {
  solicitacao: number; sequencia: number; descricao: string | null; insumo: string | null; fornecedor: string | null
  valor: number; valor_unitario: number | null; valor_fonte: 'PEDIDO' | 'CONTRATO' | 'SOLICITACAO'; qtde: number | null
  etapas: { codigo: string; nome: string | null }[]; cotacao: number | null; pedido: number | null; contrato: number | null
  passos: Passo[]; medicoes: Passo[]; resumo_medicoes: ResumoMedicoes; parado_em: Passo | null; dias_parado: number | null; alerta: string | null
}

async function chamar<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 409) throw new Error(data.error || `Erro ${res.status}`)
  return { status: res.status, data }
}
const post = <T>(url: string, body: unknown) => chamar<T>(url, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  regras: (projectId: string) => chamar<Regras>(`/api/contratacoes/regras?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
  salvarRegras: (projectId: string, regras: Regras) => chamar<Regras>('/api/contratacoes/regras', { method: 'PUT', body: JSON.stringify({ projectId, regras }) }).then((r) => r.data),
  micro: (projectId: string, grupoId: number) => chamar<{ obra: string | null; itens: ItemMicro[] }>(`/api/contratacoes/micro?projectId=${encodeURIComponent(projectId)}&grupoId=${grupoId}`).then((r) => r.data),
  macro: (projectId: string) => chamar<Macro>(`/api/contratacoes/macro?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
  config: (projectId: string) => chamar<Config>(`/api/contratacoes/config?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
  aplicarPadrao: (projectId: string, restaurar = false) => post<{ grupos: number; vinculos: number; sugeridos: number; conflitos: number }>('/api/contratacoes/aplicar-padrao', { projectId, restaurar }).then((r) => r.data),
  salvarGrupo: (projectId: string, grupo: Grupo) => post<{ id: number }>('/api/contratacoes/grupos', { projectId, grupo }).then((r) => r.data),
  excluirGrupo: (projectId: string, id: number) => chamar(`/api/contratacoes/grupos/${id}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  atrelar: (projectId: string, grupoId: number, codigos: string[], mover = false) => post<{ inseridas: number; conflitos: Conflito[] }>(`/api/contratacoes/grupos/${grupoId}/etapas`, { projectId, codigos, mover }).then((r) => r.data),
  soltar: (projectId: string, codigo: string, grupoId: number) => chamar(`/api/contratacoes/etapas/${encodeURIComponent(codigo)}?projectId=${encodeURIComponent(projectId)}&grupoId=${grupoId}`, { method: 'DELETE' }),
  confirmar: (projectId: string, codigo: string, grupoId: number) => post(`/api/contratacoes/etapas/${encodeURIComponent(codigo)}/confirmar`, { projectId, grupoId }),
  importarInsumos: (matriz: unknown[][]) => post<{ insumos: number; ignoradas: number }>('/api/contratacoes/insumos/importar', { matriz }).then((r) => r.data),
  classificarInsumo: (projectId: string, descricao: string, tipo: Tipo | null) => post('/api/contratacoes/insumos/obra', { projectId, descricao, tipo }),
  previa: (projectId: string, matriz: unknown[][]) => post<Previa>('/api/contratacoes/custo/previa', { projectId, matriz }).then((r) => r.data),
  importar: (projectId: string, referencia: string, arquivo: string, matriz: unknown[][]) => post<{ id: number; total: number; itens: number }>('/api/contratacoes/custo/importar', { projectId, referencia, arquivo, matriz }).then((r) => r.data),
}
