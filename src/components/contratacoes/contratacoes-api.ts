export type Tipo = 'MATERIAL' | 'MAO_DE_OBRA'
export interface EtapaGrupo { codigo_etapa: string; situacao: 'CONFIRMADO' | 'SUGERIDO'; nome_padrao: string | null; nome_obra: string | null; origem_nivel4: string | null; custo_projetado: number | null }
export interface Grupo { id?: number; tipo: Tipo; item: string; insumos: string | null; pacote_servicos: string | null; ordem: number; lead_time: number; levantamento: number; etapas?: EtapaGrupo[] }
export interface Pendencia { codigo_etapa: string; nome: string; custo_projetado: number | null; sugestao: { grupo_id: number; item: string; codigo_padrao: string } | null }
export interface Config { aplicado: boolean; grupos: Grupo[]; pendencias: Pendencia[]; importacao: { referencia: string; total: string; importado_em: string; arquivo: string | null } | null; orcamentoTotal: number }
export interface Previa { itens: { codigo_etapa: string; custo_projetado: number }[]; total: number; ignoradas: number; erros: { linha: number; motivo: string }[]; foraDoOrcamento: string[]; totalAnterior: number | null }
export interface Conflito { codigo_etapa: string; grupo_id: number; item: string }

async function chamar<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 409) throw new Error(data.error || `Erro ${res.status}`)
  return { status: res.status, data }
}
const post = <T>(url: string, body: unknown) => chamar<T>(url, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  config: (projectId: string) => chamar<Config>(`/api/contratacoes/config?projectId=${encodeURIComponent(projectId)}`).then((r) => r.data),
  aplicarPadrao: (projectId: string, restaurar = false) => post<{ grupos: number; vinculos: number; sugeridos: number; conflitos: number }>('/api/contratacoes/aplicar-padrao', { projectId, restaurar }).then((r) => r.data),
  salvarGrupo: (projectId: string, grupo: Grupo) => post<{ id: number }>('/api/contratacoes/grupos', { projectId, grupo }).then((r) => r.data),
  excluirGrupo: (projectId: string, id: number) => chamar(`/api/contratacoes/grupos/${id}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  atrelar: (projectId: string, grupoId: number, codigos: string[], mover = false) => post<{ inseridas: number; conflitos: Conflito[] }>(`/api/contratacoes/grupos/${grupoId}/etapas`, { projectId, codigos, mover }).then((r) => r.data),
  soltar: (projectId: string, codigo: string) => chamar(`/api/contratacoes/etapas/${encodeURIComponent(codigo)}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  confirmar: (projectId: string, codigo: string) => post(`/api/contratacoes/etapas/${encodeURIComponent(codigo)}/confirmar`, { projectId }),
  previa: (projectId: string, matriz: unknown[][]) => post<Previa>('/api/contratacoes/custo/previa', { projectId, matriz }).then((r) => r.data),
  importar: (projectId: string, referencia: string, arquivo: string, matriz: unknown[][]) => post<{ id: number; total: number; itens: number }>('/api/contratacoes/custo/importar', { projectId, referencia, arquivo, matriz }).then((r) => r.data),
}
