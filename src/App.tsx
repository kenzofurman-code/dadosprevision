import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ChartNoAxesCombined,
  Database,
  Flag,
  History,
  Layers3,
  ListChecks,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  WalletCards,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './App.css'

type DataView =
  | 'projects'
  | 'activities'
  | 'floors'
  | 'services'
  | 'milestones'
  | 'baselines'
  | 'responsibles'
  | 'restrictions'
  | 'budgets'
  | 'dashboard'

type ActivityMode = 'planning' | 'progress' | 'resources'
type BudgetMode = 'reports' | 'items'
type DashboardMode = 'general' | 'monthly' | 'services' | 'floors' | 'states'

type DataRecord = Record<string, string | number | boolean | null | undefined>

type Project = DataRecord & {
  id_prevision?: string
  nome_projeto?: string
  desativado?: boolean
}

type Column = {
  label: string
  render: (record: DataRecord) => ReactNode
  align?: 'right'
}

type TabDefinition = {
  key: DataView
  label: string
  icon: LucideIcon
  totalField?: string
}

const PAGE_SIZE = 100

const tabs: TabDefinition[] = [
  { key: 'projects', label: 'Projetos', icon: Building2 },
  { key: 'activities', label: 'Atividades', icon: ListChecks, totalField: 'total_atividades' },
  { key: 'floors', label: 'Pavimentos', icon: Layers3, totalField: 'total_pavimentos' },
  { key: 'services', label: 'Serviços', icon: Wrench, totalField: 'total_servicos' },
  { key: 'milestones', label: 'Marcos', icon: Flag, totalField: 'total_marcos' },
  { key: 'baselines', label: 'Linhas de base', icon: History, totalField: 'total_linhas_base' },
  { key: 'responsibles', label: 'Responsáveis', icon: Users, totalField: 'total_responsaveis' },
  { key: 'restrictions', label: 'Restrições', icon: ShieldAlert, totalField: 'total_restricoes' },
  { key: 'budgets', label: 'Orçamento', icon: WalletCards, totalField: 'total_orcamentos' },
  { key: 'dashboard', label: 'Dashboard', icon: ChartNoAxesCombined, totalField: 'total_dashboards' },
]

const dataViews = new Set<DataView>([
  'activities',
  'floors',
  'services',
  'milestones',
  'baselines',
  'responsibles',
  'restrictions',
  'budgets',
  'dashboard',
])

const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

function formatDate(value?: string | number | boolean | null) {
  if (!value || typeof value !== 'string') return '-'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function formatNumber(value?: string | number | boolean | null, suffix = '') {
  const number = Number(value)
  return Number.isFinite(number) ? `${numberFormatter.format(number)}${suffix}` : '-'
}

function formatCurrency(value?: string | number | boolean | null) {
  const number = Number(value)
  return Number.isFinite(number) ? currencyFormatter.format(number) : '-'
}

function formatPercent(value?: string | number | boolean | null) {
  const number = Number(value)
  return Number.isFinite(number) ? `${numberFormatter.format(number * 100)}%` : '-'
}

function formatPerspective(value?: string | number | boolean | null) {
  if (value === 'monetary') return 'Financeiro'
  if (value === 'physical') return 'Físico'
  return String(value || '-')
}

function projectStatus(record: DataRecord) {
  if (record.desativado) return { label: 'Arquivado', className: 'neutral' }
  if (record.status_dashboard === 'outdated') return { label: 'Desatualizado', className: 'warning' }
  if (record.status === 'finished') return { label: 'Atualizado', className: 'success' }
  if (record.status === 'never_updated') return { label: 'Sem atualização', className: 'neutral' }
  return { label: String(record.status || 'Ativo'), className: 'info' }
}

function activityStatus(record: DataRecord) {
  if (record.excluido_em) return { label: 'Excluída', className: 'neutral' }
  const progress = Number(record.progresso_realizado)
  if (progress >= 1) return { label: 'Concluída', className: 'success' }

  const today = new Date().toISOString().slice(0, 10)
  const start = String(record.data_inicio || '').slice(0, 10)
  const end = String(record.data_fim || '').slice(0, 10)
  if (end && end < today) return { label: 'Atrasada', className: 'danger' }
  if (start && start > today) return { label: 'Planejada', className: 'info' }
  return { label: 'Em andamento', className: 'warning' }
}

function restrictionStatus(record: DataRecord) {
  if (record.concluido_em || record.etapa_fase === 'done') {
    return { label: 'Concluída', className: 'success' }
  }

  const dueDate = String(record.vencimento_em || '').slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  if (dueDate && dueDate < today) return { label: 'Atrasada', className: 'danger' }
  if (record.etapa_fase === 'started') return { label: 'Em andamento', className: 'warning' }
  return { label: 'A fazer', className: 'info' }
}

function StatusBadge({ status }: { status: { label: string; className: string } }) {
  return <span className={`status-badge status-${status.className}`}>{status.label}</span>
}

const columns: Record<DataView, Column[]> = {
  projects: [
    {
      label: 'Projeto',
      render: (record) => (
        <div className="primary-cell">
          <strong>{String(record.nome_projeto || '-')}</strong>
          <small>ID {String(record.id_prevision || '-')}</small>
        </div>
      ),
    },
    { label: 'Fase', render: (record) => String(record.fase || '-') },
    { label: 'Área', render: (record) => formatNumber(record.area, ' m²'), align: 'right' },
    { label: 'Início', render: (record) => formatDate(record.data_inicio) },
    { label: 'Término', render: (record) => formatDate(record.data_fim) },
    { label: 'Previsto', render: (record) => formatPercent(record.progresso_esperado), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.progresso_realizado), align: 'right' },
    { label: 'IDP', render: (record) => formatNumber(record.idp), align: 'right' },
    { label: 'Orçamento', render: (record) => formatCurrency(record.custo_orcado), align: 'right' },
    {
      label: 'Atraso',
      render: (record) => formatNumber(record.atraso_dias, ' d'),
      align: 'right',
    },
    { label: 'Status', render: (record) => <StatusBadge status={projectStatus(record)} /> },
  ],
  activities: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'EAP', render: (record) => String(record.codigo_eap || '-') },
    { label: 'Serviço', render: (record) => String(record.servico_nome || '-') },
    { label: 'Pos. serviço', render: (record) => formatNumber(record.posicao_servico), align: 'right' },
    { label: 'Pavimento', render: (record) => String(record.pavimento_nome || '-') },
    { label: 'Grupo', render: (record) => String(record.grupo_repeticao || '-') },
    { label: 'Parte', render: (record) => String(record.contador_parte || '-') },
    { label: 'Nível', render: (record) => String(record.nivel_atividade || '-') },
    { label: 'Categoria', render: (record) => String(record.categorizacao || '-') },
    {
      label: 'Crítico',
      render: (record) => (
        <StatusBadge
          status={
            String(record.caminho_critico).toLocaleLowerCase('pt-BR') === 'sim'
              ? { label: 'Sim', className: 'danger' }
              : { label: 'Não', className: 'neutral' }
          }
        />
      ),
    },
    { label: 'LB início', render: (record) => formatDate(record.linha_base_inicio) },
    { label: 'LB término', render: (record) => formatDate(record.linha_base_fim) },
    { label: 'Início', render: (record) => formatDate(record.data_inicio) },
    { label: 'Término', render: (record) => formatDate(record.data_fim) },
    { label: 'Duração', render: (record) => formatNumber(record.duracao_dias, ' d'), align: 'right' },
    { label: 'Predecessoras', render: (record) => String(record.predecessoras || '-') },
    { label: 'Sucessoras', render: (record) => String(record.sucessoras || '-') },
    { label: 'Status', render: (record) => <StatusBadge status={activityStatus(record)} /> },
  ],
  floors: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Pavimento', render: (record) => String(record.nome || '-') },
    { label: 'Grupo', render: (record) => String(record.grupo_repeticao || '-') },
    { label: 'Posição', render: (record) => formatNumber(record.posicao), align: 'right' },
    { label: 'Área', render: (record) => formatNumber(record.area, ' m²'), align: 'right' },
    { label: 'Início', render: (record) => formatDate(record.data_inicio) },
    { label: 'Término', render: (record) => formatDate(record.data_fim) },
  ],
  services: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    {
      label: 'Serviço',
      render: (record) => (
        <span className="color-label">
          <i style={{ backgroundColor: String(record.cor || '#98a2b3') }} />
          {String(record.nome || '-')}
        </span>
      ),
    },
    { label: 'Posição', render: (record) => formatNumber(record.posicao), align: 'right' },
    { label: 'Unidade', render: (record) => String(record.unidade || '-') },
    { label: 'Início', render: (record) => formatDate(record.data_inicio) },
    { label: 'Término', render: (record) => formatDate(record.data_fim) },
    {
      label: 'Etapas',
      render: (record) => (record.possui_etapas ? 'Configuradas' : 'Não configuradas'),
    },
  ],
  milestones: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    {
      label: 'Marco',
      render: (record) => (
        <span className="color-label">
          <i style={{ backgroundColor: String(record.cor || '#98a2b3') }} />
          {String(record.nome || '-')}
        </span>
      ),
    },
    { label: 'Data', render: (record) => formatDate(record.data) },
    { label: 'Referência', render: (record) => String(record.atributo_base || '-') },
    {
      label: 'Defasagem',
      render: (record) => formatNumber(record.defasagem_dias, ' d'),
      align: 'right',
    },
    {
      label: 'Visibilidade',
      render: (record) => (record.visivel_na_obra ? 'Visível na obra' : 'Oculto'),
    },
  ],
  baselines: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'ID', render: (record) => String(record.id_prevision || '-') },
    { label: 'Criada em', render: (record) => formatDate(record.criado_em) },
    { label: 'Versão LOB', render: (record) => String(record.versao_lob_id || '-') },
    {
      label: 'Status',
      render: (record) => (
        <StatusBadge
          status={
            record.ativa
              ? { label: 'Ativa', className: 'success' }
              : { label: 'Histórica', className: 'neutral' }
          }
        />
      ),
    },
  ],
  responsibles: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Responsável', render: (record) => String(record.nome || '-') },
    { label: 'ID Prevision', render: (record) => String(record.id_prevision || '-') },
  ],
  restrictions: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    {
      label: 'Restrição',
      render: (record) => (
        <div className="primary-cell">
          <strong>{String(record.titulo || '-')}</strong>
          <small>{String(record.descricao || `ID ${record.id_prevision || '-'}`)}</small>
        </div>
      ),
    },
    { label: 'Etapa', render: (record) => String(record.etapa_nome || '-') },
    { label: 'Situação', render: (record) => <StatusBadge status={restrictionStatus(record)} /> },
    { label: 'Prazo', render: (record) => formatDate(record.vencimento_em) },
    { label: 'Concluída em', render: (record) => formatDate(record.concluido_em) },
    { label: 'Atraso', render: (record) => formatNumber(record.atraso_dias, ' d'), align: 'right' },
    { label: 'EAP', render: (record) => String(record.codigo_eap || '-') },
    { label: 'Serviço', render: (record) => String(record.servico_nome || '-') },
    { label: 'Pavimento', render: (record) => String(record.pavimento_nome || '-') },
    { label: 'Etiquetas', render: (record) => String(record.etiquetas_nomes || '-') },
    { label: 'Responsáveis', render: (record) => String(record.usuarios_nomes || '-') },
    {
      label: 'Checklist',
      render: (record) =>
        `${integerFormatter.format(Number(record.checklist_concluido) || 0)}/${integerFormatter.format(Number(record.checklist_total) || 0)}`,
      align: 'right',
    },
  ],
  budgets: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Orçamento', render: (record) => String(record.nome || '-') },
    { label: 'Perspectiva', render: (record) => formatPerspective(record.perspectiva) },
    { label: 'Custo total', render: (record) => formatCurrency(record.custo_total), align: 'right' },
    { label: 'Custo físico', render: (record) => formatCurrency(record.custo_fisico), align: 'right' },
    { label: 'Custo dos pesos', render: (record) => formatCurrency(record.custo_pesos), align: 'right' },
    {
      label: 'Pesos',
      render: (record) => (
        <StatusBadge
          status={
            record.pesos_validos
              ? { label: 'Válidos', className: 'success' }
              : { label: 'Revisar', className: 'warning' }
          }
        />
      ),
    },
    { label: 'Contrato', render: (record) => (record.liberado_contrato ? 'Liberado' : '-') },
    { label: 'Padrão', render: (record) => (record.padrao ? 'Sim' : 'Não') },
    { label: 'Integração', render: (record) => String(record.status_integracao || '-') },
  ],
  dashboard: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Perspectiva', render: (record) => formatPerspective(record.perspectiva) },
    { label: 'Início', render: (record) => formatDate(record.data_inicio) },
    { label: 'Término', render: (record) => formatDate(record.data_fim) },
    { label: 'Última medição', render: (record) => formatDate(record.ultima_medicao) },
    { label: 'Previsto', render: (record) => formatPercent(record.progresso_previsto), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.progresso_realizado), align: 'right' },
    { label: 'IDP', render: (record) => formatNumber(record.idp), align: 'right' },
    { label: 'Atraso', render: (record) => formatNumber(record.atraso_dias, ' d'), align: 'right' },
    { label: 'Custo', render: (record) => formatCurrency(record.custo), align: 'right' },
    {
      label: 'Custo realizado',
      render: (record) => formatCurrency(record.custo_realizado),
      align: 'right',
    },
  ],
}

const activityColumns: Record<ActivityMode, Column[]> = {
  planning: columns.activities,
  progress: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'EAP', render: (record) => String(record.codigo_eap || '-') },
    { label: 'Serviço', render: (record) => String(record.servico_nome || '-') },
    { label: 'Pavimento', render: (record) => String(record.pavimento_nome || '-') },
    { label: '1ª medição', render: (record) => formatDate(record.primeira_medicao_em) },
    { label: 'Última medição', render: (record) => formatDate(record.ultima_medicao_em) },
    { label: 'Referência', render: (record) => formatDate(record.data_referencia) },
    { label: 'Base físico', render: (record) => formatPercent(record.progresso_fisico_base), align: 'right' },
    { label: 'Previsto', render: (record) => formatPercent(record.progresso_esperado), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.progresso_realizado), align: 'right' },
    { label: 'Últ. base', render: (record) => formatPercent(record.ultima_medicao_base), align: 'right' },
    {
      label: 'Últ. previsto',
      render: (record) => formatPercent(record.ultima_medicao_esperado),
      align: 'right',
    },
    {
      label: 'Últ. realizado',
      render: (record) => formatPercent(record.ultima_medicao_realizado),
      align: 'right',
    },
    { label: 'Unidade', render: (record) => String(record.unidade_simbolo || record.unidade_nome || '-') },
    { label: 'Qtd. total', render: (record) => formatNumber(record.quantidade_unidade), align: 'right' },
    { label: 'Base unidade', render: (record) => formatNumber(record.progresso_unidade_base), align: 'right' },
    {
      label: 'Previsto unidade',
      render: (record) => formatNumber(record.progresso_unidade_esperado),
      align: 'right',
    },
    {
      label: 'Realizado unidade',
      render: (record) => formatNumber(record.progresso_unidade_realizado),
      align: 'right',
    },
    { label: 'Saldo', render: (record) => formatNumber(record.saldo_unidade), align: 'right' },
    { label: 'Início real', render: (record) => formatDate(record.data_real_inicio) },
    { label: 'Término real', render: (record) => formatDate(record.data_real_fim) },
    { label: 'Duração real', render: (record) => String(record.duracao_real || '-') },
    { label: 'Motivos de atraso', render: (record) => String(record.motivos_atraso || '-') },
  ],
  resources: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'EAP', render: (record) => String(record.codigo_eap || '-') },
    { label: 'Serviço', render: (record) => String(record.servico_nome || '-') },
    { label: 'Pavimento', render: (record) => String(record.pavimento_nome || '-') },
    { label: 'Materiais', render: (record) => String(record.recursos_materiais || '-') },
    { label: 'Responsável', render: (record) => String(record.responsavel || '-') },
    { label: 'Custo vinculado', render: (record) => formatCurrency(record.custo_vinculado), align: 'right' },
    {
      label: 'Custo linha base',
      render: (record) => formatCurrency(record.custo_linha_base),
      align: 'right',
    },
    { label: 'Unidade', render: (record) => String(record.unidade_simbolo || record.unidade_nome || '-') },
    {
      label: 'Descrição realizada',
      render: (record) => String(record.progresso_unidade_descricao || '-'),
    },
  ],
}

const budgetColumns: Record<BudgetMode, Column[]> = {
  reports: columns.budgets,
  items: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Código', render: (record) => String(record.codigo || '-') },
    { label: 'Descrição', render: (record) => String(record.descricao || '-') },
    { label: 'Nível', render: (record) => formatNumber(record.nivel), align: 'right' },
    { label: 'Tipo', render: (record) => String(record.tipo_grupo || '-') },
    { label: 'Início', render: (record) => formatDate(record.data_inicio) },
    { label: 'Término', render: (record) => formatDate(record.data_fim) },
    { label: 'Mão de obra', render: (record) => formatCurrency(record.custo_mao_obra), align: 'right' },
    { label: 'Material', render: (record) => formatCurrency(record.custo_material), align: 'right' },
    { label: 'Custo total', render: (record) => formatCurrency(record.custo_total), align: 'right' },
    { label: 'Base', render: (record) => formatPercent(record.peso_base), align: 'right' },
    { label: 'Previsto', render: (record) => formatPercent(record.peso_previsto), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.peso_realizado), align: 'right' },
    {
      label: 'Pesos atividades',
      render: (record) => formatNumber(record.total_pesos_atividades),
      align: 'right',
    },
  ],
}

const dashboardColumns: Record<DashboardMode, Column[]> = {
  general: columns.dashboard,
  monthly: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Perspectiva', render: (record) => formatPerspective(record.perspectiva) },
    { label: 'Competência', render: (record) => formatDate(record.data) },
    { label: 'Base mês', render: (record) => formatPercent(record.base_mes), align: 'right' },
    { label: 'Previsto mês', render: (record) => formatPercent(record.previsto_mes), align: 'right' },
    { label: 'Realizado mês', render: (record) => formatPercent(record.realizado_mes), align: 'right' },
    { label: 'Curva base', render: (record) => formatPercent(record.curva_base), align: 'right' },
    { label: 'Curva prevista', render: (record) => formatPercent(record.curva_prevista), align: 'right' },
    { label: 'Curva realizada', render: (record) => formatPercent(record.curva_realizada), align: 'right' },
  ],
  services: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Serviço', render: (record) => String(record.nome || '-') },
    { label: 'Perspectiva', render: (record) => formatPerspective(record.perspectiva) },
    { label: 'Início base', render: (record) => formatDate(record.data_base_inicio) },
    { label: 'Fim base', render: (record) => formatDate(record.data_base_fim) },
    { label: 'Base', render: (record) => formatPercent(record.base), align: 'right' },
    { label: 'Previsto', render: (record) => formatPercent(record.previsto), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.realizado), align: 'right' },
    { label: 'IDP', render: (record) => formatNumber(record.idp), align: 'right' },
    { label: 'Atraso', render: (record) => formatNumber(record.atraso_dias, ' d'), align: 'right' },
    { label: 'Custo base', render: (record) => formatCurrency(record.custo_base), align: 'right' },
    { label: 'Custo total', render: (record) => formatCurrency(record.custo_total), align: 'right' },
  ],
  floors: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Lote', render: (record) => String(record.nome || '-') },
    { label: 'Grupo', render: (record) => String(record.grupo_repeticao || '-') },
    { label: 'Perspectiva', render: (record) => formatPerspective(record.perspectiva) },
    { label: 'Início base', render: (record) => formatDate(record.data_base_inicio) },
    { label: 'Fim base', render: (record) => formatDate(record.data_base_fim) },
    { label: 'Base', render: (record) => formatPercent(record.base), align: 'right' },
    { label: 'Previsto', render: (record) => formatPercent(record.previsto), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.realizado), align: 'right' },
    { label: 'IDP', render: (record) => formatNumber(record.idp), align: 'right' },
    { label: 'Atraso', render: (record) => formatNumber(record.atraso_dias, ' d'), align: 'right' },
    { label: 'Custo total', render: (record) => formatCurrency(record.custo_total), align: 'right' },
  ],
  states: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Dashboard', render: (record) => String(record.nome || '-') },
    { label: 'Categoria', render: (record) => String(record.categoria || '-') },
    { label: 'Perspectiva', render: (record) => formatPerspective(record.perspectiva) },
    { label: 'Padrão', render: (record) => (record.padrao ? 'Sim' : 'Não') },
    { label: 'Orçamento', render: (record) => (record.possui_orcamento ? 'Vinculado' : '-') },
    { label: 'Status', render: (record) => String(record.status || '-') },
    { label: 'Atualizado em', render: (record) => formatDate(record.atualizado_em) },
  ],
}

async function fetchJson(url: string, options?: RequestInit, timeoutMs = 30000) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(
        payload?.error ||
          `O servidor respondeu HTTP ${response.status}. Confira os logs da função na Vercel.`,
      )
    }
    if (!payload) throw new Error('O servidor respondeu sem dados.')
    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Tempo limite ao consultar o servidor.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [records, setRecords] = useState<DataRecord[]>([])
  const [activeView, setActiveView] = useState<DataView>('projects')
  const [activityMode, setActivityMode] = useState<ActivityMode>('planning')
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('reports')
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>('general')
  const [selectedProject, setSelectedProject] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [synchronizing, setSynchronizing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadProjects = useCallback(async () => {
    const payload = await fetchJson('/api/projects')
    setProjects(Array.isArray(payload.projects) ? payload.projects : [])
  }, [])

  const loadCurrentView = useCallback(async () => {
    if (!dataViews.has(activeView)) return
    const requestedType =
      activeView === 'budgets'
        ? budgetMode === 'items'
          ? 'budgetItems'
          : 'budgets'
        : activeView === 'dashboard'
          ? {
              general: 'dashboard',
              monthly: 'dashboardMonthly',
              services: 'dashboardServices',
              floors: 'dashboardFloors',
              states: 'dashboardStates',
            }[dashboardMode]
          : activeView
    const params = new URLSearchParams({
      type: requestedType,
      page: String(page),
      limit: String(PAGE_SIZE),
    })
    if (selectedProject) params.set('projectId', selectedProject)

    const payload = await fetchJson(`/api/data?${params}`)
    setRecords(Array.isArray(payload.records) ? payload.records : [])
    setHasMore(Boolean(payload.hasMore))
  }, [activeView, budgetMode, dashboardMode, page, selectedProject])

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      await loadProjects()
      await loadCurrentView()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar os dados.')
    } finally {
      setLoading(false)
    }
  }, [loadCurrentView, loadProjects])

  useEffect(() => {
    reload()
  }, [reload])

  async function synchronize() {
    try {
      setSynchronizing(true)
      setError('')
      setMessage('')
      const payload = await fetchJson(
        '/api/sync-prevision',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(selectedProject ? { projectId: selectedProject } : {}),
            ...(activeView === 'restrictions' ? { scope: 'restrictions' } : {}),
            ...(activeView === 'budgets' || activeView === 'dashboard'
              ? { scope: 'analytics' }
              : {}),
          }),
        },
        300000,
      )
      if (activeView === 'restrictions') {
        setMessage(
          `${integerFormatter.format(payload.totals?.restrictions ?? 0)} restrições atualizadas.`,
        )
      } else if (activeView === 'budgets' || activeView === 'dashboard') {
        setMessage(
          `${integerFormatter.format(payload.totals?.budgets ?? 0)} orçamentos e ${integerFormatter.format(payload.totals?.dashboards ?? 0)} dashboards atualizados.`,
        )
      } else {
        const total = payload.totals?.activities ?? 0
        setMessage(
          `${payload.imported} projeto(s) e ${integerFormatter.format(total)} atividades atualizados.`,
        )
      }
      await reload()
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Erro ao sincronizar com a Prevision.')
    } finally {
      setSynchronizing(false)
    }
  }

  const totals = useMemo(() => {
    const sum = (field: string) =>
      projects.reduce((total, project) => total + (Number(project[field]) || 0), 0)

    return {
      projects: projects.length,
      activities: sum('total_atividades'),
      area: sum('area'),
      budget: sum('custo_orcado'),
    }
  }, [projects])

  const tabTotals = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((tab) => [
          tab.key,
          tab.totalField
            ? projects.reduce((total, project) => total + (Number(project[tab.totalField!]) || 0), 0)
            : projects.length,
        ]),
      ),
    [projects],
  )

  const visibleRecords = useMemo(() => {
    const source: DataRecord[] =
      activeView === 'projects'
        ? projects.filter(
            (project) => !selectedProject || project.id_prevision === selectedProject,
          )
        : records
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return source

    return source.filter((record) =>
      Object.values(record).some((value) =>
        String(value ?? '')
          .toLocaleLowerCase('pt-BR')
          .includes(term),
      ),
    )
  }, [activeView, projects, records, search, selectedProject])

  const activeTab = tabs.find((tab) => tab.key === activeView) || tabs[0]
  const currentColumns =
    activeView === 'activities'
      ? activityColumns[activityMode]
      : activeView === 'budgets'
        ? budgetColumns[budgetMode]
        : activeView === 'dashboard'
          ? dashboardColumns[dashboardMode]
          : columns[activeView]

  function changeView(view: DataView) {
    setActiveView(view)
    setPage(0)
    setSearch('')
  }

  function changeProject(projectId: string) {
    setSelectedProject(projectId)
    setPage(0)
  }

  return (
    <main className="app-shell">
      <header className="page-header">
        <div className="brand-block">
          <div className="brand-mark">
            <Database size={20} />
          </div>
          <div>
            <p className="eyebrow">DadosPrevision</p>
            <h1>Controle de obras</h1>
          </div>
        </div>
        <div className="header-actions">
          <button className="secondary-button" type="button" onClick={reload} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Recarregar
          </button>
          <button type="button" onClick={synchronize} disabled={synchronizing}>
            <Database size={16} />
            {synchronizing
              ? 'Sincronizando...'
              : activeView === 'restrictions'
                ? 'Sincronizar restrições'
                : activeView === 'budgets' || activeView === 'dashboard'
                  ? 'Sincronizar análises'
              : selectedProject
                ? 'Sincronizar projeto'
                : 'Sincronizar tudo'}
          </button>
        </div>
      </header>

      <section className="summary" aria-label="Resumo da carteira">
        <div>
          <span>{integerFormatter.format(totals.projects)}</span>
          <small>Projetos</small>
        </div>
        <div>
          <span>{integerFormatter.format(totals.activities)}</span>
          <small>Atividades</small>
        </div>
        <div>
          <span>{integerFormatter.format(totals.area)} m²</span>
          <small>Área planejada</small>
        </div>
        <div>
          <span>{currencyFormatter.format(totals.budget)}</span>
          <small>Orçamento total</small>
        </div>
      </section>

      <nav className="data-tabs" aria-label="Conjuntos de dados">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              type="button"
              className={activeView === tab.key ? 'active' : ''}
              onClick={() => changeView(tab.key)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
              <small>{integerFormatter.format(Number(tabTotals[tab.key]) || 0)}</small>
            </button>
          )
        })}
      </nav>

      <section className="workspace">
        <div className="toolbar">
          <div className="view-title">
            <activeTab.icon size={18} />
            <h2>{activeTab.label}</h2>
          </div>
          {activeView === 'activities' && (
            <div className="activity-modes" aria-label="Detalhamento das atividades">
              <button
                type="button"
                className={activityMode === 'planning' ? 'active' : ''}
                onClick={() => setActivityMode('planning')}
              >
                Planejamento
              </button>
              <button
                type="button"
                className={activityMode === 'progress' ? 'active' : ''}
                onClick={() => setActivityMode('progress')}
              >
                Medições
              </button>
              <button
                type="button"
                className={activityMode === 'resources' ? 'active' : ''}
                onClick={() => setActivityMode('resources')}
              >
                Recursos e custos
              </button>
            </div>
          )}
          {activeView === 'budgets' && (
            <div className="activity-modes" aria-label="Detalhamento do orçamento">
              <button
                type="button"
                className={budgetMode === 'reports' ? 'active' : ''}
                onClick={() => {
                  setBudgetMode('reports')
                  setPage(0)
                }}
              >
                Relatórios
              </button>
              <button
                type="button"
                className={budgetMode === 'items' ? 'active' : ''}
                onClick={() => {
                  setBudgetMode('items')
                  setPage(0)
                }}
              >
                Itens / CFF
              </button>
            </div>
          )}
          {activeView === 'dashboard' && (
            <div className="activity-modes" aria-label="Detalhamento do dashboard">
              {[
                ['general', 'Geral'],
                ['monthly', 'Curva mensal'],
                ['services', 'Serviços'],
                ['floors', 'Lotes'],
                ['states', 'Estados'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={dashboardMode === mode ? 'active' : ''}
                  onClick={() => {
                    setDashboardMode(mode as DashboardMode)
                    setPage(0)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="filters">
            <label>
              <span>Projeto</span>
              <select value={selectedProject} onChange={(event) => changeProject(event.target.value)}>
                <option value="">Todos os projetos</option>
                {projects.map((project) => (
                  <option key={project.id_prevision} value={project.id_prevision}>
                    {project.nome_projeto}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span>Buscar</span>
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar nesta página"
              />
            </label>
          </div>
        </div>

        {(message || error) && (
          <div className={`feedback ${error ? 'error' : 'success'}`}>{error || message}</div>
        )}

        <div className="table-panel" aria-live="polite">
          {loading ? (
            <div className="state-message">
              <RefreshCw size={20} className="spin" />
              Carregando dados
            </div>
          ) : visibleRecords.length === 0 ? (
            <div className="state-message">Nenhum registro encontrado.</div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {currentColumns.map((column) => (
                      <th key={column.label} className={column.align === 'right' ? 'align-right' : ''}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((record, index) => (
                    <tr key={String(record.firestore_id || record.id_prevision || index)}>
                      {currentColumns.map((column) => (
                        <td
                          key={column.label}
                          className={column.align === 'right' ? 'align-right' : ''}
                        >
                          {column.render(record)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {activeView !== 'projects' && (
          <footer className="pagination">
            <span>
              Página {page + 1} · {visibleRecords.length} registros exibidos
            </span>
            <div>
              <button
                type="button"
                title="Página anterior"
                aria-label="Página anterior"
                disabled={page === 0 || loading}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                title="Próxima página"
                aria-label="Próxima página"
                disabled={!hasMore || loading}
                onClick={() => setPage((current) => current + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </footer>
        )}
      </section>
    </main>
  )
}

export default App
