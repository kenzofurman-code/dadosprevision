import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  ChartNoAxesCombined,
  Copy,
  Database,
  Edit2,
  FileSpreadsheet,
  Flag,
  GripVertical,
  History,
  Layers3,
  ListChecks,
  Maximize2,
  Moon,
  Percent,
  Plus,
  Presentation,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Settings2,
  Trash2,
  TrendingUp,
  Sun,
  Users,
  WalletCards,
  Wrench,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './App.css'
import { CurvasView } from './CurvasView'

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
  | 'curvas'
  | 'gestao_a_vista'

type GestaoPanelTab = 'overview' | 'panel1' | 'panel2' | 'panel3' | 'matrix' | 'panel5' | 'milestones'
type GestaoTablePanel = 'panel1' | 'panel2' | 'panel3'
type ReorderableGestaoPanel = GestaoTablePanel | 'panel4'

interface GestaoPanelPreference {
  onlyWithData: boolean
  serviceOrder: string[]
}

type GestaoPanelPreferences = Record<
  string,
  Record<ReorderableGestaoPanel, GestaoPanelPreference>
>

interface GestaoServiceItem {
  name: string
  position: number
  groupRank: number
  activities: DataRecord[]
}

interface GestaoFloorItem {
  id: string
  name: string
  groupRank: number
}

interface CustomMatrixConfig {
  id: string
  name: string
  projectId: string
  selectedGroups?: string[]
  selectedServices: string[]
  selectedFloors: string[]
  floorSortOrder?: 'asc' | 'desc'
  createdAt: string
  updatedAt: string
}

type DefaultMatrixConfigs = Record<string, CustomMatrixConfig | null>

type ActivityMode = 'planning' | 'jobs' | 'progress' | 'measurements' | 'resources'
type BudgetMode = 'reports' | 'items' | 'weights'
type DashboardMode = 'general' | 'weekly' | 'monthly' | 'cff' | 'services' | 'floors' | 'states'

type DataRecord = Record<string, any>

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

type CffRecord = DataRecord & {
  cffIndex: number
  cffBase: number
  cffPrevisto: number
  cffRealizado: number
  pontos_mensais?: Array<{
    data: string
    base: number
    previsto: number
    realizado: number
    base_acumulada: number
    previsto_acumulado: number
    realizado_acumulado: number
  }>
}

type CffMonthlyPoint = {
  data: string | null
  base: number
  previsto: number
  realizado: number
}

type CffMonthlyRow = CffMonthlyPoint & {
  baseExibida: number
  previstoExibido: number
  realizadoExibido: number
}

type CffSummary = {
  projeto_id?: string
  projeto_nome?: string
  orcamento_id?: string
  orcamento_nome?: string
  datas?: string[]
  niveis?: Array<{
    nivel: string
    meses: CffMonthlyPoint[]
  }>
}

type TabDefinition = {
  key: DataView
  label: string
  icon: LucideIcon
  totalField?: string
}

const PAGE_SIZE = 100
const PAGE_SIZE_OPTIONS = [10, 50, 100, 150]
const MILESTONE_COLORS = [
  '#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4',
  '#f97316', '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#64748b',
]

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
  { key: 'gestao_a_vista', label: 'Gestão à Vista', icon: Presentation, totalField: 'total_atividades' },
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
  'curvas',
  'gestao_a_vista',
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

function formatDateCompact(value?: string | number | boolean | null) {
  if (!value || typeof value !== 'string') return '-'
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return String(value)
  return `${match[3]}/${match[2]}/${match[1].slice(2)}`
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

function matrixProgressTooltip(activity: DataRecord) {
  let microservices = activity.microservicos
  if (typeof microservices === 'string') {
    try {
      microservices = JSON.parse(microservices)
    } catch {
      microservices = []
    }
  }
  if (!Array.isArray(microservices) || microservices.length === 0) {
    return `Andamento do serviço: ${formatPercent(activity.progresso_realizado)}\nSem microserviços cadastrados.`
  }
  return [
    `Andamento do serviço: ${formatPercent(activity.progresso_realizado)}`,
    '',
    'Microserviços:',
    ...microservices.map((microservice) => {
      const name = String(microservice.nome || microservice.name || 'Microserviço')
      const realized = formatPercent(
        microservice.progresso_realizado ?? microservice.percentageCompleted,
      )
      const expected = formatPercent(
        microservice.progresso_esperado ?? microservice.expectedPercentageCompleted,
      )
      return `${name}: ${realized} realizado · ${expected} previsto`
    }),
  ].join('\n')
}

function compareNatural(left?: string | number | boolean | null, right?: string | number | boolean | null) {
  return String(left || '').localeCompare(String(right || ''), 'pt-BR', {
    numeric: true,
    sensitivity: 'base',
  })
}

function activityGroupName(activity: DataRecord) {
  return String(activity.grupo_repeticao || '').trim()
}

function formatMonthLabel(value?: string | null) {
  if (!value) return '-'
  const match = String(value).match(/^(\d{4})-(\d{2})/)
  if (!match) return String(value)
  return `${match[2]}/${match[1]}`
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

function restrictionChecklistRows(record: DataRecord): DataRecord[] {
  let checklistItems: DataRecord[] = []
  const rawItems = record.checklist_itens
  if (typeof rawItems === 'string') {
    try {
      const parsed = JSON.parse(rawItems)
      checklistItems = Array.isArray(parsed) ? parsed : []
    } catch {
      checklistItems = []
    }
  } else if (Array.isArray(rawItems)) {
    checklistItems = rawItems
  }

  if (checklistItems.length === 0) {
    return [{
      ...record,
      checklist_item_id: null,
      checklist_item_descricao: null,
      checklist_item_status: null,
      checklist_item_vencimento: null,
      checklist_item_concluido_em: null,
      checklist_item_responsavel: null,
      checklist_item_antecedencia: null,
      checklist_item_posicao: null,
    }]
  }

  return checklistItems.map((item, index) => ({
    ...record,
    firestore_id: `${record.firestore_id || record.id_prevision}_checklist_${item.id_prevision || index}`,
    checklist_item_id: item.id_prevision || null,
    checklist_item_descricao: item.descricao || '-',
    checklist_item_status: Boolean(item.status),
    checklist_item_vencimento: item.vencimento_em || null,
    checklist_item_concluido_em: item.concluido_em || null,
    checklist_item_responsavel: item.responsavel_nome || item.responsavel_email || null,
    checklist_item_antecedencia: item.antecedencia_dias ?? null,
    checklist_item_posicao: item.posicao ?? null,
  }))
}

function checklistItemStatus(record: DataRecord) {
  if (!record.checklist_item_id) return { label: 'Sem item', className: 'neutral' }
  if (record.checklist_item_status) return { label: 'Concluído', className: 'success' }

  const dueDate = String(record.checklist_item_vencimento || '').slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return dueDate && dueDate < today
    ? { label: 'Atrasado', className: 'danger' }
    : { label: 'Pendente', className: 'warning' }
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
    { label: 'Início da obra', render: (record) => formatDate(record.data_inicio_obra) },
    { label: 'Fim da obra', render: (record) => formatDate(record.data_fim_obra) },
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
      label: 'Item do checklist',
      render: (record) => String(record.checklist_item_descricao || '-'),
    },
    { label: 'Situação do item', render: (record) => <StatusBadge status={checklistItemStatus(record)} /> },
    { label: 'Prazo do item', render: (record) => formatDate(record.checklist_item_vencimento) },
    { label: 'Conclusão do item', render: (record) => formatDate(record.checklist_item_concluido_em) },
    { label: 'Responsável pelo item', render: (record) => String(record.checklist_item_responsavel || '-') },
    {
      label: 'Antecedência',
      render: (record) => {
        const days = Number(record.checklist_item_antecedencia)
        return Number.isFinite(days) ? `${integerFormatter.format(days)} ${days === 1 ? 'dia útil' : 'dias úteis'}` : '-'
      },
    },
    {
      label: 'Ordem do item',
      render: (record) => record.checklist_item_posicao === null || record.checklist_item_posicao === undefined
        ? '-'
        : integerFormatter.format(Number(record.checklist_item_posicao) + 1),
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
  curvas: [],
  gestao_a_vista: [],
}

const activityColumns: Record<ActivityMode, Column[]> = {
  planning: columns.activities,
  jobs: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'EAP atividade', render: (record) => String(record.atividade_eap || '-') },
    { label: 'Serviço', render: (record) => String(record.servico_nome || '-') },
    { label: 'Pavimento', render: (record) => String(record.pavimento_nome || '-') },
    {
      label: 'Microserviço',
      render: (record) => (
        <div className="primary-cell">
          <strong>{String(record.nome || '-')}</strong>
          <small>ID {String(record.id_prevision || '-')}</small>
        </div>
      ),
    },
    { label: 'EAP job', render: (record) => String(record.codigo_eap || '-') },
    { label: 'Início', render: (record) => formatDate(record.data_inicio) },
    { label: 'Término', render: (record) => formatDate(record.data_fim) },
    { label: 'Duração', render: (record) => formatNumber(record.duracao_dias, ' d'), align: 'right' },
    { label: 'Previsto', render: (record) => formatPercent(record.progresso_esperado), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.progresso_realizado), align: 'right' },
    { label: 'Status', render: (record) => <StatusBadge status={activityStatus(record)} /> },
  ],
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
  measurements: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Data da medição', render: (record) => formatDate(record.data_medicao) },
    { label: 'EAP', render: (record) => String(record.codigo_eap || '-') },
    { label: 'Serviço', render: (record) => String(record.servico_nome || '-') },
    { label: 'Pavimento', render: (record) => String(record.pavimento_nome || '-') },
    { label: 'Base físico', render: (record) => formatPercent(record.progresso_base), align: 'right' },
    { label: 'Previsto', render: (record) => formatPercent(record.progresso_esperado), align: 'right' },
    { label: 'Realizado', render: (record) => formatPercent(record.progresso_realizado), align: 'right' },
    { label: 'Unidade', render: (record) => String(record.unidade_simbolo || '-') },
    { label: 'Motivos de atraso', render: (record) => String(record.motivos_atraso || '-') },
    { label: 'Observações', render: (record) => String(record.observacoes || '-') },
  ],
}

const budgetColumns: Record<BudgetMode, Column[]> = {
  reports: columns.budgets,
  items: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Orçamento', render: (record) => String(record.orcamento_nome || '-') },
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
      label: 'Vínculos cronograma',
      render: (record) => formatNumber(record.total_pesos_atividades),
      align: 'right',
    },
  ],
  weights: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Orçamento', render: (record) => String(record.orcamento_nome || '-') },
    { label: 'Código EAP', render: (record) => String(record.codigo || '-') },
    {
      label: 'Item do orçamento',
      render: (record) => (
        <div className="primary-cell">
          <strong>{String(record.descricao || '-')}</strong>
          <small>{record.nivel != null ? `Nível ${record.nivel}` : 'Orçamento'}</small>
        </div>
      ),
    },
    { label: 'Custo total', render: (record) => formatCurrency(record.custo_total), align: 'right' },
    { label: 'Serviço (Cronograma)', render: (record) => String(record.servico_nome || '-') },
    { label: 'Pavimento / Lote', render: (record) => String(record.pavimento_nome || '-') },
    { label: 'ID Atividade', render: (record) => String(record.id_atividade || '-') },
    {
      label: 'Peso na atividade',
      render: (record) => formatPercent(record.porcentagem),
      align: 'right',
    },
    {
      label: 'Microserviços vinculados',
      render: (record) => (
        <div title={String(record.microservicos_resumo || '-')}>
          {String(record.microservicos_resumo || '-')}
        </div>
      ),
    },
  ],
}

const dashboardColumns: Record<DashboardMode, Column[]> = {
  general: columns.dashboard,
  weekly: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Perspectiva', render: (record) => formatPerspective(record.perspectiva) },
    { label: 'Semana', render: (record) => `Semana ${record.semana_indice || '-'}` },
    { label: 'Início', render: (record) => formatDate(record.semana_inicio) },
    { label: 'Término', render: (record) => formatDate(record.semana_fim || record.data) },
    { label: 'Base semana', render: (record) => formatPercent(record.base_semana), align: 'right' },
    { label: 'Previsto semana', render: (record) => formatPercent(record.previsto_semana), align: 'right' },
    { label: 'Realizado semana', render: (record) => formatPercent(record.realizado_semana), align: 'right' },
    { label: 'Curva base', render: (record) => formatPercent(record.curva_base), align: 'right' },
    { label: 'Curva prevista', render: (record) => formatPercent(record.curva_prevista), align: 'right' },
    { label: 'Curva realizada', render: (record) => formatPercent(record.curva_realizada), align: 'right' },
  ],
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
  cff: [
    { label: 'Projeto', render: (record) => <strong>{String(record.projeto_nome || '-')}</strong> },
    { label: 'Código', render: (record) => String(record.codigo || '-') },
    { label: 'Descrição', render: (record) => String(record.descricao || '-') },
    { label: 'Nível', render: (record) => formatNumber(record.nivel), align: 'right' },
    { label: 'Serviços', render: (record) => String(record.servicos || '-') },
    { label: 'Lotes', render: (record) => String(record.lotes || '-') },
    { label: 'Atividades', render: (record) => formatNumber(record.total_pesos_atividades), align: 'right' },
    { label: 'Etapas', render: (record) => formatNumber(record.total_pesos_etapas), align: 'right' },

    { label: 'Início da obra', render: (record) => formatDate(record.data_inicio_obra) },
    { label: 'Fim da obra', render: (record) => formatDate(record.data_fim_obra) },
    { label: 'Custo total', render: (record) => formatCurrency(record.custo_total), align: 'right' },
    { label: 'Peso base', render: (record) => formatPercent(record.peso_base), align: 'right' },
    { label: 'Peso previsto', render: (record) => formatPercent(record.peso_previsto), align: 'right' },
    { label: 'Peso realizado', render: (record) => formatPercent(record.peso_realizado), align: 'right' },
    {
      label: 'Última competência',
      render: (record) => formatDate(record.ultima_competencia_realizada),
    },
    {
      label: 'Último realizado',
      render: (record) => formatPercent(record.ultimo_realizado),
      align: 'right',
    },
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

type ProjectWeek = {
  semana_indice: number
  semana_inicio: string
  semana_fim: string
  data: string
  label: string
}

function parseDateUtc(dateStr: string) {
  if (!dateStr) return null
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

function getProjectWeeks(startDateStr: string, endDateStr: string): ProjectWeek[] {
  const start = parseDateUtc(startDateStr)
  const end = parseDateUtc(endDateStr)
  if (!start || !end) return []

  const weeks: ProjectWeek[] = []
  const current = new Date(start)
  const dayOfWeek = current.getUTCDay()
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  current.setUTCDate(current.getUTCDate() + diffToMonday)

  let weekIndex = 1
  while (current <= end) {
    const weekStart = new Date(current)
    const weekEnd = new Date(current)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)

    const startIso = weekStart.toISOString().slice(0, 10)
    const endIso = weekEnd.toISOString().slice(0, 10)

    weeks.push({
      semana_indice: weekIndex,
      semana_inicio: startIso,
      semana_fim: endIso,
      data: endIso,
      label: `Semana ${weekIndex} (${startIso.slice(8, 10)}/${startIso.slice(5, 7)} a ${endIso.slice(8, 10)}/${endIso.slice(5, 7)}/${endIso.slice(0, 4)})`,
    })

    current.setUTCDate(current.getUTCDate() + 7)
    weekIndex++
  }
  return weeks
}

function calculateItemWeeklyProgress(item: CffRecord, weekStartStr: string, weekEndStr: string) {
  const itemStartStr = String(item.data_inicio_obra || item.data_inicio || '2026-03-02').slice(0, 10)
  const itemEndStr = String(item.data_fim_obra || item.data_fim || '2029-11-30').slice(0, 10)

  if (weekEndStr < itemStartStr) {
    return {
      baseSemana: 0,
      previstoSemana: 0,
      realizadoSemana: 0,
      baseAcumulada: 0,
      previstoAcumulado: 0,
      realizadoAcumulado: 0,
    }
  }

  const monthlyPoints = item.pontos_mensais || []
  if (monthlyPoints.length === 0) {
    const isPast = weekStartStr > itemEndStr
    return {
      baseSemana: 0,
      previstoSemana: 0,
      realizadoSemana: 0,
      baseAcumulada: isPast ? Number(item.peso_base ?? 1) : 0,
      previstoAcumulado: isPast ? Number(item.peso_previsto ?? 1) : 0,
      realizadoAcumulado: isPast ? Number(item.peso_realizado ?? 0) : 0,
    }
  }

  const monthKey = weekEndStr.slice(0, 7)
  const monthIndex = monthlyPoints.findIndex((p) => String(p.data || '').startsWith(monthKey))
  const matchingMonthPoint =
    monthIndex >= 0
      ? monthlyPoints[monthIndex]
      : monthlyPoints.find((p) => String(p.data || '') >= weekEndStr) ||
        monthlyPoints[monthlyPoints.length - 1]

  const monthExpected = Number(matchingMonthPoint?.previsto) || 0
  const monthBase = Number(matchingMonthPoint?.base) || 0
  const monthRealized = Number(matchingMonthPoint?.realizado) || 0

  const [year, month] = (matchingMonthPoint?.data || weekEndStr).slice(0, 10).split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate() || 30

  const overlapStart = weekStartStr > itemStartStr ? weekStartStr : itemStartStr
  const overlapEnd = weekEndStr < itemEndStr ? weekEndStr : itemEndStr
  let overlapDays = 0
  if (overlapEnd >= overlapStart) {
    const dStart = new Date(overlapStart).getTime()
    const dEnd = new Date(overlapEnd).getTime()
    overlapDays = Math.max(0, Math.round((dEnd - dStart) / (1000 * 60 * 60 * 24)) + 1)
  }

  const fraction = Math.min(1, overlapDays / daysInMonth)

  const previstoSemana = monthExpected * fraction
  const baseSemana = monthBase * fraction
  const realizadoSemana = monthRealized * fraction

  const prevMonthIndex = monthIndex > 0 ? monthIndex - 1 : -1
  const prevPrevistoAccum =
    prevMonthIndex >= 0 ? Number(monthlyPoints[prevMonthIndex].previsto_acumulado ?? 0) : 0
  const prevBaseAccum =
    prevMonthIndex >= 0 ? Number(monthlyPoints[prevMonthIndex].base_acumulada ?? 0) : 0
  const prevRealizadoAccum =
    prevMonthIndex >= 0 ? Number(monthlyPoints[prevMonthIndex].realizado_acumulado ?? 0) : 0

  const dayOfMonth = Math.min(daysInMonth, Number(weekEndStr.slice(8, 10)) || 7)
  const monthProgressFraction = Math.min(1, Math.max(0, dayOfMonth / daysInMonth))

  const previstoAcumulado = Math.min(1, prevPrevistoAccum + monthExpected * monthProgressFraction)
  const baseAcumulada = Math.min(1, prevBaseAccum + monthBase * monthProgressFraction)
  const realizadoAcumulado = Math.min(1, prevRealizadoAccum + monthRealized * monthProgressFraction)

  return {
    baseSemana,
    previstoSemana,
    realizadoSemana,
    baseAcumulada,
    previstoAcumulado,
    realizadoAcumulado,
  }
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = window.localStorage.getItem('piemonte-theme')
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [projects, setProjects] = useState<Project[]>([])
  const [records, setRecords] = useState<DataRecord[]>([])
  const [curveBaselines, setCurveBaselines] = useState<DataRecord[]>([])
  const [gestaoMilestones, setGestaoMilestones] = useState<DataRecord[]>([])
  const [activeView, setActiveView] = useState<DataView>('gestao_a_vista')
  const lastDataView = useRef<Exclude<DataView, 'gestao_a_vista' | 'curvas'>>('projects')
  const [activityMode, setActivityMode] = useState<ActivityMode>('planning')
  const [budgetMode, setBudgetMode] = useState<BudgetMode>('reports')
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>('general')
  const [cffSummaries, setCffSummaries] = useState<CffSummary[]>([])
  const [cffBudgetFilter, setCffBudgetFilter] = useState<'all' | string>('all')
  const [cffLevelFilter, setCffLevelFilter] = useState<string>('level1')
  const [cffGranularity, setCffGranularity] = useState<'monthly' | 'weekly'>('weekly')
  const [cffMonthFilter, setCffMonthFilter] = useState<'all' | string>('all')
  const [cffWeekFilter, setCffWeekFilter] = useState<'all' | string>('all')
  const [cffDisplayMode, setCffDisplayMode] = useState<'percentual' | 'acumulada'>('percentual')
  const [cffDenseMode, setCffDenseMode] = useState(false)
  const [gestaoMonth, setGestaoMonth] = useState<string>('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('piemonte-theme', theme)
  }, [theme])
  const [gestaoGroup, setGestaoGroup] = useState<string>('all')
  const [gestaoPanelTab, setGestaoPanelTab] = useState<GestaoPanelTab>('panel1')
  const [panel5Service, setPanel5Service] = useState('')
  const [a4LayoutMode, setA4LayoutMode] = useState<boolean>(true)
  const [groupOrders, setGroupOrders] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('dadosprevision_gestao_group_orders_v1')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [floorOrders, setFloorOrders] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('dadosprevision_gestao_floor_orders_v1')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [isGroupOrderModalOpen, setIsGroupOrderModalOpen] = useState(false)
  const [settingsClassificationTab, setSettingsClassificationTab] = useState<'groups' | 'floors'>('groups')
  const [groupOrderDraft, setGroupOrderDraft] = useState<string[]>([])
  const [floorOrderDraft, setFloorOrderDraft] = useState<string[]>([])
  const [floorOrderSearch, setFloorOrderSearch] = useState('')
  const [draggedClassificationItem, setDraggedClassificationItem] = useState<{
    type: 'groups' | 'floors'
    index: number
  } | null>(null)
  const [gestaoPanelPreferences, setGestaoPanelPreferences] = useState<GestaoPanelPreferences>(() => {
    try {
      const saved = localStorage.getItem('dadosprevision_gestao_panel_preferences_v1')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [draggedGestaoRow, setDraggedGestaoRow] = useState<{
    panel: GestaoTablePanel
    service: string
  } | null>(null)
  const [draggedMatrixService, setDraggedMatrixService] = useState<string | null>(null)
  const [customMatrices, setCustomMatrices] = useState<CustomMatrixConfig[]>(() => {
    try {
      const saved = localStorage.getItem('dadosprevision_custom_matrices')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [defaultMatrixConfigs, setDefaultMatrixConfigs] = useState<DefaultMatrixConfigs>(() => {
    try {
      const saved = localStorage.getItem('dadosprevision_default_matrix_configs_v1')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [activeMatrixId, setActiveMatrixId] = useState<string>('default')
  const [isMatrixModalOpen, setIsMatrixModalOpen] = useState(false)
  const [editingMatrixId, setEditingMatrixId] = useState<string | null>(null)
  const [modalMatrixName, setModalMatrixName] = useState('')
  const [modalSelectedGroups, setModalSelectedGroups] = useState<string[]>([])
  const [modalSelectedServices, setModalSelectedServices] = useState<string[]>([])
  const [modalSelectedFloors, setModalSelectedFloors] = useState<string[]>([])
  const [modalFloorSortOrder, setModalFloorSortOrder] = useState<'asc' | 'desc'>('asc')
  const [modalServiceSearch, setModalServiceSearch] = useState('')
  const [modalFloorSearch, setModalFloorSearch] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [synchronizing, setSynchronizing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const cffMonthInitialized = useRef(false)
  const cffWeekInitialized = useRef(false)
  const defaultProjectApplied = useRef(false)

  const loadProjects = useCallback(async () => {
    const payload = await fetchJson('/api/projects')
    const loadedProjects = Array.isArray(payload.projects) ? payload.projects : []
    setProjects(loadedProjects)
    return loadedProjects as Project[]
  }, [])

  const loadCurrentView = useCallback(async () => {
    if (!dataViews.has(activeView)) return
    const requestedType =
      activeView === 'activities' && activityMode === 'jobs'
        ? 'activityJobs'
        : activeView === 'activities' && activityMode === 'measurements'
        ? 'measurements'
        : activeView === 'budgets'
        ? budgetMode === 'items'
          ? 'budgetItems'
          : budgetMode === 'weights'
          ? 'budgetWeights'
          : 'budgets'
        : activeView === 'gestao_a_vista'
        ? 'gestaoVista'
        : activeView === 'curvas'
        ? 'dashboardMonthly'
        : activeView === 'dashboard'
          ? {
              general: 'dashboard',
              weekly: 'dashboardWeekly',
              monthly: 'dashboardMonthly',
              cff: 'dashboardCff',
              services: 'dashboardServices',
              floors: 'dashboardFloors',
              states: 'dashboardStates',
            }[dashboardMode]
          : activeView
    const params = new URLSearchParams({
      type: requestedType,
      page: String(page),
      limit: String(activeView === 'curvas' ? 200 : pageSize),
    })
    if (selectedProject) params.set('projectId', selectedProject)

    const payload = await fetchJson(`/api/data?${params}`)
    setRecords(Array.isArray(payload.records) ? payload.records : [])
    setCurveBaselines(
      activeView === 'curvas' && Array.isArray((payload as any).baselines)
        ? (payload as any).baselines
        : [],
    )
    setGestaoMilestones(
      activeView === 'gestao_a_vista' && Array.isArray(payload.milestones)
        ? payload.milestones
        : [],
    )
    setCffSummaries(Array.isArray((payload as any).summary) ? (payload as any).summary : [])
    setHasMore(Boolean(payload.hasMore))
  }, [activeView, activityMode, budgetMode, dashboardMode, page, pageSize, selectedProject])

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const loadedProjects = await loadProjects()
      if (
        activeView === 'gestao_a_vista' &&
        !selectedProject &&
        !defaultProjectApplied.current
      ) {
        defaultProjectApplied.current = true
        const qoya = loadedProjects.find(
          (project) => String(project.nome_projeto || '').trim().toLocaleUpperCase('pt-BR') === 'QOYA',
        )
        if (qoya?.id_prevision) {
          setSelectedProject(String(qoya.id_prevision))
          return
        }
      }
      await loadCurrentView()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar os dados.')
    } finally {
      setLoading(false)
    }
  }, [activeView, loadCurrentView, loadProjects, selectedProject])

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
            ...(activeView === 'budgets' || activeView === 'dashboard' || activeView === 'curvas'
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
      } else if (activeView === 'budgets' || activeView === 'dashboard' || activeView === 'curvas') {
        setMessage(
          `${integerFormatter.format(payload.totals?.budgets ?? 0)} orçamentos, ${integerFormatter.format(payload.totals?.budgetWeights ?? 0)} vínculos com cronograma e ${integerFormatter.format(payload.totals?.dashboards ?? 0)} dashboards atualizados.`,
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
        : activeView === 'restrictions'
          ? records.flatMap(restrictionChecklistRows)
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

  const cffWeekOptions = useMemo(() => {
    const source = visibleRecords as CffRecord[]
    const startDateStr = source[0]?.data_inicio_obra || source[0]?.data_inicio || '2026-03-02'
    const endDateStr = source[0]?.data_fim_obra || source[0]?.data_fim || '2029-11-30'
    return getProjectWeeks(String(startDateStr), String(endDateStr))
  }, [visibleRecords])

  const cffDefaultWeek = useMemo(() => {
    if (cffWeekOptions.length === 0) return 'all'
    const todayIso = new Date().toISOString().slice(0, 10)
    const currentWeek = cffWeekOptions.find(
      (w) => w.semana_inicio <= todayIso && w.semana_fim >= todayIso,
    )
    if (currentWeek) return currentWeek.data
    const pastWeeks = cffWeekOptions.filter((w) => w.semana_fim <= todayIso)
    if (pastWeeks.length > 0) return pastWeeks[pastWeeks.length - 1].data
    return cffWeekOptions[0]?.data || 'all'
  }, [cffWeekOptions])

  useEffect(() => {
    if (activeView !== 'dashboard' || dashboardMode !== 'cff') return
    if (cffWeekOptions.length === 0) return

    if (cffWeekFilter === 'all' && !cffWeekInitialized.current) {
      cffWeekInitialized.current = true
      setCffWeekFilter(cffDefaultWeek)
      return
    }

    if (cffWeekFilter !== 'all' && !cffWeekOptions.some((w) => w.data === cffWeekFilter)) {
      setCffWeekFilter(cffDefaultWeek)
    }
  }, [activeView, dashboardMode, cffWeekFilter, cffWeekOptions, cffDefaultWeek])

  const cffRows = useMemo<CffRecord[]>(() => {
    if (activeView !== 'dashboard' || dashboardMode !== 'cff') return []

    const source = visibleRecords as CffRecord[]
    const filtered = source.filter((record) => {
      const budgetMatches =
        cffBudgetFilter === 'all' || String(record.orcamento_nome || '') === cffBudgetFilter
      const levelValue = Number(record.nivel ?? 0)
      const levelMatches =
        cffLevelFilter === 'all' ? true : levelValue === Number(cffLevelFilter.replace('level', ''))
      return budgetMatches && levelMatches
    })

    const sorted = [...filtered].sort((left, right) => {
      const codeOrder = compareNatural(left.codigo, right.codigo)
      if (codeOrder !== 0) return codeOrder
      return compareNatural(left.descricao, right.descricao)
    })

    let cumulativeBase = 0
    let cumulativePrevisto = 0
    let cumulativeRealizado = 0

    return sorted.map((record, index) => {
      let base = 0
      let previsto = 0
      let realizado = 0

      if (cffGranularity === 'weekly') {
        if (cffWeekFilter === 'all') {
          base = Number(record.peso_base) || 0
          previsto = Number(record.peso_previsto) || 0
          realizado = Number(record.peso_realizado) || 0
        } else {
          const weekObj = cffWeekOptions.find(
            (w) => w.data === cffWeekFilter || String(w.semana_indice) === cffWeekFilter,
          )
          if (weekObj) {
            const weeklyCalc = calculateItemWeeklyProgress(
              record,
              weekObj.semana_inicio,
              weekObj.semana_fim,
            )
            if (cffDisplayMode === 'acumulada') {
              base = weeklyCalc.baseAcumulada
              previsto = weeklyCalc.previstoAcumulado
              realizado = weeklyCalc.realizadoAcumulado
            } else {
              base = weeklyCalc.baseSemana
              previsto = weeklyCalc.previstoSemana
              realizado = weeklyCalc.realizadoSemana
            }
          }
        }
      } else {
        if (cffMonthFilter === 'all') {
          base = Number(record.peso_base) || 0
          previsto = Number(record.peso_previsto) || 0
          realizado = Number(record.peso_realizado) || 0
        } else {
          const matchingPoint = (record.pontos_mensais || []).find((pt) =>
            String(pt.data || '').startsWith(cffMonthFilter.slice(0, 7)),
          )
          if (matchingPoint) {
            if (cffDisplayMode === 'acumulada') {
              base = Number(matchingPoint.base_acumulada ?? matchingPoint.base) || 0
              previsto = Number(matchingPoint.previsto_acumulado ?? matchingPoint.previsto) || 0
              realizado = Number(matchingPoint.realizado_acumulado ?? matchingPoint.realizado) || 0
            } else {
              base = Number(matchingPoint.base) || 0
              previsto = Number(matchingPoint.previsto) || 0
              realizado = Number(matchingPoint.realizado) || 0
            }
          }
        }
      }

      cumulativeBase += base
      cumulativePrevisto += previsto
      cumulativeRealizado += realizado

      const isAll =
        cffGranularity === 'weekly' ? cffWeekFilter === 'all' : cffMonthFilter === 'all'

      return {
        ...record,
        cffIndex: index + 1,
        cffBase: isAll && cffDisplayMode === 'acumulada' ? cumulativeBase : base,
        cffPrevisto: isAll && cffDisplayMode === 'acumulada' ? cumulativePrevisto : previsto,
        cffRealizado: isAll && cffDisplayMode === 'acumulada' ? cumulativeRealizado : realizado,
      } satisfies CffRecord
    })
  }, [
    activeView,
    dashboardMode,
    visibleRecords,
    cffBudgetFilter,
    cffLevelFilter,
    cffGranularity,
    cffWeekFilter,
    cffWeekOptions,
    cffMonthFilter,
    cffDisplayMode,
  ])

  const cffBudgetNames = useMemo(
    () =>
      [...new Set((records as CffRecord[]).map((record) => String(record.orcamento_nome || '').trim()).filter(Boolean))],
    [records],
  )

  const cffSummaryBudgetNames = useMemo(
    () =>
      [...new Set(cffSummaries.map((summary) => String(summary.orcamento_nome || '').trim()).filter(Boolean))],
    [cffSummaries],
  )

  const cffLevelOptions = useMemo(
    () => {
      const levels = new Set<string>()

      for (const summary of cffSummaries) {
        for (const entry of summary.niveis || []) {
          const level = String(entry.nivel || '').trim()
          if (level && level !== 'all') {
            levels.add(level)
          }
        }
      }

      if (levels.size === 0) {
        for (const record of records as CffRecord[]) {
          const levelValue = Number(record.nivel ?? 0)
          if (Number.isFinite(levelValue) && levelValue > 0) {
            levels.add(String(levelValue))
          }
        }
      }

      return [...levels].sort((left, right) => Number(left) - Number(right))
    },
    [cffSummaries, records],
  )

  useEffect(() => {
    if (activeView !== 'dashboard' || dashboardMode !== 'cff') return
    if (cffLevelFilter === 'all') return
    if (cffLevelOptions.length === 0) return

    const selectedLevel = cffLevelFilter.replace('level', '')
    if (!cffLevelOptions.includes(selectedLevel)) {
      setCffLevelFilter(`level${cffLevelOptions[0]}`)
    }
  }, [activeView, dashboardMode, cffLevelFilter, cffLevelOptions])

  const cffBudgetLabel = cffBudgetFilter === 'all'
    ? (cffBudgetNames[0] || cffSummaryBudgetNames[0] || 'Cronograma Físico-Financeiro')
    : cffBudgetFilter

  const cffMonthlyRows = useMemo(() => {
    if (activeView !== 'dashboard' || dashboardMode !== 'cff') return []

    const selectedSummaries = cffSummaries.filter((summary) =>
      cffBudgetFilter === 'all' ? true : String(summary.orcamento_nome || '') === cffBudgetFilter,
    )

    const pickedLevel = cffLevelFilter === 'all' ? 'all' : cffLevelFilter.replace('level', '')
    const merged = new Map<string, CffMonthlyPoint>()

    for (const summary of selectedSummaries) {
      const levelData =
        summary.niveis?.find((entry) => entry.nivel === pickedLevel) ||
        summary.niveis?.find((entry) => entry.nivel === 'all')

      for (const point of levelData?.meses || []) {
        const key = String(point.data || '')
        if (!merged.has(key)) {
          merged.set(key, { data: point.data || null, base: 0, previsto: 0, realizado: 0 })
        }
        const current = merged.get(key)!
        current.base += Number(point.base) || 0
        current.previsto += Number(point.previsto) || 0
        current.realizado += Number(point.realizado) || 0
      }
    }

    const rows = [...merged.values()].sort((left, right) => compareNatural(left.data, right.data))

    let cumulativeBase = 0
    let cumulativePrevisto = 0
    let cumulativeRealizado = 0

    return rows.map((row) => {
      cumulativeBase += row.base
      cumulativePrevisto += row.previsto
      cumulativeRealizado += row.realizado

      return {
        ...row,
        baseExibida: cffDisplayMode === 'acumulada' ? cumulativeBase : row.base,
        previstoExibido: cffDisplayMode === 'acumulada' ? cumulativePrevisto : row.previsto,
        realizadoExibido: cffDisplayMode === 'acumulada' ? cumulativeRealizado : row.realizado,
      } satisfies CffMonthlyRow
    })
  }, [activeView, dashboardMode, cffSummaries, cffBudgetFilter, cffLevelFilter, cffDisplayMode])

  const cffMonthOptions = useMemo(
    () =>
      cffMonthlyRows
        .map((row) => String(row.data || '').trim())
        .filter(Boolean),
    [cffMonthlyRows],
  )

  const cffDefaultMonth = useMemo(() => {
    if (cffMonthlyRows.length === 0) return 'all'
    const withRealized = [...cffMonthlyRows].reverse().find((row) => Number(row.realizado) > 0)
    if (withRealized?.data) return String(withRealized.data)
    const currentPrefix = new Date().toISOString().slice(0, 7)
    const currentMonthRow = cffMonthlyRows.find((row) => String(row.data || '').startsWith(currentPrefix))
    if (currentMonthRow?.data) return String(currentMonthRow.data)
    return String(cffMonthlyRows[0]?.data || 'all')
  }, [cffMonthlyRows])

  useEffect(() => {
    if (activeView !== 'dashboard' || dashboardMode !== 'cff') return
    if (cffMonthOptions.length === 0) return

    if (cffMonthFilter === 'all' && !cffMonthInitialized.current) {
      cffMonthInitialized.current = true
      setCffMonthFilter(cffDefaultMonth)
      return
    }

    if (cffMonthFilter !== 'all' && !cffMonthOptions.includes(cffMonthFilter)) {
      setCffMonthFilter(cffDefaultMonth)
    }
  }, [activeView, dashboardMode, cffMonthFilter, cffMonthOptions, cffDefaultMonth])

  const cffReferenceDate = useMemo(() => {
    if (cffGranularity === 'weekly') {
      if (cffWeekFilter !== 'all') return cffWeekFilter
      return cffDefaultWeek !== 'all' ? cffDefaultWeek : null
    }
    if (cffMonthFilter !== 'all') return cffMonthFilter
    return cffDefaultMonth !== 'all' ? cffDefaultMonth : null
  }, [cffGranularity, cffWeekFilter, cffDefaultWeek, cffMonthFilter, cffDefaultMonth])

  const cffSummaryTotals = useMemo(() => {
    let totalBase = 0
    let totalPrevisto = 0
    let totalRealizado = 0
    for (const row of cffRows) {
      totalBase += Number(row.cffBase) || 0
      totalPrevisto += Number(row.cffPrevisto) || 0
      totalRealizado += Number(row.cffRealizado) || 0
    }
    return {
      base: totalBase,
      previsto: totalPrevisto,
      realizado: totalRealizado,
    }
  }, [cffRows])

  // Gestão à Vista Calculations
  const gestaoActivities = useMemo(() => {
    if (activeView !== 'gestao_a_vista') return []
    return records
  }, [activeView, records])

  const gestaoGroupOptions = useMemo(() => {
    const groups = new Set<string>()
    for (const act of gestaoActivities) {
      const group = activityGroupName(act)
      if (group) groups.add(group)
    }
    return Array.from(groups).sort(compareNatural)
  }, [gestaoActivities])

  const groupOrderKey = selectedProject || '__all_projects__'
  const currentGroupOrder = useMemo(() => {
    const savedOrder = groupOrders[groupOrderKey] || []
    return [
      ...savedOrder.filter((group) => gestaoGroupOptions.includes(group)),
      ...gestaoGroupOptions.filter((group) => !savedOrder.includes(group)),
    ]
  }, [groupOrderKey, groupOrders, gestaoGroupOptions])

  useEffect(() => {
    try {
      localStorage.setItem('dadosprevision_gestao_group_orders_v1', JSON.stringify(groupOrders))
    } catch (e) {
      console.error('Erro ao salvar a classificação dos grupos no localStorage:', e)
    }
  }, [groupOrders])

  useEffect(() => {
    try {
      localStorage.setItem('dadosprevision_gestao_floor_orders_v1', JSON.stringify(floorOrders))
    } catch (e) {
      console.error('Erro ao salvar a classificação dos pavimentos no localStorage:', e)
    }
  }, [floorOrders])

  useEffect(() => {
    if (gestaoGroup !== 'all' && !currentGroupOrder.includes(gestaoGroup)) {
      setGestaoGroup('all')
    }
  }, [currentGroupOrder, gestaoGroup])

  const gestaoCatalog = useMemo(() => {
    const orderIndex = new Map(currentGroupOrder.map((group, index) => [group, index]))
    const fallbackRank = currentGroupOrder.length
    const services = new Map<string, GestaoServiceItem>()
    const floors = new Map<string, GestaoFloorItem>()
    for (const activity of gestaoActivities) {
      const serviceName = String(activity.servico_nome || '-')
      const floorName = String(activity.pavimento_nome || '-')
      const rank = orderIndex.get(activityGroupName(activity)) ?? fallbackRank
      const service = services.get(serviceName) || {
        name: serviceName,
        position: Number(activity.posicao_servico) || 999,
        groupRank: rank,
        activities: [],
      }
      service.groupRank = Math.min(service.groupRank, rank)
      service.activities.push(activity)
      services.set(serviceName, service)
      if (activity.pavimento_nome) {
        const floor = floors.get(floorName) || {
          id: String(activity.pavimento_id || ''),
          name: floorName,
          groupRank: rank,
        }
        floor.groupRank = Math.min(floor.groupRank, rank)
        floors.set(floorName, floor)
      }
    }
    return {
      services: Array.from(services.values()).sort(
        (a, b) => a.groupRank - b.groupRank || a.position - b.position || compareNatural(a.name, b.name),
      ),
      floors: Array.from(floors.values()).sort(
        (a, b) => a.groupRank - b.groupRank || compareNatural(a.name, b.name),
      ),
    }
  }, [currentGroupOrder, gestaoActivities])

  const currentFloorOrder = useMemo(() => {
    const availableFloors = gestaoCatalog.floors.map((floor) => floor.name)
    const savedOrder = floorOrders[groupOrderKey] || []
    return [
      ...savedOrder.filter((floor) => availableFloors.includes(floor)),
      ...availableFloors.filter((floor) => !savedOrder.includes(floor)),
    ]
  }, [floorOrders, gestaoCatalog.floors, groupOrderKey])

  const panel5ServiceOptions = useMemo(
    () => gestaoCatalog.services.filter((service) =>
      gestaoGroup === 'all' ||
      service.activities.some((activity) => activityGroupName(activity) === gestaoGroup),
    ),
    [gestaoCatalog.services, gestaoGroup],
  )

  useEffect(() => {
    if (
      panel5ServiceOptions.length > 0 &&
      !panel5ServiceOptions.some((service) => service.name === panel5Service)
    ) {
      setPanel5Service(panel5ServiceOptions[0].name)
    } else if (panel5ServiceOptions.length === 0 && panel5Service) {
      setPanel5Service('')
    }
  }, [panel5Service, panel5ServiceOptions])

  const panel5Rows = useMemo(() => {
    if (!panel5Service) return []
    const groupIndex = new Map(currentGroupOrder.map((group, index) => [group, index]))
    const query = search.trim().toLocaleLowerCase('pt-BR')
    return gestaoActivities
      .filter((activity) => {
        if (String(activity.servico_nome || '-') !== panel5Service) return false
        if (gestaoGroup !== 'all' && activityGroupName(activity) !== gestaoGroup) return false
        if (!query) return true
        return `${activity.servico_nome || ''} ${activity.pavimento_nome || ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(query)
      })
      .map((activity, index) => {
        const service = String(activity.servico_nome || '-')
        const floor = String(activity.pavimento_nome || '-')
        const explicitDuration =
          activity.duracao_dias === null || activity.duracao_dias === undefined || activity.duracao_dias === ''
            ? Number.NaN
            : Number(activity.duracao_dias)
        const start = activity.data_inicio ? new Date(activity.data_inicio) : null
        const end = activity.data_fim ? new Date(activity.data_fim) : null
        const calculatedDuration =
          start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
            ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
            : null
        return {
          key: String(activity.firestore_id || activity.id_prevision || `${service}-${floor}-${index}`),
          service,
          floor,
          serviceFloor: `${service} - ${floor}`,
          duration: Number.isFinite(explicitDuration) ? explicitDuration : calculatedDuration,
          startDate: formatDate(activity.data_inicio),
          endDate: formatDate(activity.data_fim),
          groupRank: groupIndex.get(activityGroupName(activity)) ?? currentGroupOrder.length,
          floorPosition: Number(activity.posicao_pavimento) || Number.MAX_SAFE_INTEGER,
        }
      })
      .sort(
        (a, b) =>
          a.groupRank - b.groupRank ||
          a.floorPosition - b.floorPosition ||
          compareNatural(a.floor, b.floor) ||
          compareNatural(a.startDate, b.startDate),
      )
  }, [currentGroupOrder, gestaoActivities, gestaoGroup, panel5Service, search])

  const gestaoMonthOptions = useMemo(() => {
    const months = new Set<string>()
    for (const act of gestaoActivities) {
      if (act.data_inicio) {
        const d = new Date(act.data_inicio)
        if (!isNaN(d.getTime())) {
          months.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
        }
      }
      if (act.data_fim) {
        const d = new Date(act.data_fim)
        if (!isNaN(d.getTime())) {
          months.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
        }
      }
    }
    return Array.from(months).sort()
  }, [gestaoActivities])

  useEffect(() => {
    if (activeView !== 'gestao_a_vista') return
    if (gestaoMonthOptions.length > 0 && (!gestaoMonth || !gestaoMonthOptions.includes(gestaoMonth))) {
      const todayMonth = new Date().toISOString().slice(0, 7)
      if (gestaoMonthOptions.includes(todayMonth)) {
        setGestaoMonth(todayMonth)
      } else {
        const middleIndex = Math.floor(gestaoMonthOptions.length / 3)
        setGestaoMonth(gestaoMonthOptions[middleIndex] || gestaoMonthOptions[0])
      }
    }
  }, [activeView, gestaoMonth, gestaoMonthOptions])

  const gestaoFilteredActivities = useMemo(() => {
    return gestaoActivities.filter((act) => {
      if (gestaoGroup !== 'all' && activityGroupName(act) !== gestaoGroup) {
        return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchService = String(act.servico_nome || '').toLowerCase().includes(q)
        const matchFloor = String(act.pavimento_nome || '').toLowerCase().includes(q)
        const matchCode = String(act.codigo_eap || '').toLowerCase().includes(q)
        if (!matchService && !matchFloor && !matchCode) return false
      }
      return true
    })
  }, [gestaoActivities, gestaoGroup, search])

  const milestoneDashboard = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rawMilestoneName = (milestone: DataRecord) =>
      String(milestone.nome || '').trim() || 'Marco sem nome'
    const milestoneTypeKey = (name: string) =>
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim()
    const milestones = gestaoMilestones
      .filter((milestone) => {
        if (!query) return true
        return (
          String(milestone.nome || '').toLowerCase().includes(query) ||
          String(milestone.projeto_nome || '').toLowerCase().includes(query)
        )
      })
      .map((milestone): DataRecord & { dateText: string; date: Date | null } => {
        const dateText = String(milestone.data || '').slice(0, 10)
        const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText)
          ? new Date(`${dateText}T00:00:00Z`)
          : null
        return { ...milestone, dateText, date }
      })
      .filter(
        (milestone): milestone is DataRecord & { dateText: string; date: Date } =>
          Boolean(milestone.date && !Number.isNaN(milestone.date.getTime())),
      )

    const variantsByType = new Map<string, Map<string, number>>()
    for (const milestone of milestones) {
      const rawName = rawMilestoneName(milestone)
      const typeKey = milestoneTypeKey(rawName)
      const variants = variantsByType.get(typeKey) || new Map<string, number>()
      variants.set(rawName, (variants.get(rawName) || 0) + 1)
      variantsByType.set(typeKey, variants)
    }
    const displayNameByType = new Map(
      Array.from(variantsByType, ([typeKey, variants]) => [
        typeKey,
        Array.from(variants)
          .sort(([nameA, countA], [nameB, countB]) =>
            countB - countA || compareNatural(nameA, nameB),
          )[0][0],
      ]),
    )
    const milestoneName = (milestone: DataRecord) => {
      const rawName = rawMilestoneName(milestone)
      return displayNameByType.get(milestoneTypeKey(rawName)) || rawName
    }

    const today = new Date()
    const currentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    const windowStart = new Date(Date.UTC(
      currentMonth.getUTCFullYear(),
      currentMonth.getUTCMonth() - 6,
      1,
    ))
    const windowEnd = new Date(Date.UTC(
      currentMonth.getUTCFullYear(),
      currentMonth.getUTCMonth() + 11,
      1,
    ))

    const firstDateByMilestone = new Map<string, number>()
    for (const milestone of milestones) {
      const name = milestoneName(milestone)
      const timestamp = milestone.date.getTime()
      const currentTimestamp = firstDateByMilestone.get(name)
      if (currentTimestamp === undefined || timestamp < currentTimestamp) {
        firstDateByMilestone.set(name, timestamp)
      }
    }
    const sortMilestoneNamesChronologically = (names: string[]) =>
      [...names].sort(
        (nameA, nameB) =>
          (firstDateByMilestone.get(nameA) ?? Number.MAX_SAFE_INTEGER) -
            (firstDateByMilestone.get(nameB) ?? Number.MAX_SAFE_INTEGER) ||
          compareNatural(nameA, nameB),
      )
    const milestoneNames = sortMilestoneNamesChronologically(
      Array.from(new Set(milestones.map(milestoneName))),
    )
    const chartMilestoneNames = sortMilestoneNamesChronologically(
      Array.from(
        new Set(
          milestones
            .filter((milestone) => milestone.date >= windowStart && milestone.date < windowEnd)
            .map(milestoneName),
        ),
      ),
    )
    const colorByName = new Map<string, string>()
    const usedColors = new Set<string>()
    milestoneNames.forEach((name, index) => {
      const configuredColor = String(
        milestones.find((milestone) => milestoneName(milestone) === name)?.cor || '',
      )
      const normalizedConfiguredColor = configuredColor.toLowerCase()
      const color =
        /^#[0-9a-f]{3,8}$/i.test(configuredColor) && !usedColors.has(normalizedConfiguredColor)
          ? configuredColor
          : MILESTONE_COLORS[index % MILESTONE_COLORS.length]
      colorByName.set(name, color)
      usedColors.add(color.toLowerCase())
    })

    const months = Array.from({ length: 17 }, (_, index) => {
      const date = new Date(Date.UTC(
        windowStart.getUTCFullYear(),
        windowStart.getUTCMonth() + index,
        1,
      ))
      const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
      const monthMilestones = milestones.filter(
        (milestone) => milestone.date! >= date && milestone.date! < nextMonth,
      )
      const counts = new Map<string, number>()
      for (const milestone of monthMilestones) {
        const name = milestoneName(milestone)
        counts.set(name, (counts.get(name) || 0) + 1)
      }
      return {
        key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        label: date
          .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
          .replace('.', ''),
        isCurrent: date.getTime() === currentMonth.getTime(),
        total: monthMilestones.length,
        segments: chartMilestoneNames
          .map((name) => ({ name, count: counts.get(name) || 0, color: colorByName.get(name)! }))
          .filter((segment) => segment.count > 0),
      }
    })

    const projectMap = new Map<
      string,
      { projectId: string; projectName: string; datesByMilestone: Map<string, string[]> }
    >()
    for (const milestone of milestones) {
      const projectId = String(milestone.projeto_id || milestone.projeto_nome || '-')
      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, {
          projectId,
          projectName: String(milestone.projeto_nome || '-'),
          datesByMilestone: new Map(),
        })
      }
      const name = milestoneName(milestone)
      const dates = projectMap.get(projectId)!.datesByMilestone.get(name) || []
      dates.push(milestone.dateText)
      projectMap.get(projectId)!.datesByMilestone.set(name, dates)
    }

    const projectRows = Array.from(projectMap.values())
      .map((project) => ({
        ...project,
        datesByMilestone: new Map(
          Array.from(project.datesByMilestone, ([name, dates]) => [name, dates.sort()]),
        ),
      }))
      .sort((a, b) => compareNatural(a.projectName, b.projectName))

    return {
      months,
      milestoneNames,
      chartMilestoneNames,
      colorByName,
      projectRows,
      totalInWindow: milestones.filter(
        (milestone) => milestone.date! >= windowStart && milestone.date! < windowEnd,
      ).length,
      maxMonthTotal: Math.max(1, ...months.map((month) => month.total)),
      windowStart,
      windowEnd: new Date(windowEnd.getTime() - 1),
    }
  }, [gestaoMilestones, search])

  const gestaoData = useMemo(() => {
    if (!gestaoMonth) {
      return {
        services: [] as GestaoServiceItem[],
        floors: [] as GestaoFloorItem[],
        mMinus3: null,
        mMinus2: null,
        mMinus1: null,
        m0: null,
        mPlus1: null,
        mPlus2: null,
        mPlus3: null,
        panel1Rows: [],
        panel2Rows: [],
        panel3Rows: [],
        matrixMap: new Map<string, DataRecord>(),
      }
    }

    const [year, month] = gestaoMonth.split('-').map(Number)
    const monthIdx = month - 1

    function getMonthRange(y: number, mIdx: number) {
      const start = new Date(Date.UTC(y, mIdx, 1, 0, 0, 0))
      const end = new Date(Date.UTC(y, mIdx + 1, 0, 23, 59, 59, 999))
      const label = `${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`
      const startFormatted = `${String(start.getUTCDate()).padStart(2, '0')}/${String(start.getUTCMonth() + 1).padStart(2, '0')}/${start.getUTCFullYear()}`
      const endFormatted = `${String(end.getUTCDate()).padStart(2, '0')}/${String(end.getUTCMonth() + 1).padStart(2, '0')}/${end.getUTCFullYear()}`
      return { start, end, label, startFormatted, endFormatted }
    }

    const mMinus3 = getMonthRange(year, monthIdx - 3)
    const mMinus2 = getMonthRange(year, monthIdx - 2)
    const mMinus1 = getMonthRange(year, monthIdx - 1)
    const m0 = getMonthRange(year, monthIdx)
    const mPlus1 = getMonthRange(year, monthIdx + 1)
    const mPlus2 = getMonthRange(year, monthIdx + 2)
    const mPlus3 = getMonthRange(year, monthIdx + 3)

    const groupOrderIndex = new Map(currentGroupOrder.map((group, index) => [group, index]))
    const fallbackGroupRank = currentGroupOrder.length
    const serviceMap = new Map<string, GestaoServiceItem>()
    const floorMap = new Map<string, GestaoFloorItem>()
    const matrixMap = new Map<string, DataRecord>()

    for (const act of gestaoFilteredActivities) {
      const sName = act.servico_nome || '-'
      const fName = act.pavimento_nome || '-'
      const sPos = act.posicao_servico ?? 999
      const groupRank = groupOrderIndex.get(activityGroupName(act)) ?? fallbackGroupRank

      if (!serviceMap.has(sName)) {
        serviceMap.set(sName, { name: sName, position: sPos, groupRank, activities: [] })
      }
      const service = serviceMap.get(sName)!
      service.groupRank = Math.min(service.groupRank, groupRank)
      service.activities.push(act)

      if (act.pavimento_nome && !floorMap.has(fName)) {
        floorMap.set(fName, { id: String(act.pavimento_id || ''), name: fName, groupRank })
      } else if (act.pavimento_nome) {
        const floor = floorMap.get(fName)!
        floor.groupRank = Math.min(floor.groupRank, groupRank)
      }

      matrixMap.set(`${sName}__${fName}`, act)
    }

    const services = Array.from(serviceMap.values()).sort(
      (a, b) => a.groupRank - b.groupRank || a.position - b.position || compareNatural(a.name, b.name),
    )
    const floors = Array.from(floorMap.values()).sort(
      (a, b) => a.groupRank - b.groupRank || compareNatural(a.name, b.name),
    )

    function calcProgressAt(activities: DataRecord[], range: { start: Date; end: Date }) {
      let prevTotal = 0
      let realTotal = 0
      for (const act of activities) {
        const start = act.data_inicio ? new Date(act.data_inicio) : null
        const end = act.data_fim ? new Date(act.data_fim) : null

        if (start && end) {
          if (end <= range.end) {
            prevTotal += 1.0
          } else if (start <= range.end) {
            const totalMs = end.getTime() - start.getTime()
            const elapsedMs = range.end.getTime() - start.getTime()
            if (totalMs > 0) {
              prevTotal += Math.min(1.0, Math.max(0.0, elapsedMs / totalMs))
            }
          }
        }

        const measurements = Array.isArray(act.medicoes) ? act.medicoes : []
        let latestHistoricalMeasurement: DataRecord | null = null
        for (const measurement of measurements) {
          const measuredAt = measurement?.data_medicao ? new Date(measurement.data_medicao) : null
          if (
            measuredAt &&
            !Number.isNaN(measuredAt.getTime()) &&
            measuredAt <= range.end &&
            (!latestHistoricalMeasurement ||
              measuredAt > new Date(latestHistoricalMeasurement.data_medicao))
          ) {
            latestHistoricalMeasurement = measurement
          }
        }

        if (latestHistoricalMeasurement) {
          realTotal += Number(latestHistoricalMeasurement.progresso_realizado) || 0
          continue
        }

        // Fallback para bases antigas sem histórico detalhado: só usa o avanço
        // atual quando sabemos que a última medição já existia no fechamento.
        const lastMeasurementAt = act.ultima_medicao_data
          ? new Date(act.ultima_medicao_data)
          : null
        if (
          lastMeasurementAt &&
          !Number.isNaN(lastMeasurementAt.getTime()) &&
          lastMeasurementAt <= range.end
        ) {
          realTotal += Number(act.progresso_realizado) || 0
        }
      }
      return { prev: prevTotal, real: realTotal }
    }

    function countActive(activities: DataRecord[], range: { start: Date; end: Date }) {
      let count = 0
      for (const act of activities) {
        const start = act.data_inicio ? new Date(act.data_inicio) : null
        const end = act.data_fim ? new Date(act.data_fim) : null
        if (start && end && start <= range.end && end >= range.start) {
          count += 1
        }
      }
      return count
    }

    const panel1Rows = services.map((s) => {
      const pM3 = calcProgressAt(s.activities, mMinus3)
      const pM2 = calcProgressAt(s.activities, mMinus2)
      const pM1 = calcProgressAt(s.activities, mMinus1)
      return {
        service: s.name,
        groupRank: s.groupRank,
        m3: pM3,
        m2: pM2,
        m1: pM1,
      }
    })

    const panel2Rows = services.map((s) => {
      const activePavs = new Map<string, boolean>()
      const floorOrderIndex = new Map(currentFloorOrder.map((floor, index) => [floor, index]))
      let qtdePrevista = 0
      let qtdeAtrasada = 0
      for (const act of s.activities) {
        const start = act.data_inicio ? new Date(act.data_inicio) : null
        const end = act.data_fim ? new Date(act.data_fim) : null
        const prog = Number(act.progresso_realizado) || 0
        if (start && end && start <= m0.end && end >= m0.start) {
          qtdePrevista += 1
          if (prog < 1.0 && act.pavimento_nome) {
            if (!activePavs.has(act.pavimento_nome)) {
              activePavs.set(act.pavimento_nome, false)
            }
          }
        } else if (end && end < m0.start && prog < 1.0) {
          qtdeAtrasada += 1
          if (act.pavimento_nome) {
            activePavs.set(act.pavimento_nome, true)
          }
        }
      }
      return {
        service: s.name,
        groupRank: s.groupRank,
        qtdePrevista,
        qtdeAtrasada,
        pavimentos: Array.from(activePavs, ([name, isOverdue]) => ({ name, isOverdue })).sort(
          (a, b) =>
            (floorOrderIndex.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
              (floorOrderIndex.get(b.name) ?? Number.MAX_SAFE_INTEGER) ||
            compareNatural(a.name, b.name),
        ),
      }
    })

    const panel3Rows = services.map((s) => {
      const c1 = countActive(s.activities, mPlus1)
      const c2 = countActive(s.activities, mPlus2)
      const c3 = countActive(s.activities, mPlus3)
      return {
        service: s.name,
        groupRank: s.groupRank,
        mPlus1: c1,
        mPlus2: c2,
        mPlus3: c3,
      }
    })

    return {
      services,
      floors,
      mMinus3,
      mMinus2,
      mMinus1,
      m0,
      mPlus1,
      mPlus2,
      mPlus3,
      panel1Rows,
      panel2Rows,
      panel3Rows,
      matrixMap,
    }
  }, [currentFloorOrder, currentGroupOrder, gestaoFilteredActivities, gestaoMonth])

  const gestaoPanelPreferenceKey = selectedProject || '__all_projects__'
  const currentGestaoPanelPreferences = useMemo(() => {
    const saved = gestaoPanelPreferences[gestaoPanelPreferenceKey]
    const emptyPreference = (): GestaoPanelPreference => ({
      onlyWithData: false,
      serviceOrder: [],
    })
    return {
      panel1: saved?.panel1 || emptyPreference(),
      panel2: saved?.panel2 || emptyPreference(),
      panel3: saved?.panel3 || emptyPreference(),
      panel4: saved?.panel4 || emptyPreference(),
    }
  }, [gestaoPanelPreferenceKey, gestaoPanelPreferences])

  const gestaoPanelRows = useMemo(() => {
    function orderRows<T extends { service: string; groupRank: number }>(
      rows: T[],
      preference: GestaoPanelPreference,
      hasData: (row: T) => boolean,
    ) {
      const naturalOrder = rows.map((row) => row.service)
      const completeOrder = [
        ...preference.serviceOrder.filter((service) => naturalOrder.includes(service)),
        ...naturalOrder.filter((service) => !preference.serviceOrder.includes(service)),
      ]
      const orderIndex = new Map(completeOrder.map((service, index) => [service, index]))
      return rows
        .filter((row) => !preference.onlyWithData || hasData(row))
        .slice()
        .sort(
          (a, b) =>
            a.groupRank - b.groupRank ||
            (orderIndex.get(a.service) ?? Number.MAX_SAFE_INTEGER) -
              (orderIndex.get(b.service) ?? Number.MAX_SAFE_INTEGER),
        )
    }

    return {
      panel1: orderRows(
        gestaoData.panel1Rows,
        currentGestaoPanelPreferences.panel1,
        (row) =>
          row.m3.prev > 0 || row.m3.real > 0 ||
          row.m2.prev > 0 || row.m2.real > 0 ||
          row.m1.prev > 0 || row.m1.real > 0,
      ),
      panel2: orderRows(
        gestaoData.panel2Rows,
        currentGestaoPanelPreferences.panel2,
        (row) => row.qtdePrevista > 0 || row.qtdeAtrasada > 0 || row.pavimentos.length > 0,
      ),
      panel3: orderRows(
        gestaoData.panel3Rows,
        currentGestaoPanelPreferences.panel3,
        (row) => row.mPlus1 > 0 || row.mPlus2 > 0 || row.mPlus3 > 0,
      ),
    }
  }, [currentGestaoPanelPreferences, gestaoData])

  const updateGestaoPanelPreference = useCallback(
    (
      panel: ReorderableGestaoPanel,
      update: (preference: GestaoPanelPreference) => GestaoPanelPreference,
    ) => {
      setGestaoPanelPreferences((previous) => {
        const projectPreferences = previous[gestaoPanelPreferenceKey]
        const current = projectPreferences?.[panel] || { onlyWithData: false, serviceOrder: [] }
        return {
          ...previous,
          [gestaoPanelPreferenceKey]: {
            panel1: projectPreferences?.panel1 || { onlyWithData: false, serviceOrder: [] },
            panel2: projectPreferences?.panel2 || { onlyWithData: false, serviceOrder: [] },
            panel3: projectPreferences?.panel3 || { onlyWithData: false, serviceOrder: [] },
            panel4: projectPreferences?.panel4 || { onlyWithData: false, serviceOrder: [] },
            [panel]: update(current),
          },
        }
      })
    },
    [gestaoPanelPreferenceKey],
  )

  const handleGestaoRowDrop = useCallback(
    (panel: GestaoTablePanel, targetService: string, availableServices: string[]) => {
      if (!draggedGestaoRow || draggedGestaoRow.panel !== panel) return
      const sourceService = draggedGestaoRow.service
      setDraggedGestaoRow(null)
      if (sourceService === targetService) return

      updateGestaoPanelPreference(panel, (preference) => {
        const completeOrder = [
          ...preference.serviceOrder.filter((service) => availableServices.includes(service)),
          ...availableServices.filter((service) => !preference.serviceOrder.includes(service)),
        ]
        const sourceIndex = completeOrder.indexOf(sourceService)
        const targetIndex = completeOrder.indexOf(targetService)
        if (sourceIndex < 0 || targetIndex < 0) return preference
        completeOrder.splice(sourceIndex, 1)
        completeOrder.splice(targetIndex, 0, sourceService)
        return { ...preference, serviceOrder: completeOrder }
      })
    },
    [draggedGestaoRow, updateGestaoPanelPreference],
  )

  useEffect(() => {
    try {
      localStorage.setItem(
        'dadosprevision_gestao_panel_preferences_v1',
        JSON.stringify(gestaoPanelPreferences),
      )
    } catch (e) {
      console.error('Erro ao salvar preferências dos painéis no localStorage:', e)
    }
  }, [gestaoPanelPreferences])

  // Save custom matrices to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('dadosprevision_custom_matrices', JSON.stringify(customMatrices))
    } catch (e) {
      console.error('Erro ao salvar matrizes personalizadas no localStorage:', e)
    }
  }, [customMatrices])

  useEffect(() => {
    try {
      localStorage.setItem(
        'dadosprevision_default_matrix_configs_v1',
        JSON.stringify(defaultMatrixConfigs),
      )
    } catch (e) {
      console.error('Erro ao salvar a matriz padrão no localStorage:', e)
    }
  }, [defaultMatrixConfigs])

  function handleOpenGroupOrderModal() {
    setGroupOrderDraft(currentGroupOrder)
    setFloorOrderDraft(currentFloorOrder)
    setFloorOrderSearch('')
    setSettingsClassificationTab('groups')
    setIsGroupOrderModalOpen(true)
  }

  function handleMoveGroup(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= groupOrderDraft.length) return
    setGroupOrderDraft((previous) => {
      const next = [...previous]
      const [group] = next.splice(index, 1)
      next.splice(targetIndex, 0, group)
      return next
    })
  }

  function handleMoveFloor(index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= floorOrderDraft.length) return
    setFloorOrderDraft((previous) => {
      const next = [...previous]
      const [floor] = next.splice(index, 1)
      next.splice(targetIndex, 0, floor)
      return next
    })
  }

  function handleClassificationDrop(type: 'groups' | 'floors', targetIndex: number) {
    if (!draggedClassificationItem || draggedClassificationItem.type !== type) return
    const sourceIndex = draggedClassificationItem.index
    setDraggedClassificationItem(null)
    if (sourceIndex === targetIndex) return
    const reorder = (previous: string[]) => {
      const next = [...previous]
      const [item] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, item)
      return next
    }
    if (type === 'groups') setGroupOrderDraft(reorder)
    else setFloorOrderDraft(reorder)
  }

  function handleSaveGroupOrder() {
    setGroupOrders((previous) => ({ ...previous, [groupOrderKey]: groupOrderDraft }))
    setFloorOrders((previous) => ({ ...previous, [groupOrderKey]: floorOrderDraft }))
    setIsGroupOrderModalOpen(false)
  }

  // Custom matrices filtered for current project
  const projectCustomMatrices = useMemo(() => {
    return customMatrices.filter(
      (m) => !m.projectId || !selectedProject || m.projectId === selectedProject,
    )
  }, [customMatrices, selectedProject])

  const defaultMatrixKey = selectedProject || '__all_projects__'
  const defaultMatrixConfig = defaultMatrixConfigs[defaultMatrixKey]
  const isDefaultMatrixAvailable = defaultMatrixConfig !== null

  useEffect(() => {
    const customMatrixExists = projectCustomMatrices.some((matrix) => matrix.id === activeMatrixId)
    if (activeMatrixId === 'default' && !isDefaultMatrixAvailable) {
      setActiveMatrixId(projectCustomMatrices[0]?.id || 'none')
    } else if (activeMatrixId === 'none' && (isDefaultMatrixAvailable || projectCustomMatrices.length > 0)) {
      setActiveMatrixId(isDefaultMatrixAvailable ? 'default' : projectCustomMatrices[0].id)
    } else if (activeMatrixId !== 'default' && activeMatrixId !== 'none' && !customMatrixExists) {
      setActiveMatrixId(isDefaultMatrixAvailable ? 'default' : projectCustomMatrices[0]?.id || 'none')
    }
  }, [activeMatrixId, isDefaultMatrixAvailable, projectCustomMatrices])

  const currentCustomMatrix = useMemo(() => {
    if (activeMatrixId === 'default') return defaultMatrixConfig || null
    if (activeMatrixId === 'none') return null
    return customMatrices.find((m) => m.id === activeMatrixId) || null
  }, [activeMatrixId, customMatrices, defaultMatrixConfig])

  const matrixGroupSet = useMemo(
    () => new Set(
      currentCustomMatrix?.selectedGroups?.length
        ? currentCustomMatrix.selectedGroups
        : currentGroupOrder,
    ),
    [currentCustomMatrix, currentGroupOrder],
  )

  const matrixServices = useMemo(() => {
    if (activeMatrixId === 'none') return []
    const servicesInGroups = gestaoData.services.filter((service) =>
      service.activities.some((activity) => matrixGroupSet.has(activityGroupName(activity))),
    )
    if (!currentCustomMatrix || currentCustomMatrix.selectedServices.length === 0) {
      const order = currentGestaoPanelPreferences.panel4.serviceOrder
      const orderIndex = new Map(order.map((service, index) => [service, index]))
      return servicesInGroups
        .map((service, naturalIndex) => ({ service, naturalIndex }))
        .sort(
          (a, b) =>
            a.service.groupRank - b.service.groupRank ||
            (orderIndex.get(a.service.name) ?? order.length + a.naturalIndex) -
              (orderIndex.get(b.service.name) ?? order.length + b.naturalIndex),
        )
        .map(({ service }) => service)
    }
    const serviceMap = new Map(servicesInGroups.map((service) => [service.name, service]))
    const selectedOrder = new Map(
      currentCustomMatrix.selectedServices.map((service, index) => [service, index]),
    )
    const result: GestaoServiceItem[] = []
    for (const sName of currentCustomMatrix.selectedServices) {
      const found = serviceMap.get(sName)
      if (found) result.push(found)
    }
    return result.sort(
      (a, b) =>
        a.groupRank - b.groupRank ||
        (selectedOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
          (selectedOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER),
    )
  }, [activeMatrixId, currentCustomMatrix, currentGestaoPanelPreferences.panel4.serviceOrder, gestaoData.services, matrixGroupSet])

  const handleMatrixServiceDrop = useCallback(
    (targetService: string) => {
      const sourceService = draggedMatrixService
      setDraggedMatrixService(null)
      if (!sourceService || sourceService === targetService) return

      const visibleOrder = matrixServices.map((service) => service.name)
      const sourceIndex = visibleOrder.indexOf(sourceService)
      const targetIndex = visibleOrder.indexOf(targetService)
      if (sourceIndex < 0 || targetIndex < 0) return
      visibleOrder.splice(sourceIndex, 1)
      visibleOrder.splice(targetIndex, 0, sourceService)

      if (activeMatrixId === 'default') {
        if (defaultMatrixConfig) {
          setDefaultMatrixConfigs((previous) => ({
            ...previous,
            [defaultMatrixKey]: {
              ...defaultMatrixConfig,
              selectedServices: visibleOrder,
              updatedAt: new Date().toISOString(),
            },
          }))
          return
        }
        updateGestaoPanelPreference('panel4', (preference) => ({
          ...preference,
          serviceOrder: visibleOrder,
        }))
        return
      }

      setCustomMatrices((previous) =>
        previous.map((matrix) =>
          matrix.id === activeMatrixId
            ? {
                ...matrix,
                selectedServices: visibleOrder,
                updatedAt: new Date().toISOString(),
              }
            : matrix,
        ),
      )
    },
    [activeMatrixId, defaultMatrixConfig, defaultMatrixKey, draggedMatrixService, matrixServices, updateGestaoPanelPreference],
  )

  const matrixFloors = useMemo(() => {
    if (activeMatrixId === 'none') return []
    const selectedServiceNames = new Set(matrixServices.map((service) => service.name))
    const availableFloorNames = new Set<string>()
    for (const activity of gestaoActivities) {
      if (
        matrixGroupSet.has(activityGroupName(activity)) &&
        selectedServiceNames.has(String(activity.servico_nome || '')) &&
        activity.pavimento_nome
      ) {
        availableFloorNames.add(String(activity.pavimento_nome))
      }
    }
    let result = gestaoData.floors.filter((floor) => availableFloorNames.has(floor.name))
    if (currentCustomMatrix && currentCustomMatrix.selectedFloors.length > 0) {
      const selectedSet = new Set(currentCustomMatrix.selectedFloors)
      result = result.filter((f) => selectedSet.has(f.name))
    }
    const direction = currentCustomMatrix?.floorSortOrder === 'desc' ? -1 : 1
    const configuredFloorOrder = new Map(currentFloorOrder.map((floor, index) => [floor, index]))
    return [...result].sort(
      (a, b) => {
        const aRank = configuredFloorOrder.get(a.name) ?? currentFloorOrder.length
        const bRank = configuredFloorOrder.get(b.name) ?? currentFloorOrder.length
        return direction * (aRank - bRank) || direction * compareNatural(a.name, b.name)
      },
    )
  }, [
    activeMatrixId,
    currentCustomMatrix,
    currentFloorOrder,
    gestaoActivities,
    gestaoData.floors,
    matrixGroupSet,
    matrixServices,
  ])

  const modalAvailableServices = useMemo(() => {
    const selectedGroups = new Set(modalSelectedGroups)
    return gestaoCatalog.services.filter((service) =>
      service.activities.some((activity) => selectedGroups.has(activityGroupName(activity))),
    )
  }, [gestaoCatalog.services, modalSelectedGroups])

  const modalAvailableFloors = useMemo(() => {
    const selectedGroups = new Set(modalSelectedGroups)
    const selectedServices = new Set(modalSelectedServices)
    const floorNames = new Set<string>()
    for (const activity of gestaoActivities) {
      if (
        selectedGroups.has(activityGroupName(activity)) &&
        selectedServices.has(String(activity.servico_nome || '')) &&
        activity.pavimento_nome
      ) {
        floorNames.add(String(activity.pavimento_nome))
      }
    }
    const configuredFloorOrder = new Map(currentFloorOrder.map((floor, index) => [floor, index]))
    return gestaoCatalog.floors
      .filter((floor) => floorNames.has(floor.name))
      .sort(
        (a, b) =>
          (configuredFloorOrder.get(a.name) ?? currentFloorOrder.length) -
            (configuredFloorOrder.get(b.name) ?? currentFloorOrder.length) ||
          compareNatural(a.name, b.name),
      )
  }, [
    currentFloorOrder,
    gestaoActivities,
    gestaoCatalog.floors,
    modalSelectedGroups,
    modalSelectedServices,
  ])

  function handleOpenCreateMatrix() {
    const groups = currentGroupOrder
    const services = Array.from(getAvailableServiceNames(groups))
    const floors = getAvailableFloorNames(groups, services)
    setEditingMatrixId(null)
    setModalMatrixName(`Matriz Personalizada ${projectCustomMatrices.length + 1}`)
    setModalSelectedGroups(groups)
    setModalSelectedServices(services)
    setModalSelectedFloors(currentFloorOrder.filter((floor) => floors.has(floor)))
    setModalFloorSortOrder('asc')
    setModalServiceSearch('')
    setModalFloorSearch('')
    setIsMatrixModalOpen(true)
  }

  function handleOpenEditMatrix(matrixId: string) {
    const target = matrixId === 'default'
      ? defaultMatrixConfig || {
          id: 'default',
          name: 'Matriz Padrão',
          projectId: selectedProject,
          selectedGroups: currentGroupOrder,
          selectedServices: matrixServices.map((service) => service.name),
          selectedFloors: matrixFloors.map((floor) => floor.name),
          floorSortOrder: 'asc' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : customMatrices.find((m) => m.id === matrixId)
    if (!target) return
    const groups = target.selectedGroups?.length ? target.selectedGroups : currentGroupOrder
    const availableServices = getAvailableServiceNames(groups)
    const services = (
      target.selectedServices.length > 0
        ? target.selectedServices
        : Array.from(availableServices)
    ).filter((service) => availableServices.has(service))
    const availableFloors = getAvailableFloorNames(groups, services)
    const floors = (
      target.selectedFloors.length > 0
        ? target.selectedFloors
        : currentFloorOrder.filter((floor) => availableFloors.has(floor))
    ).filter((floor) => availableFloors.has(floor))
    setEditingMatrixId(matrixId)
    setModalMatrixName(target.name)
    setModalSelectedGroups(groups)
    setModalSelectedServices(services)
    setModalSelectedFloors(floors)
    setModalFloorSortOrder(target.floorSortOrder || 'asc')
    setModalServiceSearch('')
    setModalFloorSearch('')
    setIsMatrixModalOpen(true)
  }

  function handleDuplicateMatrix(matrixId: string) {
    const target = customMatrices.find((m) => m.id === matrixId)
    if (!target) return
    const newId = `matrix_${Date.now()}`
    const duplicated: CustomMatrixConfig = {
      ...target,
      id: newId,
      name: `Cópia de ${target.name}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setCustomMatrices((prev) => [...prev, duplicated])
    setActiveMatrixId(newId)
  }

  function handleDeleteMatrix(matrixId: string) {
    const isDefault = matrixId === 'default'
    const label = isDefault ? 'a matriz padrão deste projeto' : 'esta matriz personalizada'
    if (confirm(`Tem certeza que deseja excluir ${label}?`)) {
      if (isDefault) {
        setDefaultMatrixConfigs((previous) => ({ ...previous, [defaultMatrixKey]: null }))
        setActiveMatrixId(projectCustomMatrices[0]?.id || 'none')
        return
      }
      setCustomMatrices((prev) => prev.filter((m) => m.id !== matrixId))
      if (activeMatrixId === matrixId) {
        const remainingMatrix = projectCustomMatrices.find((matrix) => matrix.id !== matrixId)
        setActiveMatrixId(isDefaultMatrixAvailable ? 'default' : remainingMatrix?.id || 'none')
      }
    }
  }

  function handleSaveMatrixModal() {
    if (!modalMatrixName.trim()) {
      alert('Informe um nome para a matriz.')
      return
    }
    if (modalSelectedGroups.length === 0) {
      alert('Selecione pelo menos um grupo para a matriz.')
      return
    }
    if (modalSelectedServices.length === 0) {
      alert('Selecione pelo menos um serviço para a matriz.')
      return
    }
    if (modalSelectedFloors.length === 0) {
      alert('Selecione pelo menos um pavimento para a matriz.')
      return
    }
    const now = new Date().toISOString()
    if (editingMatrixId === 'default') {
      setDefaultMatrixConfigs((previous) => ({
        ...previous,
        [defaultMatrixKey]: {
          id: 'default',
          name: modalMatrixName.trim(),
          projectId: selectedProject,
          selectedGroups: modalSelectedGroups,
          selectedServices: modalSelectedServices,
          selectedFloors: modalSelectedFloors,
          floorSortOrder: modalFloorSortOrder,
          createdAt: defaultMatrixConfig?.createdAt || now,
          updatedAt: now,
        },
      }))
    } else if (editingMatrixId) {
      setCustomMatrices((prev) =>
        prev.map((m) =>
          m.id === editingMatrixId
            ? {
                ...m,
                name: modalMatrixName.trim(),
                selectedGroups: modalSelectedGroups,
                selectedServices: modalSelectedServices,
                selectedFloors: modalSelectedFloors,
                floorSortOrder: modalFloorSortOrder,
                updatedAt: now,
              }
            : m,
        ),
      )
    } else {
      const newId = `matrix_${Date.now()}`
      const newMatrix: CustomMatrixConfig = {
        id: newId,
        name: modalMatrixName.trim(),
        projectId: selectedProject,
        selectedGroups: modalSelectedGroups,
        selectedServices: modalSelectedServices,
        selectedFloors: modalSelectedFloors,
        floorSortOrder: modalFloorSortOrder,
        createdAt: now,
        updatedAt: now,
      }
      setCustomMatrices((prev) => [...prev, newMatrix])
      setActiveMatrixId(newId)
    }
    setIsMatrixModalOpen(false)
  }

  function handleMoveService(serviceName: string, direction: 'up' | 'down') {
    const index = modalSelectedServices.indexOf(serviceName)
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= modalSelectedServices.length) return
    setModalSelectedServices((prev) => {
      const next = [...prev]
      const [removed] = next.splice(index, 1)
      next.splice(targetIndex, 0, removed)
      return next
    })
  }

  function getAvailableServiceNames(groups: string[]) {
    const selectedGroups = new Set(groups)
    return new Set(
      gestaoCatalog.services
        .filter((service) =>
          service.activities.some((activity) => selectedGroups.has(activityGroupName(activity))),
        )
        .map((service) => service.name),
    )
  }

  function getAvailableFloorNames(groups: string[], services: string[]) {
    const selectedGroups = new Set(groups)
    const selectedServices = new Set(services)
    const floors = new Set<string>()
    for (const activity of gestaoActivities) {
      if (
        selectedGroups.has(activityGroupName(activity)) &&
        selectedServices.has(String(activity.servico_nome || '')) &&
        activity.pavimento_nome
      ) {
        floors.add(String(activity.pavimento_nome))
      }
    }
    return floors
  }

  function handleToggleMatrixGroup(groupName: string) {
    const nextGroups = modalSelectedGroups.includes(groupName)
      ? modalSelectedGroups.filter((group) => group !== groupName)
      : [...modalSelectedGroups, groupName]
    const availableServices = getAvailableServiceNames(nextGroups)
    const nextServices = modalSelectedServices.filter((service) => availableServices.has(service))
    const availableFloors = getAvailableFloorNames(nextGroups, nextServices)
    setModalSelectedGroups(nextGroups)
    setModalSelectedServices(nextServices)
    setModalSelectedFloors((previous) => previous.filter((floor) => availableFloors.has(floor)))
  }

  function handleToggleAllGroups(select: boolean) {
    if (select) {
      setModalSelectedGroups(currentGroupOrder)
      return
    }
    setModalSelectedGroups([])
    setModalSelectedServices([])
    setModalSelectedFloors([])
  }

  function handleToggleService(serviceName: string) {
    const nextServices = modalSelectedServices.includes(serviceName)
      ? modalSelectedServices.filter((service) => service !== serviceName)
      : [...modalSelectedServices, serviceName]
    const availableFloors = getAvailableFloorNames(modalSelectedGroups, nextServices)
    setModalSelectedServices(nextServices)
    setModalSelectedFloors((previous) => previous.filter((floor) => availableFloors.has(floor)))
  }

  function handleToggleFloor(floorName: string) {
    setModalSelectedFloors((prev) =>
      prev.includes(floorName) ? prev.filter((f) => f !== floorName) : [...prev, floorName],
    )
  }

  function handleToggleAllServices(select: boolean) {
    if (select) {
      const allNames = modalAvailableServices.map((service) => service.name)
      setModalSelectedServices(allNames)
    } else {
      setModalSelectedServices([])
      setModalSelectedFloors([])
    }
  }

  function handleToggleAllFloors(select: boolean) {
    if (select) {
      const allNames = modalAvailableFloors.map((floor) => floor.name)
      setModalSelectedFloors(allNames)
    } else {
      setModalSelectedFloors([])
    }
  }

  async function handleCopyPanel5Table() {
    const lines = [
      ['SERVIÇO + PAVIMENTO', 'DURAÇÃO', 'DATA DE INÍCIO', 'DATA DE TÉRMINO'],
      ...panel5Rows.map((row) => [
        row.serviceFloor,
        row.duration ?? '',
        row.startDate,
        row.endDate,
      ]),
    ]
    try {
      await navigator.clipboard.writeText(lines.map((line) => line.join('\t')).join('\n'))
      setError('')
      setMessage(`${panel5Rows.length} linha(s) copiadas. Cole diretamente no Excel.`)
    } catch {
      setMessage('')
      setError('Não foi possível copiar automaticamente. Selecione as células da tabela e copie.')
    }
  }

  function handlePrint() {
    const source = document.querySelector('.gestao-print-source') as HTMLElement | null
    if (!source) {
      window.print()
      return
    }

    const printWindow = window.open('', '_blank', 'width=1440,height=900')
    if (!printWindow) {
      alert('O navegador bloqueou a nova janela. Permita pop-ups para abrir a visualização de impressão.')
      return
    }

    const stylesheetRules: string[] = []
    const fallbackStylesheets: string[] = []
    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        const rules = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n')
        if (rules) stylesheetRules.push(rules)
      } catch {
        if (sheet.href) fallbackStylesheets.push(`<link rel="stylesheet" href="${new URL(sheet.href, document.baseURI).href}" />`)
      }
    })
    const styles = stylesheetRules.length > 0
      ? `<style id="app-print-styles">${stylesheetRules.join('\n')}</style>${fallbackStylesheets.join('')}`
      : Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map((node) => node.tagName === 'LINK'
          ? `<link rel="stylesheet" href="${new URL((node as HTMLLinkElement).href, document.baseURI).href}" />`
          : node.outerHTML)
        .join('')
    const baseHref = document.baseURI
    const defaultPrintOrientation = gestaoPanelTab === 'matrix' ? 'landscape' : 'portrait'
    printWindow.document.open()
    printWindow.document.write(`<!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <base href="${baseHref}" />
          <title>Gestão à Vista — Visualização de impressão</title>
          ${styles}
          <style id="print-page-style">
            @page { size: A4 ${defaultPrintOrientation}; margin: 6mm; }
          </style>
          <style>
            :root { color-scheme: light; }
            html, body { margin: 0; min-height: 100%; background: #f1f5f3; }
            body { font-family: inherit; color: #173f38; }
            .print-preview-toolbar {
              position: sticky;
              top: 0;
              z-index: 100;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 16px;
              flex-wrap: wrap;
              padding: 10px 16px;
              background: #ffffff;
              border-bottom: 1px solid #cbdcd7;
              box-shadow: 0 2px 8px rgba(23, 63, 56, 0.1);
            }
            .print-preview-toolbar strong { font-size: 14px; }
            .print-preview-controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
            .print-preview-controls label { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; white-space: nowrap; }
            .print-preview-control-label { color: #173f38; }
            .print-preview-controls input[type="range"] { width: 140px; accent-color: #174f46; cursor: pointer; }
            .print-column-resizer { position: absolute; top: 0; right: -4px; width: 8px; height: 100%; cursor: col-resize; z-index: 20; }
            .print-column-resizer:hover { background: rgba(23, 79, 70, 0.18); }
            body.print-column-resizing, body.print-column-resizing * { cursor: col-resize !important; user-select: none !important; }
            .print-orientation-toggle { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid #b8ccc6; border-radius: 6px; background: #f1f6f4; }
            .print-orientation-toggle button { border: 0; border-radius: 4px; padding: 5px 8px; background: transparent; color: #173f38; font-size: 10px; font-weight: 700; cursor: pointer; }
            .print-orientation-toggle button.active { background: #173f38; color: #ffffff; }
            .print-preview-actions { display: flex; align-items: center; gap: 7px; }
            .print-preview-actions button { border: 1px solid #b8ccc6; border-radius: 6px; padding: 7px 11px; background: #ffffff; color: #173f38; font-size: 11px; font-weight: 700; cursor: pointer; }
            .print-preview-actions button.primary { border-color: #173f38; background: #173f38; color: #ffffff; }
            .print-preview-content { padding: 20px; overflow: auto; }
            .print-preview-content .gestao-print-source { width: 100%; min-width: 0; margin: 0 auto; overflow: visible; }
            .gestao-print-source .gestao-panel-data-filter,
            .gestao-print-source .gestao-service-drag svg,
            .gestao-print-source .panel5-service-column,
            .gestao-print-source .panel5-table-actions button { display: none !important; }
            .gestao-print-source .a4-sheet-body,
            .gestao-print-source .panel5-table-scroll { overflow: visible; }
            .gestao-print-source .panel5-export-grid { display: block; }
            .gestao-print-source th { position: relative; }
            .gestao-print-source .gestao-table,
            .gestao-print-source .panel5-export-table { table-layout: fixed; width: max-content; min-width: 0; }
            .gestao-print-source .gestao-table th:not(.service-col),
            .gestao-print-source .gestao-table td:not(.service-col),
            .gestao-print-source .panel5-export-table th:not(:first-child),
            .gestao-print-source .panel5-export-table td:not(:first-child) {
              width: var(--print-column-width, 110px);
              min-width: var(--print-column-width, 110px);
              max-width: var(--print-column-width, 110px);
              box-sizing: border-box;
            }
            .gestao-print-source .gestao-table th.service-col,
            .gestao-print-source .gestao-table td.service-col,
            .gestao-print-source .panel5-export-table th:first-child,
            .gestao-print-source .panel5-export-table td:first-child {
              width: var(--print-first-column-width, 260px);
              min-width: var(--print-first-column-width, 260px);
              max-width: var(--print-first-column-width, 260px);
              box-sizing: border-box;
              white-space: normal;
              overflow-wrap: anywhere;
            }
            .gestao-print-source .gestao-table td.service-col .gestao-service-drag {
              display: flex;
              min-width: 0;
              max-width: 100%;
              white-space: normal;
              overflow-wrap: anywhere;
            }
            .matrix-print-source .gestao-matrix-container { max-height: none; overflow: visible; }
            .matrix-print-source .gestao-matrix-table { table-layout: fixed; width: max-content; min-width: 0; }
            .matrix-print-source .gestao-matrix-table th:not(.matrix-service-th),
            .matrix-print-source .gestao-matrix-table td.matrix-cell {
              width: var(--matrix-column-width, 110px);
              min-width: var(--matrix-column-width, 110px);
              max-width: var(--matrix-column-width, 110px);
              box-sizing: border-box;
            }
            .matrix-print-source .gestao-matrix-table th.matrix-service-th,
            .matrix-print-source .gestao-matrix-table td.matrix-service-td {
              width: var(--matrix-service-column-width, 260px);
              min-width: var(--matrix-service-column-width, 260px);
              max-width: var(--matrix-service-column-width, 260px);
              box-sizing: border-box;
              white-space: normal;
              overflow-wrap: anywhere;
            }
            .matrix-print-source .gestao-matrix-table td.matrix-service-td .gestao-service-drag {
              display: flex;
              min-width: 0;
              max-width: 100%;
              white-space: normal;
              overflow-wrap: anywhere;
            }
            .matrix-print-source .matrix-dates { white-space: normal; overflow-wrap: anywhere; }
            @media print {
              html, body { background: #ffffff !important; }
              .print-preview-toolbar { display: none !important; }
              .print-column-resizer { display: none !important; }
              .print-preview-content { padding: 0 !important; overflow: visible !important; }
              .print-preview-content .gestao-print-source { width: 100% !important; min-width: 0 !important; box-shadow: none !important; border: 1px solid #888888 !important; }
              .gestao-print-source .a4-sheet-header {
                background: linear-gradient(135deg, #173f38 0%, #0d2823 100%) !important;
                color: #ffffff !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .gestao-print-source .a4-sheet-footer {
                background: #f7faf9 !important;
                color: #697975 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .gestao-print-source .gestao-table,
              .gestao-print-source .panel5-export-table { width: max-content !important; min-width: 0 !important; }
              .matrix-print-source .gestao-matrix-container { overflow: visible !important; max-height: none !important; }
              .matrix-print-source .gestao-matrix-table { width: max-content !important; min-width: 0 !important; }
            }
          </style>
        </head>
        <body>
          <div class="print-preview-toolbar">
            <strong>Gestão à Vista · Visualização de impressão</strong>
            <div class="print-preview-controls">
              <label title="Ajustar zoom da impressão"><span class="print-preview-control-label">Zoom</span><input id="zoom-input" aria-label="Zoom da impressão" type="range" min="40" max="140" step="5" value="100" /></label>
              <label title="Ajustar largura das colunas"><span class="print-preview-control-label">Colunas</span><input id="column-input" aria-label="Largura das colunas" type="range" min="60" max="220" step="5" value="110" /></label>
              <label title="Ajustar largura da primeira coluna"><span class="print-preview-control-label">Primeira coluna</span><input id="service-input" aria-label="Largura da primeira coluna" type="range" min="160" max="520" step="10" value="260" /></label>
            </div>
            <div class="print-orientation-toggle" role="group" aria-label="Orientação da página">
              <button id="orientation-portrait" class="${defaultPrintOrientation === 'portrait' ? 'active' : ''}" type="button">Retrato</button>
              <button id="orientation-landscape" class="${defaultPrintOrientation === 'landscape' ? 'active' : ''}" type="button">Paisagem</button>
            </div>
            <div class="print-preview-actions">
              <button id="reset-widths" type="button">Restaurar larguras</button>
              <button id="close-preview" type="button">Fechar janela</button>
              <button id="print-now" class="primary" type="button">Imprimir / PDF</button>
            </div>
          </div>
          <main class="print-preview-content">${source.outerHTML}</main>
        </body>
      </html>`)
    printWindow.document.close()

    const printSource = printWindow.document.querySelector('.gestao-print-source') as HTMLElement | null
    const zoomInput = printWindow.document.getElementById('zoom-input') as HTMLInputElement | null
    const columnInput = printWindow.document.getElementById('column-input') as HTMLInputElement | null
    const serviceInput = printWindow.document.getElementById('service-input') as HTMLInputElement | null
    const sourceTables = Array.from(source.querySelectorAll('table')) as HTMLTableElement[]
    const printTableSettings = printSource
      ? (Array.from(printSource.querySelectorAll('table')) as HTMLTableElement[]).map((table, tableIndex) => {
          const columnCount = Math.max(
            1,
            ...Array.from(table.rows).map((row) =>
              Array.from(row.cells).reduce((total, cell) => total + Math.max(1, cell.colSpan), 0),
            ),
          )
          const colgroup = printWindow.document.createElement('colgroup')
          const columns = Array.from({ length: columnCount }, () => printWindow.document.createElement('col'))
          columns.forEach((column) => colgroup.appendChild(column))
          table.insertBefore(colgroup, table.firstChild)
          table.style.tableLayout = 'fixed'

          const cellColumns = new Map<HTMLTableCellElement, number>()
          const occupiedUntil = new Map<number, number>()
          Array.from(table.rows).forEach((row, rowIndex) => {
            let columnIndex = 0
            Array.from(row.cells).forEach((cell) => {
              while ((occupiedUntil.get(columnIndex) ?? -1) >= rowIndex) columnIndex += 1
              const columnSpan = Math.max(1, cell.colSpan)
              cellColumns.set(cell, columnIndex)
              for (let offset = 0; offset < columnSpan; offset += 1) {
                occupiedUntil.set(columnIndex + offset, rowIndex + Math.max(1, cell.rowSpan) - 1)
              }
              columnIndex += columnSpan
            })
          })

          const measuredWidths = Array<number | null>(columnCount).fill(null)
          const sourceTable = sourceTables[tableIndex]
          const sourceHeaderRows = sourceTable?.tHead ? Array.from(sourceTable.tHead.rows) : []
          sourceHeaderRows.forEach((row) => {
            Array.from(row.cells).forEach((cell) => {
              const columnSpan = Math.max(1, cell.colSpan)
              const width = cell.getBoundingClientRect().width / columnSpan
              if (!Number.isFinite(width) || width <= 0) return
              let startColumn = 0
              while (startColumn < columnCount && measuredWidths[startColumn] !== null) startColumn += 1
              if (startColumn >= columnCount) return
              for (let offset = 0; offset < columnSpan && startColumn + offset < columnCount; offset += 1) {
                measuredWidths[startColumn + offset] = width
              }
            })
          })

          const fallbackWidths = measuredWidths.map((width, columnIndex) => {
            if (width !== null) return width
            const cell = table.tHead?.rows[0]?.cells[columnIndex]
            const cellWidth = cell?.getBoundingClientRect().width
            return Number.isFinite(cellWidth) && cellWidth && cellWidth > 0 ? cellWidth : columnIndex === 0 ? 260 : 110
          })

          return {
            table,
            columns,
            baseWidths: fallbackWidths,
            widths: Array<number | null>(columnCount).fill(null),
            cellColumns,
          }
        })
      : []

    const getPrintColumnWidth = (columnIndex: number, widths: Array<number | null>) => {
      const globalWidth = Number(columnInput?.value || 110)
      const firstColumnWidth = Number(serviceInput?.value || 260)
      const settings = printTableSettings.find((item) => item.widths === widths)
      const baseWidth = settings?.baseWidths[columnIndex]
      return widths[columnIndex] ?? baseWidth ?? (columnIndex === 0 ? firstColumnWidth : globalWidth)
    }

    const applyPrintWidths = () => {
      printTableSettings.forEach((settings) => {
        settings.columns.forEach((column, columnIndex) => {
          column.style.setProperty('width', `${getPrintColumnWidth(columnIndex, settings.widths)}px`, 'important')
        })
        Array.from(settings.table.rows).forEach((row) => {
          Array.from(row.cells).forEach((cell) => {
            const startColumn = settings.cellColumns.get(cell)
            if (startColumn === undefined) return
            const columnSpan = Math.max(1, cell.colSpan)
            const cellWidth = Array.from({ length: columnSpan }, (_, offset) =>
              getPrintColumnWidth(startColumn + offset, settings.widths),
            ).reduce((total, width) => total + width, 0)
            cell.style.setProperty('width', `${cellWidth}px`, 'important')
            cell.style.setProperty('min-width', `${cellWidth}px`, 'important')
            cell.style.setProperty('max-width', `${cellWidth}px`, 'important')
          })
        })
      })
    }

    const addColumnResizeHandle = (
      settings: (typeof printTableSettings)[number],
      cell: HTMLTableCellElement,
      columnIndex: number,
    ) => {
      if (cell.querySelector('.print-column-resizer')) return
      const handle = printWindow.document.createElement('span')
      handle.className = 'print-column-resizer'
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-label', 'Ajustar largura da coluna')
      handle.tabIndex = 0
      handle.title = 'Arraste para ajustar a largura da coluna'
      const changeWidth = (delta: number) => {
        const currentWidth = getPrintColumnWidth(columnIndex, settings.widths)
        const minimum = columnIndex === 0 ? 140 : 50
        settings.widths[columnIndex] = Math.max(minimum, Math.min(800, currentWidth + delta))
        applyPrintWidths()
      }
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = getPrintColumnWidth(columnIndex, settings.widths)
        printWindow.document.body.classList.add('print-column-resizing')
        const handleMove = (moveEvent: PointerEvent) => {
          const minimum = columnIndex === 0 ? 140 : 50
          settings.widths[columnIndex] = Math.max(minimum, Math.min(800, startWidth + moveEvent.clientX - startX))
          applyPrintWidths()
        }
        const handleUp = () => {
          printWindow.document.body.classList.remove('print-column-resizing')
          printWindow.removeEventListener('pointermove', handleMove)
          printWindow.removeEventListener('pointerup', handleUp)
        }
        printWindow.addEventListener('pointermove', handleMove)
        printWindow.addEventListener('pointerup', handleUp)
      })
      handle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        changeWidth(event.key === 'ArrowRight' ? 10 : -10)
      })
      cell.appendChild(handle)
    }

    printTableSettings.forEach((settings) => {
      const headerRows = settings.table.tHead ? Array.from(settings.table.tHead.rows) : []
      headerRows.forEach((row) => {
        Array.from(row.cells).forEach((cell) => {
          if (cell.colSpan !== 1) return
          const columnIndex = settings.cellColumns.get(cell)
          if (columnIndex === undefined) return
          addColumnResizeHandle(settings, cell, columnIndex)
        })
      })
    })

    const syncPrintSettings = () => {
      const zoom = Number(zoomInput?.value || 100)
      const width = Number(columnInput?.value || 110)
      const serviceWidth = Number(serviceInput?.value || 260)
      printSource?.style.setProperty('--print-column-width', `${width}px`)
      printSource?.style.setProperty('--print-first-column-width', `${serviceWidth}px`)
      printSource?.style.setProperty('--matrix-column-width', `${width}px`)
      printSource?.style.setProperty('--matrix-service-column-width', `${serviceWidth}px`)
      printSource?.style.setProperty('zoom', String(zoom / 100), 'important')
      applyPrintWidths()
    }

    const measuredServiceWidth = printTableSettings[0]?.widths[0]
    const measuredColumnWidths = printTableSettings
      .flatMap((settings) => settings.widths.slice(1).filter((width): width is number => width !== null && width > 0))
    if (columnInput && measuredColumnWidths.length > 0) {
      const averageWidth = measuredColumnWidths.reduce((total, width) => total + width, 0) / measuredColumnWidths.length
      columnInput.value = String(Math.max(60, Math.min(220, Math.round(averageWidth / 5) * 5)))
    }
    if (serviceInput && measuredServiceWidth && measuredServiceWidth > 0) {
      serviceInput.value = String(Math.max(160, Math.min(520, Math.round(measuredServiceWidth / 10) * 10)))
    }
    const pageStyle = printWindow.document.getElementById('print-page-style')
    const orientationPortraitButton = printWindow.document.getElementById('orientation-portrait')
    const orientationLandscapeButton = printWindow.document.getElementById('orientation-landscape')
    const setPrintOrientation = (orientation: 'portrait' | 'landscape') => {
      if (pageStyle) pageStyle.textContent = `@page { size: A4 ${orientation}; margin: 6mm; }`
      orientationPortraitButton?.classList.toggle('active', orientation === 'portrait')
      orientationLandscapeButton?.classList.toggle('active', orientation === 'landscape')
    }
    zoomInput?.addEventListener('input', syncPrintSettings)
    columnInput?.addEventListener('input', () => {
      const width = Number(columnInput.value || 110)
      printTableSettings.forEach((settings) => {
        settings.widths.forEach((_, columnIndex) => {
          if (columnIndex > 0) settings.widths[columnIndex] = width
        })
      })
      syncPrintSettings()
    })
    serviceInput?.addEventListener('input', () => {
      const width = Number(serviceInput.value || 260)
      printTableSettings.forEach((settings) => {
        if (settings.widths.length > 0) settings.widths[0] = width
      })
      syncPrintSettings()
    })
    orientationPortraitButton?.addEventListener('click', () => setPrintOrientation('portrait'))
    orientationLandscapeButton?.addEventListener('click', () => setPrintOrientation('landscape'))
    printWindow.document.getElementById('reset-widths')?.addEventListener('click', () => {
      printTableSettings.forEach((settings) => settings.widths.fill(null))
      syncPrintSettings()
    })
    printWindow.addEventListener('beforeprint', syncPrintSettings)
    printWindow.document.getElementById('print-now')?.addEventListener('click', () => printWindow.print())
    printWindow.document.getElementById('close-preview')?.addEventListener('click', () => printWindow.close())
    syncPrintSettings()
    printWindow.focus()
  }

  const isMilestoneDashboard = activeView === 'gestao_a_vista' && gestaoPanelTab === 'milestones'
  const activeTab = isMilestoneDashboard
    ? { label: 'Dashboard de Marcos', icon: Flag }
    : activeView === 'curvas'
      ? { label: 'Curvas', icon: TrendingUp }
      : tabs.find((tab) => tab.key === activeView) || tabs[0]
  const currentColumns =
    activeView === 'activities'
      ? activityColumns[activityMode]
      : activeView === 'budgets'
        ? budgetColumns[budgetMode]
        : activeView === 'dashboard'
          ? dashboardColumns[dashboardMode]
          : activeView === 'curvas'
            ? []
            : columns[activeView]

  function changeView(view: DataView) {
    if (view !== 'gestao_a_vista' && view !== 'curvas') lastDataView.current = view
    setActiveView(view)
    setPage(0)
    setSearch('')
  }

  function changeProject(projectId: string) {
    setSelectedProject(projectId)
    setPage(0)
  }

  function changePageSize(nextSize: number) {
    setPageSize(nextSize)
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
          <button
            className="secondary-button theme-toggle"
            type="button"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            title={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="secondary-button" type="button" onClick={reload} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Recarregar
          </button>
          <button
            className={`header-view-button ${activeView === 'curvas' ? 'active' : ''}`}
            type="button"
            onClick={() => changeView('curvas')}
          >
            <TrendingUp size={16} />
            Curvas
          </button>
          <button
            className={`header-view-button ${activeView === 'gestao_a_vista' && !isMilestoneDashboard ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setGestaoPanelTab('panel1')
              changeView('gestao_a_vista')
            }}
          >
            <Presentation size={16} />
            Gestão à Vista
          </button>
          <button
            className={`header-view-button ${isMilestoneDashboard ? 'active' : ''}`}
            type="button"
            onClick={() => {
              setGestaoPanelTab('milestones')
              changeView('gestao_a_vista')
            }}
          >
            <Flag size={16} />
            Dashboard de Marcos
          </button>
          <button
            className={`header-view-button ${activeView !== 'gestao_a_vista' && activeView !== 'curvas' ? 'active' : ''}`}
            type="button"
            onClick={() => changeView(lastDataView.current)}
          >
            <Database size={16} />
            Dados Prevision
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

      {activeView !== 'curvas' && (
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
      )}

      {activeView !== 'gestao_a_vista' && activeView !== 'curvas' && (
        <nav className="data-tabs" aria-label="Dados Prevision">
          {tabs
            .filter((tab) => tab.key !== 'gestao_a_vista')
            .map((tab) => {
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
      )}

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
                onClick={() => {
                  setActivityMode('planning')
                  setPage(0)
                }}
              >
                Planejamento
              </button>
              <button
                type="button"
                className={activityMode === 'jobs' ? 'active' : ''}
                onClick={() => {
                  setActivityMode('jobs')
                  setPage(0)
                }}
              >
                Microserviços
              </button>
              <button
                type="button"
                className={activityMode === 'progress' ? 'active' : ''}
                onClick={() => {
                  setActivityMode('progress')
                  setPage(0)
                }}
              >
                Avanço atual
              </button>
              <button
                type="button"
                className={activityMode === 'measurements' ? 'active' : ''}
                onClick={() => {
                  setActivityMode('measurements')
                  setPage(0)
                }}
              >
                Histórico de medições
              </button>
              <button
                type="button"
                className={activityMode === 'resources' ? 'active' : ''}
                onClick={() => {
                  setActivityMode('resources')
                  setPage(0)
                }}
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
              <button
                type="button"
                className={budgetMode === 'weights' ? 'active' : ''}
                onClick={() => {
                  setBudgetMode('weights')
                  setPage(0)
                }}
              >
                Vínculos com Cronograma (Pesos)
              </button>
            </div>
          )}
          {activeView === 'dashboard' && (
            <div className="activity-modes" aria-label="Detalhamento do dashboard">
              {[
                ['general', 'Geral'],
                ['weekly', 'Curva semanal'],
                ['monthly', 'Curva mensal'],
                ['cff', 'CFF'],
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
          {activeView === 'dashboard' && dashboardMode === 'cff' ? (
            <div className="cff-toolbar">
              <div className="cff-toolbar-copy">
                <p>Cronograma Físico-Financeiro</p>
                <h3>{cffBudgetLabel}</h3>
                <span>
                  {cffGranularity === 'weekly' && cffWeekFilter !== 'all'
                    ? cffWeekOptions.find((w) => w.data === cffWeekFilter)?.label ||
                      (cffReferenceDate ? `Semana com corte em ${formatDate(cffReferenceDate)}` : '-')
                    : cffReferenceDate
                      ? `Referência ${formatDate(cffReferenceDate)}`
                      : '-'}
                </span>
              </div>
              <div className="cff-toolbar-actions">
                <label className="search-field cff-search-field">
                  <span>Buscar</span>
                  <Search size={16} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar atividade, código ou valor"
                  />
                </label>
                <label className="cff-select-field">
                  <span>Orçamento</span>
                  <select value={cffBudgetFilter} onChange={(event) => setCffBudgetFilter(event.target.value)}>
                    <option value="all">Todos</option>
                    {cffSummaryBudgetNames.map((budget) => (
                      <option key={budget} value={budget}>
                        {budget}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cff-select-field">
                  <span>Nível</span>
                  <select value={cffLevelFilter} onChange={(event) => setCffLevelFilter(event.target.value)}>
                    <option value="all">Todos</option>
                    {cffLevelOptions.map((level) => (
                      <option key={level} value={`level${level}`}>
                        Nível {level}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="cff-toggle-group" role="group" aria-label="Granularidade">
                  <button
                    type="button"
                    className={cffGranularity === 'weekly' ? 'active' : ''}
                    onClick={() => setCffGranularity('weekly')}
                  >
                    Semanal
                  </button>
                  <button
                    type="button"
                    className={cffGranularity === 'monthly' ? 'active' : ''}
                    onClick={() => setCffGranularity('monthly')}
                  >
                    Mensal
                  </button>
                </div>
                {cffGranularity === 'weekly' ? (
                  <label className="cff-select-field">
                    <span>Semana</span>
                    <select
                      value={cffWeekFilter}
                      onChange={(event) => setCffWeekFilter(event.target.value)}
                    >
                      <option value="all">Todas as semanas (Total)</option>
                      {cffWeekOptions.map((week) => (
                        <option key={week.data} value={week.data}>
                          {week.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="cff-select-field">
                    <span>Mês</span>
                    <select value={cffMonthFilter} onChange={(event) => setCffMonthFilter(event.target.value)}>
                      <option value="all">Todos os meses (Total)</option>
                      {cffMonthOptions.map((month) => (
                        <option key={month} value={month}>
                          {formatMonthLabel(month)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="cff-toggle-group" role="group" aria-label="Controles do CFF">
                  <button
                    type="button"
                    className={cffDisplayMode === 'percentual' ? 'active' : ''}
                    onClick={() => setCffDisplayMode('percentual')}
                  >
                    <Percent size={14} />
                    Percentual (%)
                  </button>
                  <button
                    type="button"
                    className={cffDisplayMode === 'acumulada' ? 'active' : ''}
                    onClick={() => setCffDisplayMode('acumulada')}
                  >
                    <ChartNoAxesCombined size={14} />
                    Acumulada
                  </button>
                  <button
                    type="button"
                    className={cffDenseMode ? 'active' : ''}
                    title="Modo compacto"
                    aria-label="Modo compacto"
                    onClick={() => setCffDenseMode((current) => !current)}
                  >
                    <Settings2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
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
              {activeView === 'gestao_a_vista' && gestaoPanelTab !== 'milestones' && currentGroupOrder.length > 0 && (
                <label>
                  <span>Torre / Grupo</span>
                  <select value={gestaoGroup} onChange={(event) => setGestaoGroup(event.target.value)}>
                    <option value="all">Todos os grupos ({currentGroupOrder.length})</option>
                    {currentGroupOrder.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {activeView === 'gestao_a_vista' && gestaoPanelTab !== 'milestones' && (
                <label>
                  <span>Mês de Referência (M0)</span>
                  <select value={gestaoMonth} onChange={(event) => setGestaoMonth(event.target.value)}>
                    {gestaoMonthOptions.map((month) => (
                      <option key={month} value={month}>
                        {formatMonthLabel(month)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {activeView !== 'curvas' && <label className="search-field">
                <span>Buscar</span>
                <Search size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={
                    activeView === 'gestao_a_vista'
                      ? gestaoPanelTab === 'milestones'
                        ? 'Filtrar projeto ou marco'
                        : 'Filtrar serviço ou pavimento'
                      : 'Buscar nesta página'
                  }
                />
              </label>}
            </div>
          )}
        </div>

        {(message || error) && (
          <div className={`feedback ${error ? 'error' : 'success'}`}>{error || message}</div>
        )}

        <div className={`table-panel ${activeView === 'dashboard' && dashboardMode === 'cff' ? 'cff-panel' : activeView === 'gestao_a_vista' ? 'gestao-panel' : ''}`} aria-live="polite">
          {loading ? (
            <div className="state-message">
              <RefreshCw size={20} className="spin" />
              Carregando dados
            </div>
          ) : activeView === 'curvas' ? (
            <CurvasView
              projectId={selectedProject}
              projectName={projects.find((project) => project.id_prevision === selectedProject)?.nome_projeto || ''}
              records={records}
              baselineCurves={curveBaselines}
              loading={loading}
            />
          ) : activeView === 'gestao_a_vista' ? (
            <div className="gestao-vista-wrapper">
              {/* PANEL SUB-TABS NAVIGATION & A4 PRINT BAR */}
              {gestaoPanelTab !== 'milestones' && (
                <div className="gestao-panel-tabs">
                <button
                  type="button"
                  className={`gestao-panel-tab-btn ${gestaoPanelTab === 'panel1' ? 'active' : ''}`}
                  onClick={() => setGestaoPanelTab('panel1')}
                >
                  <History size={14} />
                  <span>Painel 1: Meses Anteriores</span>
                </button>

                <button
                  type="button"
                  className={`gestao-panel-tab-btn ${gestaoPanelTab === 'panel2' ? 'active' : ''}`}
                  onClick={() => setGestaoPanelTab('panel2')}
                >
                  <CalendarCheck size={14} />
                  <span>Painel 2: Mês Vigente</span>
                </button>

                <button
                  type="button"
                  className={`gestao-panel-tab-btn ${gestaoPanelTab === 'panel3' ? 'active' : ''}`}
                  onClick={() => setGestaoPanelTab('panel3')}
                >
                  <TrendingUp size={14} />
                  <span>Painel 3: Próximos Meses</span>
                </button>

                <button
                  type="button"
                  className={`gestao-panel-tab-btn ${gestaoPanelTab === 'matrix' ? 'active' : ''}`}
                  onClick={() => setGestaoPanelTab('matrix')}
                >
                  <FileSpreadsheet size={14} />
                  <span>Painel 4: Escadinha</span>
                </button>

                <button
                  type="button"
                  className={`gestao-panel-tab-btn ${gestaoPanelTab === 'panel5' ? 'active' : ''}`}
                  onClick={() => setGestaoPanelTab('panel5')}
                >
                  <ListChecks size={14} />
                  <span>Painel 5: Tabela de Serviços</span>
                </button>

                <div className="gestao-top-actions">
                  <button
                    type="button"
                    className={`matrix-btn ${a4LayoutMode ? 'btn-primary' : ''}`}
                    onClick={() => setA4LayoutMode((prev) => !prev)}
                    title={a4LayoutMode ? 'Alternar para Modo Fluido' : 'Alternar para Proporção Folha A4 Paisagem'}
                  >
                    <Maximize2 size={13} />
                    <span>{a4LayoutMode ? 'Folha A4 Paisagem' : 'Modo Fluido'}</span>
                  </button>

                  <button
                    type="button"
                    className="matrix-btn btn-primary"
                    onClick={handlePrint}
                    title="Abrir o painel ativo em uma nova janela para impressão"
                  >
                    <Printer size={13} />
                    <span>Imprimir / PDF</span>
                  </button>
                  <button
                    type="button"
                    className="matrix-btn"
                    onClick={handleOpenGroupOrderModal}
                    title="Configurações da Gestão à Vista"
                  >
                    <Settings2 size={14} />
                    <span>Configurações</span>
                  </button>
                </div>
                </div>
              )}

              {gestaoPanelTab === 'milestones' && (
                <div className="milestone-dashboard">
                  <section className="milestone-chart-card">
                    <div className="milestone-dashboard-header">
                      <div>
                        <h3>Marcos distribuídos por mês</h3>
                        <p>
                          Quantidade de marcos entre{' '}
                          {formatDate(milestoneDashboard.windowStart.toISOString())} e{' '}
                          {formatDate(milestoneDashboard.windowEnd.toISOString())}.
                        </p>
                      </div>
                      <div className="milestone-total-card">
                        <span>Marcos no período</span>
                        <strong>{milestoneDashboard.totalInWindow}</strong>
                      </div>
                    </div>

                    {milestoneDashboard.totalInWindow === 0 ? (
                      <div className="milestone-empty-state">
                        Nenhum marco encontrado nesta janela de 17 meses.
                      </div>
                    ) : (
                      <>
                        <div className="milestone-chart-scroll">
                          <div className="milestone-chart-bars" role="img" aria-label="Marcos distribuídos por mês">
                            {milestoneDashboard.months.map((month) => (
                              <div
                                key={month.key}
                                className={`milestone-month-column ${month.isCurrent ? 'current' : ''}`}
                              >
                                <div className="milestone-month-total">
                                  {month.total > 0 ? month.total : ''}
                                </div>
                                <div className="milestone-bar-stack">
                                  {month.segments.map((segment) => (
                                    <div
                                      key={segment.name}
                                      className="milestone-bar-segment"
                                      style={{
                                        height: `${Math.max(
                                          4,
                                          (segment.count / milestoneDashboard.maxMonthTotal) * 190,
                                        )}px`,
                                        backgroundColor: segment.color,
                                      }}
                                      title={`${month.label} · ${segment.name}: ${segment.count}`}
                                    >
                                      {segment.count}
                                    </div>
                                  ))}
                                </div>
                                <span className="milestone-month-label">{month.label}</span>
                                {month.isCurrent && <small>Hoje</small>}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="milestone-legend">
                          {milestoneDashboard.chartMilestoneNames.map((name) => (
                            <span key={name}>
                              <i style={{ backgroundColor: milestoneDashboard.colorByName.get(name) }} />
                              {name}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </section>

                  <section className="milestone-table-card">
                    <div className="milestone-table-heading">
                      <div>
                        <h3>Datas dos marcos por projeto</h3>
                        <p>Os marcos são apresentados em colunas e suas datas em cada projeto.</p>
                      </div>
                      <span>{milestoneDashboard.projectRows.length} projeto(s)</span>
                    </div>

                    <div className="milestone-table-scroll">
                      <table className="milestone-dashboard-table">
                        <thead>
                          <tr>
                            <th className="milestone-project-column">Projeto</th>
                            {milestoneDashboard.milestoneNames.map((name) => (
                              <th key={name}>
                                <span className="milestone-column-title">
                                  <i style={{ backgroundColor: milestoneDashboard.colorByName.get(name) }} />
                                  {name}
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {milestoneDashboard.projectRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={milestoneDashboard.milestoneNames.length + 1}
                                className="milestone-empty-cell"
                              >
                                Nenhum marco encontrado para o filtro atual.
                              </td>
                            </tr>
                          ) : (
                            milestoneDashboard.projectRows.map((project) => (
                              <tr key={project.projectId}>
                                <td className="milestone-project-column">
                                  <strong>{project.projectName}</strong>
                                </td>
                                {milestoneDashboard.milestoneNames.map((name) => {
                                  const dates = project.datesByMilestone.get(name) || []
                                  return (
                                    <td key={name}>
                                      {dates.length === 0 ? (
                                        <span className="milestone-no-date">—</span>
                                      ) : (
                                        dates.map((date) => (
                                          <span key={date} className="milestone-date-value">
                                            {formatDate(date)}
                                          </span>
                                        ))
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* SUB-ABA: PAINEL 1 (MESES ANTERIORES)                 */}
              {/* ---------------------------------------------------- */}
              {gestaoPanelTab === 'panel1' && (
                <div className={a4LayoutMode ? 'a4-landscape-container' : ''}>
                  <div className={`${a4LayoutMode ? 'a4-landscape-sheet' : 'gestao-card'} gestao-print-source`}>
                    <div className="a4-sheet-header">
                      <div className="a4-sheet-brand">
                        <h3 className="a4-sheet-title">PAINEL 1: ANDAMENTO MESES ANTERIORES</h3>
                        <span className="a4-sheet-subtitle">
                          Histórico Previsto vs. Realizado dos últimos 3 meses fechados ({gestaoData.mMinus3?.label} a {gestaoData.mMinus1?.label})
                        </span>
                        <label className="gestao-panel-data-filter">
                          <input
                            type="checkbox"
                            checked={currentGestaoPanelPreferences.panel1.onlyWithData}
                            onChange={(event) =>
                              updateGestaoPanelPreference('panel1', (preference) => ({
                                ...preference,
                                onlyWithData: event.target.checked,
                              }))
                            }
                          />
                          <Flag size={12} />
                          Somente serviços com quantidade
                        </label>
                      </div>
                      <div className="a4-sheet-meta">
                        <div className="a4-sheet-meta-item">
                          <strong>{projects.find((p) => p.id_prevision === selectedProject)?.nome_projeto || 'Todas as Obras'}</strong>
                          <small>{gestaoGroup !== 'all' ? gestaoGroup : 'Todas as Torres'}</small>
                        </div>
                        <div className="a4-sheet-meta-item">
                          <strong>Mês Ref: {gestaoData.m0?.label}</strong>
                          <small>{new Date().toLocaleDateString('pt-BR')}</small>
                        </div>
                      </div>
                    </div>

                    <div className="a4-sheet-body">
                      <table className="gestao-table">
                        <thead>
                          <tr>
                            <th className="service-col" rowSpan={2}>
                              Serviço
                            </th>
                            <th colSpan={2}>
                              <div>{gestaoData.mMinus3?.label} (M-3)</div>
                              <div className="gestao-subhead">
                                {gestaoData.mMinus3?.startFormatted} - {gestaoData.mMinus3?.endFormatted}
                              </div>
                            </th>
                            <th colSpan={2}>
                              <div>{gestaoData.mMinus2?.label} (M-2)</div>
                              <div className="gestao-subhead">
                                {gestaoData.mMinus2?.startFormatted} - {gestaoData.mMinus2?.endFormatted}
                              </div>
                            </th>
                            <th colSpan={2}>
                              <div>{gestaoData.mMinus1?.label} (M-1)</div>
                              <div className="gestao-subhead">
                                {gestaoData.mMinus1?.startFormatted} - {gestaoData.mMinus1?.endFormatted}
                              </div>
                            </th>
                          </tr>
                          <tr>
                            <th>Previsto</th>
                            <th>Realizado</th>
                            <th>Previsto</th>
                            <th>Realizado</th>
                            <th>Previsto</th>
                            <th>Realizado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gestaoPanelRows.panel1.length === 0 ? (
                            <tr>
                              <td colSpan={7} style={{ textAlign: 'center', padding: '30px' }}>
                                Nenhum serviço encontrado.
                              </td>
                            </tr>
                          ) : (
                            gestaoPanelRows.panel1.map((row) => (
                              <tr
                                key={row.service}
                                draggable
                                className={draggedGestaoRow?.panel === 'panel1' && draggedGestaoRow.service === row.service ? 'gestao-row-dragging' : ''}
                                onDragStart={() => setDraggedGestaoRow({ panel: 'panel1', service: row.service })}
                                onDragEnd={() => setDraggedGestaoRow(null)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => handleGestaoRowDrop('panel1', row.service, gestaoData.panel1Rows.map((item) => item.service))}
                              >
                                <td className="service-col"><span className="gestao-service-drag"><GripVertical size={14} />{row.service}</span></td>
                                <td>{row.m3.prev.toFixed(2)}</td>
                                <td
                                  className={
                                    row.m3.real === 0 && row.m3.prev === 0
                                      ? 'gestao-cell-neutral'
                                      : row.m3.real >= row.m3.prev
                                      ? 'gestao-cell-ontrack'
                                      : 'gestao-cell-delayed'
                                  }
                                >
                                  {row.m3.real.toFixed(2)}
                                </td>
                                <td>{row.m2.prev.toFixed(2)}</td>
                                <td
                                  className={
                                    row.m2.real === 0 && row.m2.prev === 0
                                      ? 'gestao-cell-neutral'
                                      : row.m2.real >= row.m2.prev
                                      ? 'gestao-cell-ontrack'
                                      : 'gestao-cell-delayed'
                                  }
                                >
                                  {row.m2.real.toFixed(2)}
                                </td>
                                <td>{row.m1.prev.toFixed(2)}</td>
                                <td
                                  className={
                                    row.m1.real === 0 && row.m1.prev === 0
                                      ? 'gestao-cell-neutral'
                                      : row.m1.real >= row.m1.prev
                                      ? 'gestao-cell-ontrack'
                                      : 'gestao-cell-delayed'
                                  }
                                >
                                  {row.m1.real.toFixed(2)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="a4-sheet-footer">
                      <div className="a4-sheet-legend">
                        <span className="a4-legend-item">
                          <span className="a4-legend-color gestao-cell-ontrack" /> No Prazo / Adiantado (Realizado ≥ Previsto)
                        </span>
                        <span className="a4-legend-item">
                          <span className="a4-legend-color gestao-cell-delayed" /> Com Atraso / Desvio (Realizado &lt; Previsto)
                        </span>
                      </div>
                      <span>Gestão à Vista · Dados Prevision</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* SUB-ABA: PAINEL 2 (MÊS VIGENTE)                      */}
              {/* ---------------------------------------------------- */}
              {gestaoPanelTab === 'panel2' && (
                <div className={a4LayoutMode ? 'a4-landscape-container' : ''}>
                  <div className={`${a4LayoutMode ? 'a4-landscape-sheet' : 'gestao-card'} gestao-print-source`}>
                    <div className="a4-sheet-header">
                      <div className="a4-sheet-brand">
                        <h3 className="a4-sheet-title">PAINEL 2: ATIVIDADES PREVISTAS PARA O MÊS VIGENTE</h3>
                        <span className="a4-sheet-subtitle">
                          Planejamento e pavimentos a realizar no mês {gestaoData.m0?.label} ({gestaoData.m0?.startFormatted} a {gestaoData.m0?.endFormatted})
                        </span>
                        <label className="gestao-panel-data-filter">
                          <input
                            type="checkbox"
                            checked={currentGestaoPanelPreferences.panel2.onlyWithData}
                            onChange={(event) =>
                              updateGestaoPanelPreference('panel2', (preference) => ({
                                ...preference,
                                onlyWithData: event.target.checked,
                              }))
                            }
                          />
                          <Flag size={12} />
                          Somente serviços com quantidade
                        </label>
                      </div>
                      <div className="a4-sheet-meta">
                        <div className="a4-sheet-meta-item">
                          <strong>{projects.find((p) => p.id_prevision === selectedProject)?.nome_projeto || 'Todas as Obras'}</strong>
                          <small>{gestaoGroup !== 'all' ? gestaoGroup : 'Todas as Torres'}</small>
                        </div>
                        <div className="a4-sheet-meta-item">
                          <strong>Mês Ref: {gestaoData.m0?.label}</strong>
                          <small>{new Date().toLocaleDateString('pt-BR')}</small>
                        </div>
                      </div>
                    </div>

                    <div className="a4-sheet-body">
                      <table className="gestao-table gestao-panel2-table">
                        <thead>
                          <tr>
                            <th className="service-col" style={{ width: '280px' }}>Atividade / Serviço</th>
                            <th style={{ width: '110px' }}>Qtde Prevista</th>
                            <th>PAVIMENTOS PREVISTOS NO MÊS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gestaoPanelRows.panel2.length === 0 ? (
                            <tr>
                              <td colSpan={3} style={{ textAlign: 'center', padding: '30px' }}>
                                Nenhum serviço previsto para este mês.
                              </td>
                            </tr>
                          ) : (
                            gestaoPanelRows.panel2.map((row) => (
                              <tr
                                key={row.service}
                                draggable
                                className={draggedGestaoRow?.panel === 'panel2' && draggedGestaoRow.service === row.service ? 'gestao-row-dragging' : ''}
                                onDragStart={() => setDraggedGestaoRow({ panel: 'panel2', service: row.service })}
                                onDragEnd={() => setDraggedGestaoRow(null)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => handleGestaoRowDrop('panel2', row.service, gestaoData.panel2Rows.map((item) => item.service))}
                              >
                                <td className="service-col"><span className="gestao-service-drag"><GripVertical size={14} />{row.service}</span></td>
                                <td>
                                  <strong>{row.qtdePrevista.toFixed(2)}</strong>
                                  {row.qtdeAtrasada > 0 && (
                                    <span className="gestao-overdue-count">
                                      {row.qtdeAtrasada} atrasada{row.qtdeAtrasada === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </td>
                                <td className="gestao-panel2-pavements">
                                  {row.pavimentos.length === 0 ? (
                                    <span style={{ color: '#94a3b8' }}>Nenhum pavimento pendente</span>
                                  ) : (
                                    <div className="gestao-pav-list">
                                      {row.pavimentos.map((pav) => (
                                        <span
                                          key={pav.name}
                                          className={`gestao-pav-tag ${pav.isOverdue ? 'gestao-pav-tag-overdue' : ''}`}
                                        >
                                          {pav.name}{pav.isOverdue ? ' — ATRASADA' : ''}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="a4-sheet-footer">
                      <span>Em vermelho: atividades não concluídas cujo término planejado ocorreu antes do mês vigente</span>
                      <span>Gestão à Vista · Dados Prevision</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* SUB-ABA: PAINEL 3 (PRÓXIMOS MESES)                   */}
              {/* ---------------------------------------------------- */}
              {gestaoPanelTab === 'panel3' && (
                <div className={a4LayoutMode ? 'a4-landscape-container' : ''}>
                  <div className={`${a4LayoutMode ? 'a4-landscape-sheet' : 'gestao-card'} gestao-print-source`}>
                    <div className="a4-sheet-header">
                      <div className="a4-sheet-brand">
                        <h3 className="a4-sheet-title">PAINEL 3: PROJEÇÃO PRÓXIMOS MESES</h3>
                        <span className="a4-sheet-subtitle">
                          Projeção quantitativa de pavimentos para {gestaoData.mPlus1?.label}, {gestaoData.mPlus2?.label} e {gestaoData.mPlus3?.label}
                        </span>
                        <label className="gestao-panel-data-filter">
                          <input
                            type="checkbox"
                            checked={currentGestaoPanelPreferences.panel3.onlyWithData}
                            onChange={(event) =>
                              updateGestaoPanelPreference('panel3', (preference) => ({
                                ...preference,
                                onlyWithData: event.target.checked,
                              }))
                            }
                          />
                          <Flag size={12} />
                          Somente serviços com quantidade
                        </label>
                      </div>
                      <div className="a4-sheet-meta">
                        <div className="a4-sheet-meta-item">
                          <strong>{projects.find((p) => p.id_prevision === selectedProject)?.nome_projeto || 'Todas as Obras'}</strong>
                          <small>{gestaoGroup !== 'all' ? gestaoGroup : 'Todas as Torres'}</small>
                        </div>
                        <div className="a4-sheet-meta-item">
                          <strong>Mês Ref: {gestaoData.m0?.label}</strong>
                          <small>{new Date().toLocaleDateString('pt-BR')}</small>
                        </div>
                      </div>
                    </div>

                    <div className="a4-sheet-body">
                      <table className="gestao-table">
                        <thead>
                          <tr>
                            <th className="service-col">Serviço</th>
                            <th>
                              <div>{gestaoData.mPlus1?.label} (M+1)</div>
                              <div className="gestao-subhead">Qtde Prevista</div>
                            </th>
                            <th>
                              <div>{gestaoData.mPlus2?.label} (M+2)</div>
                              <div className="gestao-subhead">Qtde Prevista</div>
                            </th>
                            <th>
                              <div>{gestaoData.mPlus3?.label} (M+3)</div>
                              <div className="gestao-subhead">Qtde Prevista</div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {gestaoPanelRows.panel3.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ textAlign: 'center', padding: '30px' }}>
                                Nenhum serviço projetado.
                              </td>
                            </tr>
                          ) : (
                            gestaoPanelRows.panel3.map((row) => (
                              <tr
                                key={row.service}
                                draggable
                                className={draggedGestaoRow?.panel === 'panel3' && draggedGestaoRow.service === row.service ? 'gestao-row-dragging' : ''}
                                onDragStart={() => setDraggedGestaoRow({ panel: 'panel3', service: row.service })}
                                onDragEnd={() => setDraggedGestaoRow(null)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => handleGestaoRowDrop('panel3', row.service, gestaoData.panel3Rows.map((item) => item.service))}
                              >
                                <td className="service-col"><span className="gestao-service-drag"><GripVertical size={14} />{row.service}</span></td>
                                <td>{row.mPlus1.toFixed(2)}</td>
                                <td>{row.mPlus2.toFixed(2)}</td>
                                <td>{row.mPlus3.toFixed(2)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="a4-sheet-footer">
                      <span>Projeção baseada na linha de balanceamento e cronograma aprovado</span>
                      <span>Gestão à Vista · Dados Prevision</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* SUB-ABA: PAINEL 4 (MATRIZ / ESCADINHA)               */}
              {/* ---------------------------------------------------- */}
              {gestaoPanelTab === 'matrix' && (
                <div className={a4LayoutMode ? 'a4-landscape-container' : ''}>
                  {/* MATRIX CUSTOMIZER TOOLBAR */}
                  <div className="matrix-manager-bar" style={{ width: '100%', maxWidth: a4LayoutMode ? '1200px' : '100%' }}>
                    <div className="matrix-select-group">
                      <label>Matriz:</label>
                      <select
                        value={activeMatrixId}
                        onChange={(e) => setActiveMatrixId(e.target.value)}
                      >
                        {isDefaultMatrixAvailable && (
                          <option value="default">
                            {defaultMatrixConfig?.name || 'Matriz Padrão'} ({defaultMatrixConfig?.selectedServices.length || gestaoData.services.length} serviços / {defaultMatrixConfig?.selectedFloors.length || gestaoData.floors.length} pavimentos)
                          </option>
                        )}
                        {projectCustomMatrices.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.selectedServices.length} serv. / {m.selectedFloors.length} pav.)
                          </option>
                        ))}
                        {!isDefaultMatrixAvailable && projectCustomMatrices.length === 0 && (
                          <option value="none">Nenhuma matriz disponível</option>
                        )}
                      </select>
                    </div>

                    <div className="matrix-actions-group">
                      <button
                        type="button"
                        className="matrix-btn btn-primary"
                        onClick={handleOpenCreateMatrix}
                      >
                        <Plus size={13} />
                        Nova Matriz
                      </button>

                      {activeMatrixId !== 'none' && (
                        <>
                          <button
                            type="button"
                            className="matrix-btn"
                            onClick={() => handleOpenEditMatrix(activeMatrixId)}
                          >
                            <Edit2 size={13} />
                            Editar
                          </button>
                          {activeMatrixId !== 'default' && (
                            <button
                              type="button"
                              className="matrix-btn"
                              onClick={() => handleDuplicateMatrix(activeMatrixId)}
                            >
                              <Copy size={13} />
                              Duplicar
                            </button>
                          )}
                          <button
                            type="button"
                            className="matrix-btn btn-danger"
                            onClick={() => handleDeleteMatrix(activeMatrixId)}
                          >
                            <Trash2 size={13} />
                            Excluir
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className={`${a4LayoutMode ? 'a4-landscape-sheet' : 'gestao-matrix-card'} gestao-print-source matrix-print-source`}>
                    <div className="a4-sheet-header">
                      <div className="a4-sheet-brand">
                        <h3 className="a4-sheet-title">
                          PAINEL 4: ESCADINHA — {currentCustomMatrix?.name || (activeMatrixId === 'none' ? 'SEM MATRIZ' : 'MATRIZ PADRÃO')}
                        </h3>
                        <span className="a4-sheet-subtitle">
                          {matrixServices.length} Serviços · {matrixFloors.length} Pavimentos
                        </span>
                      </div>
                      <div className="a4-sheet-meta">
                        <div className="a4-sheet-meta-item">
                          <strong>{projects.find((p) => p.id_prevision === selectedProject)?.nome_projeto || 'Todas as Obras'}</strong>
                          <small>{gestaoGroup !== 'all' ? gestaoGroup : 'Todas as Torres'}</small>
                        </div>
                        <div className="a4-sheet-meta-item">
                          <strong>Mês Ref: {gestaoData.m0?.label}</strong>
                          <small>{new Date().toLocaleDateString('pt-BR')}</small>
                        </div>
                      </div>
                    </div>

                    <div className="gestao-matrix-container">
                      <table className="gestao-matrix-table">
                        <thead>
                          <tr>
                            <th className="matrix-service-th">Serviço \ Pavimento</th>
                            {matrixFloors.map((floor) => (
                              <th key={floor.name}>{floor.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {matrixServices.length === 0 ? (
                            <tr>
                              <td colSpan={matrixFloors.length + 1} style={{ textAlign: 'center', padding: '30px' }}>
                                Nenhum serviço selecionado nesta matriz. Clique em "Editar" para adicionar serviços.
                              </td>
                            </tr>
                          ) : (
                            matrixServices.map((service) => (
                              <tr
                                key={service.name}
                                draggable
                                className={draggedMatrixService === service.name ? 'gestao-row-dragging' : ''}
                                onDragStart={() => setDraggedMatrixService(service.name)}
                                onDragEnd={() => setDraggedMatrixService(null)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => handleMatrixServiceDrop(service.name)}
                              >
                                <td className="matrix-service-td">
                                  <span className="gestao-service-drag">
                                    <GripVertical size={14} />
                                    {service.name}
                                  </span>
                                </td>
                                {matrixFloors.map((floor) => {
                                  const act = gestaoData.matrixMap.get(`${service.name}__${floor.name}`)
                                  if (!act) {
                                    return (
                                      <td key={floor.name} className="matrix-cell">
                                        -
                                      </td>
                                    )
                                  }
                                  const prog = Number(act.progresso_realizado) || 0
                                  const start = act.data_inicio ? new Date(act.data_inicio) : null
                                  const end = act.data_fim ? new Date(act.data_fim) : null
                                  const isM0Active =
                                    start &&
                                    end &&
                                    gestaoData.m0 &&
                                    start <= gestaoData.m0.end &&
                                    end >= gestaoData.m0.start
                                  const isDone = prog >= 1.0
                                  const isProgress = prog > 0 && prog < 1.0

                                  return (
                                    <td key={floor.name} className="matrix-cell">
                                      <div
                                        className={`matrix-cell-content ${
                                          isDone ? 'cell-done' : isProgress ? 'cell-progress' : ''
                                        } ${isM0Active ? 'cell-active-month' : ''}`}
                                        title={matrixProgressTooltip(act)}
                                      >
                                        <span className="matrix-dates">
                                          {formatDateCompact(act.data_inicio)} - {formatDateCompact(act.data_fim)}
                                        </span>
                                        <span className="matrix-percent">
                                          {formatPercent(prog)}
                                        </span>
                                      </div>
                                    </td>
                                  )
                                })}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="a4-sheet-footer">
                      <div className="a4-sheet-legend">
                        <span className="a4-legend-item">
                          <span className="a4-legend-color" style={{ background: '#dcfce7', border: '1px solid #86efac' }} /> 100% Concluído
                        </span>
                        <span className="a4-legend-item">
                          <span className="a4-legend-color" style={{ background: '#fef3c7', border: '1px solid #fde047' }} /> Em Andamento
                        </span>
                        <span className="a4-legend-item">
                          <span className="a4-legend-color" style={{ background: '#ffffff', border: '2px solid #10b981' }} /> Ativo no Mês {gestaoData.m0?.label}
                        </span>
                      </div>
                      <span>Escadinha · Dados Prevision</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* SUB-ABA: PAINEL 5 (TABELA PARA EXCEL)                */}
              {/* ---------------------------------------------------- */}
              {gestaoPanelTab === 'panel5' && (
                <div className={a4LayoutMode ? 'a4-landscape-container' : ''}>
                  <div className={`${a4LayoutMode ? 'a4-landscape-sheet' : 'gestao-card'} gestao-print-source`}>
                    <div className="a4-sheet-header">
                      <div className="a4-sheet-brand">
                        <h3 className="a4-sheet-title">PAINEL 5: TABELA DE SERVIÇOS E PAVIMENTOS</h3>
                        <span className="a4-sheet-subtitle">
                          Selecione um serviço e copie as informações diretamente para o Excel
                        </span>
                      </div>
                      <div className="a4-sheet-meta">
                        <div className="a4-sheet-meta-item">
                          <strong>{projects.find((project) => project.id_prevision === selectedProject)?.nome_projeto || 'Todas as Obras'}</strong>
                          <small>{gestaoGroup !== 'all' ? gestaoGroup : 'Todos os grupos'}</small>
                        </div>
                      </div>
                    </div>

                    <div className="a4-sheet-body panel5-sheet-body">
                      <div className="panel5-export-grid">
                        <aside className="panel5-service-column">
                          <label htmlFor="panel5-service-select">Serviço</label>
                          <select
                            id="panel5-service-select"
                            value={panel5Service}
                            onChange={(event) => setPanel5Service(event.target.value)}
                          >
                            {panel5ServiceOptions.length === 0 ? (
                              <option value="">Nenhum serviço disponível</option>
                            ) : (
                              panel5ServiceOptions.map((service) => (
                                <option key={service.name} value={service.name}>
                                  {service.name}
                                </option>
                              ))
                            )}
                          </select>
                          <span>{panel5Rows.length} linha(s) na tabela</span>
                        </aside>

                        <section className="panel5-table-section">
                          <div className="panel5-table-actions">
                            <div>
                              <strong>Dados para exportação</strong>
                              <span>Formato tabular compatível com Excel</span>
                            </div>
                            <button
                              type="button"
                              className="matrix-btn btn-primary"
                              onClick={handleCopyPanel5Table}
                              disabled={panel5Rows.length === 0}
                            >
                              <Copy size={13} />
                              Copiar para Excel
                            </button>
                          </div>

                          <div className="panel5-table-scroll">
                            <table className="panel5-export-table">
                              <thead>
                                <tr>
                                  <th>SERVIÇO + PAVIMENTO</th>
                                  <th>DURAÇÃO</th>
                                  <th>DATA DE INÍCIO</th>
                                  <th>DATA DE TÉRMINO</th>
                                </tr>
                              </thead>
                              <tbody>
                                {panel5Rows.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="panel5-empty-cell">
                                      Nenhuma atividade encontrada para o serviço selecionado.
                                    </td>
                                  </tr>
                                ) : (
                                  panel5Rows.map((row) => (
                                    <tr key={row.key}>
                                      <td>{row.serviceFloor}</td>
                                      <td>{row.duration ?? '-'}</td>
                                      <td>{row.startDate}</td>
                                      <td>{row.endDate}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      </div>
                    </div>

                    <div className="a4-sheet-footer">
                      <span>Use “Copiar para Excel” ou selecione diretamente as células da tabela</span>
                      <span>Gestão à Vista · Dados Prevision</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* SUB-ABA: VISÃO GERAL (TODOS OS 4 PAINÉIS)             */}
              {/* ---------------------------------------------------- */}
              {gestaoPanelTab === 'overview' && (
                <>
                  <div className="gestao-summary-grid">
                    {/* Painel 1 */}
                    <div className="gestao-card">
                      <div className="gestao-card-header">
                        <div className="gestao-card-title">
                          <span>Andamento Meses Anteriores</span>
                        </div>
                        <span className="gestao-card-badge">
                          {gestaoData.mMinus3?.label} - {gestaoData.mMinus1?.label}
                        </span>
                      </div>
                      <div className="gestao-card-body">
                        <table className="gestao-table">
                          <thead>
                            <tr>
                              <th className="service-col" rowSpan={2}>
                                Serviço
                              </th>
                              <th colSpan={2}>
                                <div>{gestaoData.mMinus3?.label} (M-3)</div>
                                <div className="gestao-subhead">
                                  {gestaoData.mMinus3?.startFormatted} - {gestaoData.mMinus3?.endFormatted}
                                </div>
                              </th>
                              <th colSpan={2}>
                                <div>{gestaoData.mMinus2?.label} (M-2)</div>
                                <div className="gestao-subhead">
                                  {gestaoData.mMinus2?.startFormatted} - {gestaoData.mMinus2?.endFormatted}
                                </div>
                              </th>
                              <th colSpan={2}>
                                <div>{gestaoData.mMinus1?.label} (M-1)</div>
                                <div className="gestao-subhead">
                                  {gestaoData.mMinus1?.startFormatted} - {gestaoData.mMinus1?.endFormatted}
                                </div>
                              </th>
                            </tr>
                            <tr>
                              <th>Previsto</th>
                              <th>Realizado</th>
                              <th>Previsto</th>
                              <th>Realizado</th>
                              <th>Previsto</th>
                              <th>Realizado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gestaoPanelRows.panel1.length === 0 ? (
                              <tr>
                                <td colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>
                                  Nenhum serviço encontrado.
                                </td>
                              </tr>
                            ) : (
                              gestaoPanelRows.panel1.map((row) => (
                                <tr key={row.service}>
                                  <td className="service-col">{row.service}</td>
                                  <td>{row.m3.prev.toFixed(2)}</td>
                                  <td
                                    className={
                                      row.m3.real === 0 && row.m3.prev === 0
                                        ? 'gestao-cell-neutral'
                                        : row.m3.real >= row.m3.prev
                                        ? 'gestao-cell-ontrack'
                                        : 'gestao-cell-delayed'
                                    }
                                  >
                                    {row.m3.real.toFixed(2)}
                                  </td>
                                  <td>{row.m2.prev.toFixed(2)}</td>
                                  <td
                                    className={
                                      row.m2.real === 0 && row.m2.prev === 0
                                        ? 'gestao-cell-neutral'
                                        : row.m2.real >= row.m2.prev
                                        ? 'gestao-cell-ontrack'
                                        : 'gestao-cell-delayed'
                                  }
                                >
                                  {row.m2.real.toFixed(2)}
                                </td>
                                <td>{row.m1.prev.toFixed(2)}</td>
                                <td
                                  className={
                                    row.m1.real === 0 && row.m1.prev === 0
                                      ? 'gestao-cell-neutral'
                                      : row.m1.real >= row.m1.prev
                                      ? 'gestao-cell-ontrack'
                                      : 'gestao-cell-delayed'
                                  }
                                >
                                  {row.m1.real.toFixed(2)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Painel 2 */}
                  <div className="gestao-card">
                    <div className="gestao-card-header">
                      <div className="gestao-card-title">
                        <span>Atividades Previstas - Mês Vigente</span>
                      </div>
                      <span className="gestao-card-badge">
                        {gestaoData.m0?.label} ({gestaoData.m0?.startFormatted} - {gestaoData.m0?.endFormatted})
                      </span>
                    </div>
                    <div className="gestao-card-body">
                      <table className="gestao-table gestao-panel2-table">
                        <thead>
                          <tr>
                            <th className="service-col">Atividade / Serviço</th>
                            <th style={{ width: '90px' }}>Qtde Prevista</th>
                            <th>PAVIMENTOS PREVISTOS NO MÊS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gestaoPanelRows.panel2.length === 0 ? (
                            <tr>
                              <td colSpan={3} style={{ textAlign: 'center', padding: '20px' }}>
                                Nenhum serviço encontrado.
                              </td>
                            </tr>
                          ) : (
                            gestaoPanelRows.panel2.map((row) => (
                              <tr key={row.service}>
                                <td className="service-col">{row.service}</td>
                                <td>
                                  <strong>{row.qtdePrevista.toFixed(2)}</strong>
                                  {row.qtdeAtrasada > 0 && (
                                    <span className="gestao-overdue-count">
                                      {row.qtdeAtrasada} atrasada{row.qtdeAtrasada === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </td>
                                <td className="gestao-panel2-pavements">
                                  {row.pavimentos.length === 0 ? (
                                    <span style={{ color: '#94a3b8' }}>-</span>
                                  ) : (
                                    <div className="gestao-pav-list">
                                      {row.pavimentos.map((pav) => (
                                        <span
                                          key={pav.name}
                                          className={`gestao-pav-tag ${pav.isOverdue ? 'gestao-pav-tag-overdue' : ''}`}
                                        >
                                          {pav.name}{pav.isOverdue ? ' — ATRASADA' : ''}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Painel 3 */}
                  <div className="gestao-card">
                    <div className="gestao-card-header">
                      <div className="gestao-card-title">
                        <span>Projeção Próximos Meses</span>
                      </div>
                      <span className="gestao-card-badge">
                        {gestaoData.mPlus1?.label} - {gestaoData.mPlus3?.label}
                      </span>
                    </div>
                    <div className="gestao-card-body">
                      <table className="gestao-table">
                        <thead>
                          <tr>
                            <th className="service-col">Serviço</th>
                            <th>
                              <div>{gestaoData.mPlus1?.label} (M+1)</div>
                              <div className="gestao-subhead">Qtde Prev.</div>
                            </th>
                            <th>
                              <div>{gestaoData.mPlus2?.label} (M+2)</div>
                              <div className="gestao-subhead">Qtde Prev.</div>
                            </th>
                            <th>
                              <div>{gestaoData.mPlus3?.label} (M+3)</div>
                              <div className="gestao-subhead">Qtde Prev.</div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {gestaoPanelRows.panel3.length === 0 ? (
                            <tr>
                              <td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>
                                Nenhum serviço encontrado.
                              </td>
                            </tr>
                          ) : (
                            gestaoPanelRows.panel3.map((row) => (
                              <tr key={row.service}>
                                <td className="service-col">{row.service}</td>
                                <td>{row.mPlus1.toFixed(2)}</td>
                                <td>{row.mPlus2.toFixed(2)}</td>
                                <td>{row.mPlus3.toFixed(2)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Painel 4 na Visão Geral */}
                <div className="gestao-matrix-card">
                  <div className="gestao-card-header">
                    <div className="gestao-card-title">
                      <span>Matriz de Serviços x Pavimentos (Escadinha)</span>
                    </div>
                    <span className="gestao-card-badge">
                      {matrixServices.length} Serviços · {matrixFloors.length} Pavimentos
                    </span>
                  </div>
                  <div className="gestao-matrix-container">
                    <table className="gestao-matrix-table">
                      <thead>
                        <tr>
                          <th className="matrix-service-th">Serviço \ Pavimento</th>
                          {matrixFloors.map((floor) => (
                            <th key={floor.name}>{floor.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixServices.length === 0 ? (
                          <tr>
                            <td colSpan={matrixFloors.length + 1} style={{ textAlign: 'center', padding: '30px' }}>
                              Nenhum dado encontrado para o filtro atual.
                            </td>
                          </tr>
                        ) : (
                          matrixServices.map((service) => (
                            <tr
                              key={service.name}
                              draggable
                              className={draggedMatrixService === service.name ? 'gestao-row-dragging' : ''}
                              onDragStart={() => setDraggedMatrixService(service.name)}
                              onDragEnd={() => setDraggedMatrixService(null)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => handleMatrixServiceDrop(service.name)}
                            >
                              <td className="matrix-service-td">
                                <span className="gestao-service-drag">
                                  <GripVertical size={14} />
                                  {service.name}
                                </span>
                              </td>
                              {matrixFloors.map((floor) => {
                                const act = gestaoData.matrixMap.get(`${service.name}__${floor.name}`)
                                if (!act) {
                                  return (
                                    <td key={floor.name} className="matrix-cell">
                                      -
                                    </td>
                                  )
                                }
                                const prog = Number(act.progresso_realizado) || 0
                                const start = act.data_inicio ? new Date(act.data_inicio) : null
                                const end = act.data_fim ? new Date(act.data_fim) : null
                                const isM0Active =
                                  start &&
                                  end &&
                                  gestaoData.m0 &&
                                  start <= gestaoData.m0.end &&
                                  end >= gestaoData.m0.start
                                const isDone = prog >= 1.0
                                const isProgress = prog > 0 && prog < 1.0

                                return (
                                  <td key={floor.name} className="matrix-cell">
                                    <div
                                      className={`matrix-cell-content ${
                                        isDone ? 'cell-done' : isProgress ? 'cell-progress' : ''
                                      } ${isM0Active ? 'cell-active-month' : ''}`}
                                    >
                                      <span className="matrix-dates">
                                        {formatDateCompact(act.data_inicio)} - {formatDateCompact(act.data_fim)}
                                      </span>
                                      <span className="matrix-percent">
                                        {formatPercent(prog)}
                                      </span>
                                    </div>
                                  </td>
                                )
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {isGroupOrderModalOpen && (
              <div className="matrix-modal-backdrop" onClick={() => setIsGroupOrderModalOpen(false)}>
                <div className="group-order-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="matrix-modal-header">
                    <div>
                      <h3>Configurações da Gestão à Vista</h3>
                      <p>Classificação de grupos e pavimentos</p>
                    </div>
                    <button
                      type="button"
                      className="matrix-order-btn"
                      onClick={() => setIsGroupOrderModalOpen(false)}
                      aria-label="Fechar configurações"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="group-order-body">
                    <div className="settings-classification-tabs">
                      <button
                        type="button"
                        className={settingsClassificationTab === 'groups' ? 'active' : ''}
                        onClick={() => setSettingsClassificationTab('groups')}
                      >
                        Classificação por Grupo
                      </button>
                      <button
                        type="button"
                        className={settingsClassificationTab === 'floors' ? 'active' : ''}
                        onClick={() => setSettingsClassificationTab('floors')}
                      >
                        Classificação de Pavimentos
                      </button>
                    </div>

                    {settingsClassificationTab === 'groups' ? (
                      <>
                        <p>
                          Defina a prioridade dos grupos de{' '}
                          <strong>{projects.find((project) => project.id_prevision === selectedProject)?.nome_projeto || 'Todas as Obras'}</strong>.
                          Esta ordem será aplicada a todos os painéis.
                        </p>
                        <div className="group-order-list">
                          {groupOrderDraft.map((group, index) => (
                            <div
                              key={group}
                              className="group-order-row"
                              draggable
                              onDragStart={() => setDraggedClassificationItem({ type: 'groups', index })}
                              onDragEnd={() => setDraggedClassificationItem(null)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => handleClassificationDrop('groups', index)}
                            >
                              <span className="group-order-position">{index + 1}</span>
                              <GripVertical size={15} />
                              <strong>{group}</strong>
                              <div className="matrix-item-order-btns">
                                <button type="button" className="matrix-order-btn" disabled={index === 0} onClick={() => handleMoveGroup(index, 'up')} title="Mover grupo para cima">
                                  <ArrowUp size={14} />
                                </button>
                                <button type="button" className="matrix-order-btn" disabled={index === groupOrderDraft.length - 1} onClick={() => handleMoveGroup(index, 'down')} title="Mover grupo para baixo">
                                  <ArrowDown size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <p>
                          Defina a sequência dos pavimentos de{' '}
                          <strong>{projects.find((project) => project.id_prevision === selectedProject)?.nome_projeto || 'Todas as Obras'}</strong>.
                          Esta ordem será usada na coluna “Pavimentos previstos no mês” do Painel 2.
                        </p>
                        <label className="search-field settings-floor-search">
                          <Search size={13} />
                          <input
                            value={floorOrderSearch}
                            onChange={(event) => setFloorOrderSearch(event.target.value)}
                            placeholder="Buscar pavimento..."
                          />
                        </label>
                        <div className="group-order-list floor-order-list">
                          {floorOrderDraft
                            .map((floor, index) => ({ floor, index }))
                            .filter(({ floor }) =>
                              !floorOrderSearch.trim() ||
                              floor.toLocaleLowerCase('pt-BR').includes(floorOrderSearch.trim().toLocaleLowerCase('pt-BR')),
                            )
                            .map(({ floor, index }) => (
                            <div
                              key={floor}
                              className="group-order-row"
                              draggable
                              onDragStart={() => setDraggedClassificationItem({ type: 'floors', index })}
                              onDragEnd={() => setDraggedClassificationItem(null)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => handleClassificationDrop('floors', index)}
                            >
                              <span className="group-order-position">{index + 1}</span>
                              <GripVertical size={15} />
                              <strong>{floor}</strong>
                              <div className="matrix-item-order-btns">
                                <button type="button" className="matrix-order-btn" disabled={index === 0} onClick={() => handleMoveFloor(index, 'up')} title="Mover pavimento para cima">
                                  <ArrowUp size={14} />
                                </button>
                                <button type="button" className="matrix-order-btn" disabled={index === floorOrderDraft.length - 1} onClick={() => handleMoveFloor(index, 'down')} title="Mover pavimento para baixo">
                                  <ArrowDown size={14} />
                                </button>
                              </div>
                            </div>
                            ))}
                        </div>
                      </>
                    )}
                    {settingsClassificationTab === 'floors' && floorOrderDraft.length === 0 && (
                      <div className="state-message">Nenhum pavimento disponível para este projeto.</div>
                    )}
                  </div>
                  <div className="matrix-modal-footer">
                    <button type="button" className="matrix-btn" onClick={() => setIsGroupOrderModalOpen(false)}>
                      Cancelar
                    </button>
                    <button type="button" className="matrix-btn btn-primary" onClick={handleSaveGroupOrder}>
                      Salvar classificações
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* MODAL DO CONSTRUTOR DE MATRIZES PERSONALIZADAS       */}
            {/* ---------------------------------------------------- */}
            {isMatrixModalOpen && (
              <div className="matrix-modal-backdrop" onClick={() => setIsMatrixModalOpen(false)}>
                <div className="matrix-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="matrix-modal-header">
                    <h3>{editingMatrixId === 'default' ? 'Editar Matriz Padrão' : editingMatrixId ? 'Editar Matriz Personalizada' : 'Criar Nova Matriz Personalizada'}</h3>
                    <button
                      type="button"
                      className="matrix-order-btn"
                      onClick={() => setIsMatrixModalOpen(false)}
                      style={{ fontSize: '16px' }}
                    >
                      <X size={18} />
                    </button>
                  </div>

                  <div className="matrix-modal-body">
                    <label className="gestao-field" style={{ width: '100%' }}>
                      <span>Nome da Matriz</span>
                      <input
                        value={modalMatrixName}
                        onChange={(e) => setModalMatrixName(e.target.value)}
                        placeholder="Ex: Matriz Estrutura e Alvenaria"
                        style={{
                          width: '100%',
                          minHeight: '34px',
                          border: '1px solid #b8ccc6',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '13px',
                          fontWeight: '600',
                        }}
                      />
                    </label>

                    <div className="matrix-config-columns">
                      {/* COLUNA DE GRUPOS */}
                      <div className="matrix-config-section matrix-groups-section">
                        <div className="matrix-config-section-header">
                          <h4>
                            Grupos ({modalSelectedGroups.length} de {currentGroupOrder.length})
                          </h4>
                          <div className="matrix-selection-actions">
                            <button type="button" className="matrix-mini-btn" onClick={() => handleToggleAllGroups(true)}>
                              Todos
                            </button>
                            <button type="button" className="matrix-mini-btn" onClick={() => handleToggleAllGroups(false)}>
                              Limpar
                            </button>
                          </div>
                        </div>
                        <div className="matrix-items-list">
                          {currentGroupOrder.map((group) => (
                            <div key={group} className="matrix-item-row">
                              <label className="matrix-item-label">
                                <input
                                  type="checkbox"
                                  checked={modalSelectedGroups.includes(group)}
                                  onChange={() => handleToggleMatrixGroup(group)}
                                />
                                <span>{group}</span>
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* COLUNA DE SERVIÇOS */}
                      <div className="matrix-config-section">
                        <div className="matrix-config-section-header">
                          <h4>
                            Serviços ({modalSelectedServices.length} de {modalAvailableServices.length})
                          </h4>
                          <div className="matrix-selection-actions">
                            <button
                              type="button"
                              className="matrix-mini-btn"
                              onClick={() => handleToggleAllServices(true)}
                            >
                              Todos
                            </button>
                            <button
                              type="button"
                              className="matrix-mini-btn"
                              onClick={() => handleToggleAllServices(false)}
                            >
                              Limpar
                            </button>
                          </div>
                        </div>

                        <label className="search-field" style={{ margin: '4px 0' }}>
                          <Search size={13} />
                          <input
                            value={modalServiceSearch}
                            onChange={(e) => setModalServiceSearch(e.target.value)}
                            placeholder="Buscar serviço..."
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          />
                        </label>

                        <div className="matrix-items-list">
                          {modalSelectedServices
                            .filter((serviceName) =>
                              modalAvailableServices.some((service) => service.name === serviceName),
                            )
                            .filter((s) =>
                              !modalServiceSearch.trim() ||
                              s.toLowerCase().includes(modalServiceSearch.toLowerCase()),
                            )
                            .map((serviceName) => (
                              <div key={serviceName} className="matrix-item-row">
                                <label className="matrix-item-label">
                                  <input
                                    type="checkbox"
                                    checked={true}
                                    onChange={() => handleToggleService(serviceName)}
                                  />
                                  <span>{serviceName}</span>
                                </label>
                                <div className="matrix-item-order-btns">
                                  <button
                                    type="button"
                                    className="matrix-order-btn"
                                    disabled={modalSelectedServices.indexOf(serviceName) === 0}
                                    onClick={() => handleMoveService(serviceName, 'up')}
                                    title="Mover para cima"
                                  >
                                    <ArrowUp size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    className="matrix-order-btn"
                                    disabled={modalSelectedServices.indexOf(serviceName) === modalSelectedServices.length - 1}
                                    onClick={() => handleMoveService(serviceName, 'down')}
                                    title="Mover para baixo"
                                  >
                                    <ArrowDown size={13} />
                                  </button>
                                </div>
                              </div>
                            ))}

                          {/* Serviços Desmarcados */}
                          {modalAvailableServices
                            .filter((s) => !modalSelectedServices.includes(s.name))
                            .filter((s) =>
                              !modalServiceSearch.trim() ||
                              s.name.toLowerCase().includes(modalServiceSearch.toLowerCase()),
                            )
                            .map((service) => (
                              <div key={service.name} className="matrix-item-row" style={{ opacity: 0.65 }}>
                                <label className="matrix-item-label">
                                  <input
                                    type="checkbox"
                                    checked={false}
                                    onChange={() => handleToggleService(service.name)}
                                  />
                                  <span>{service.name}</span>
                                </label>
                              </div>
                            ))}
                        </div>
                      </div>

                      {/* COLUNA DE PAVIMENTOS */}
                      <div className="matrix-config-section">
                        <div className="matrix-config-section-header">
                          <h4>
                            Pavimentos ({modalSelectedFloors.length} de {modalAvailableFloors.length})
                          </h4>
                          <div className="matrix-selection-actions">
                            <button
                              type="button"
                              className="matrix-mini-btn"
                              onClick={() => handleToggleAllFloors(true)}
                            >
                              Todos
                            </button>
                            <button
                              type="button"
                              className="matrix-mini-btn"
                              onClick={() => handleToggleAllFloors(false)}
                            >
                              Limpar
                            </button>
                            <button
                              type="button"
                              className="matrix-mini-btn"
                              onClick={() =>
                                setModalFloorSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                              }
                              title="Inverter ordem dos pavimentos"
                            >
                              <RotateCcw size={10} />
                              {modalFloorSortOrder === 'asc' ? 'Cresc.' : 'Decresc.'}
                            </button>
                          </div>
                        </div>

                        <label className="search-field" style={{ margin: '4px 0' }}>
                          <Search size={13} />
                          <input
                            value={modalFloorSearch}
                            onChange={(e) => setModalFloorSearch(e.target.value)}
                            placeholder="Buscar pavimento..."
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          />
                        </label>

                        <div className="matrix-items-list">
                          {modalAvailableFloors
                            .filter((f) =>
                              !modalFloorSearch.trim() ||
                              f.name.toLowerCase().includes(modalFloorSearch.toLowerCase()),
                            )
                            .map((floor) => {
                              const isChecked = modalSelectedFloors.includes(floor.name)
                              return (
                                <div key={floor.name} className="matrix-item-row">
                                  <label className="matrix-item-label">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleFloor(floor.name)}
                                    />
                                    <span>{floor.name}</span>
                                  </label>
                                </div>
                              )
                            })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="matrix-modal-footer">
                    <button
                      type="button"
                      className="matrix-btn"
                      onClick={() => setIsMatrixModalOpen(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="matrix-btn btn-primary"
                      onClick={handleSaveMatrixModal}
                    >
                      Salvar Matriz
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : activeView === 'dashboard' && dashboardMode === 'cff' ? (
            cffRows.length === 0 ? (
              <div className="state-message">Nenhum registro encontrado.</div>
            ) : (
              <>
                <div className="cff-month-summary-label">
                  <h3>Cronograma Físico-Financeiro</h3>
                  <span>
                    {cffBudgetLabel}
                    {' '}
                    {cffGranularity === 'weekly' && cffWeekFilter !== 'all'
                      ? `· ${cffWeekOptions.find((w) => w.data === cffWeekFilter)?.label || `corte ${formatDate(cffReferenceDate)}`}`
                      : cffReferenceDate
                        ? `· referência ${formatDate(cffReferenceDate)}`
                        : ''}
                  </span>
                </div>
                {cffGranularity === 'weekly' ? (
                  <div className="table-scroll cff-summary-scroll cff-summary-inline">
                    <table className="cff-summary-table">
                      <thead>
                        <tr>
                          <th>Período Semanal</th>
                          <th className="align-right">
                            Base {cffDisplayMode === 'acumulada' ? 'Acumulada' : 'Semana'}
                          </th>
                          <th className="align-right">
                            Previsto {cffDisplayMode === 'acumulada' ? 'Acumulado' : 'Semana'}
                          </th>
                          <th className="align-right">
                            Realizado {cffDisplayMode === 'acumulada' ? 'Acumulado' : 'Semana'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            {cffWeekFilter === 'all'
                              ? 'Todas as semanas (Total da Obra)'
                              : cffWeekOptions.find((w) => w.data === cffWeekFilter)?.label ||
                                `Semana com corte em ${formatDate(cffWeekFilter)}`}
                          </td>
                          <td className="align-right">{formatPercent(cffSummaryTotals.base)}</td>
                          <td className="align-right">{formatPercent(cffSummaryTotals.previsto)}</td>
                          <td className="align-right">{formatPercent(cffSummaryTotals.realizado)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  cffMonthlyRows.length > 0 && (
                    <div className="table-scroll cff-summary-scroll cff-summary-inline">
                      <table className="cff-summary-table">
                        <thead>
                          <tr>
                            <th>Mês</th>
                            <th className="align-right">
                              Base {cffDisplayMode === 'acumulada' ? 'Acumulada' : 'Mês'}
                            </th>
                            <th className="align-right">
                              Previsto {cffDisplayMode === 'acumulada' ? 'Acumulado' : 'Mês'}
                            </th>
                            <th className="align-right">
                              Realizado {cffDisplayMode === 'acumulada' ? 'Acumulado' : 'Mês'}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {cffMonthlyRows
                            .filter((row) =>
                              cffMonthFilter === 'all'
                                ? true
                                : String(row.data || '') === cffMonthFilter,
                            )
                            .map((row) => (
                              <tr key={String(row.data || '')}>
                                <td>{formatMonthLabel(row.data)}</td>
                                <td className="align-right">{formatPercent(row.baseExibida)}</td>
                                <td className="align-right">{formatPercent(row.previstoExibido)}</td>
                                <td className="align-right">{formatPercent(row.realizadoExibido)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
                <div className="table-scroll cff-scroll">
                  <table className={`cff-table ${cffDenseMode ? 'dense' : ''}`}>
                    <thead>
                      <tr>
                        <th>Código WBS</th>
                        <th>Atividade</th>
                        <th>Data de início</th>
                        <th>Data de fim</th>
                        <th className="align-right">Material</th>
                        <th className="align-right">Mão de obra</th>
                        <th className="align-right">Total</th>
                        <th className="align-right">
                          Base {cffDisplayMode === 'acumulada' ? 'acum.' : cffGranularity === 'weekly' ? 'sem.' : 'mês'}
                        </th>
                        <th className="align-right">
                          Previsto {cffDisplayMode === 'acumulada' ? 'acum.' : cffGranularity === 'weekly' ? 'sem.' : 'mês'}
                        </th>
                        <th className="align-right">
                          Realizado {cffDisplayMode === 'acumulada' ? 'acum.' : cffGranularity === 'weekly' ? 'sem.' : 'mês'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cffRows.map((record, index) => (
                        <tr key={String(record.firestore_id || record.id_prevision || index)}>
                          <td>{String(record.codigo || '-')}</td>
                          <td>
                            <div className="primary-cell">
                              <strong>{String(record.descricao || '-')}</strong>
                              <small>{String(record.orcamento_nome || `Nível ${record.nivel || '-'}`)}</small>
                            </div>
                          </td>
                          <td>{formatDate(record.data_inicio_obra || record.data_inicio)}</td>
                          <td>{formatDate(record.data_fim_obra || record.data_fim)}</td>
                          <td className="align-right">{formatCurrency(record.custo_material)}</td>
                          <td className="align-right">{formatCurrency(record.custo_mao_obra)}</td>
                          <td className="align-right total-cell">{formatCurrency(record.custo_total)}</td>
                          <td className="align-right">{formatPercent(record.cffBase ?? record.peso_base)}</td>
                          <td className="align-right">{formatPercent(record.cffPrevisto ?? record.peso_previsto)}</td>
                          <td className="align-right">{formatPercent(record.cffRealizado ?? record.peso_realizado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
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

        {activeView !== 'projects' && activeView !== 'gestao_a_vista' && activeView !== 'curvas' && (
          <footer className="pagination">
            <span>
              Página {page + 1} · {visibleRecords.length} registros exibidos
            </span>
            <label className="pagination-size">
              <span>Mostrar linhas</span>
              <select
                value={pageSize}
                onChange={(event) => changePageSize(Number(event.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    Mostrar {size} linhas
                  </option>
                ))}
              </select>
            </label>
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
