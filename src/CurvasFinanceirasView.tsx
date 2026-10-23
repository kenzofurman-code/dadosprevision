import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  WalletCards,
  TrendingUp,
  Table2,
  ListTree,
  Settings2,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Trash2,
  Calendar,
  Layers,
  Save,
  History,
} from 'lucide-react'
import './CurvasFinanceirasView.css'
import { PlanilhaAnalitica } from './components/curvas-financeiras/PlanilhaAnalitica'
import { RealizadoProjecao } from './components/curvas-financeiras/RealizadoProjecao'

interface CurvaKpis {
  totalOrcado: number
  totalMaterial: number
  totalMaoDeObra: number
  realizadoHistorico: number
  saldoProjetado: number
  picoFinanceiro: { mes: string | null; valor: number }
  totalMeses: number
  inicioProjecao: string | null
  fimProjecao: string | null
  dataFimObraEtapas?: string | null
  dataLiberacaoRetencao?: string | null
}

interface RegraOrigem {
  codigo_origem: string
  nivel: number
}

interface EtapaHierarquia {
  codigo: string
  nome: string
  nivel: number
}

interface VersaoResumo {
  id: number
  nome: string
  criado_em: string
  total_orcado: number | null
}

interface VersaoAberta {
  id: number
  nome: string
  criado_em: string
  payload: Partial<CurvasApiResponse>
}

interface CurvaMensalPonto {
  mes: string
  economicoMensal: number
  economicoAcumulado: number
  competenciaMensal: number
  competenciaMaterial: number
  competenciaMaoDeObra: number
  competenciaAcumulado: number
  financeiroMensal: number
  financeiroMaterial: number
  financeiroMaoDeObra: number
  financeiroAcumulado: number
}

interface CurvaEtapaCalculada {
  codigo_etapa: string
  codigo_prevision: string
  nome: string
  nivel: number
  data_inicio: string
  data_fim: string
  custo_material: number
  custo_mao_obra: number
  custo_total: number
  regraMaterial?: RegraOrigem | null
  regraMo?: RegraOrigem | null
  mensal?: Record<string, number[]>
}

interface CurvaParametrosObra {
  projeto_id: string
  dias_antecedencia_padrao: number
  prazo_pagamento_padrao_dias: number
  dia_corte_medicao_mo: number
  dia_pagamento_mo: number
  retencao_mo_ativa?: boolean
  retencao_mo_percentual?: number
  data_fim_obra?: string | null
  atualizado_em?: string | null
}

interface CurvaParametroEtapa {
  id?: number
  projeto_id: string
  codigo_etapa: string
  tipo: 'MATERIAL' | 'MAO_DE_OBRA'
  dias_antecedencia: number | null
  num_entregas: number | null
  tipo_pagamento: 'DIAS' | 'PARCELADO'
  prazo_dias: number | null
  parcelas_dias: number[] | null
  retencao_ativa?: boolean | null
  retencao_percentual?: number | null
  observacao?: string | null
}

interface ConciliacaoProjetado {
  totalFora: number
  fora: Array<{ codigo: string; total: number; material: number; mao_de_obra: number; descricao: string }>
  etapasSemProjetado: Array<{ codigo: string; nome: string; orcamento: number }>
}

interface CurvasApiResponse {
  ok: boolean
  projetoId: string
  conciliacaoProjetado?: ConciliacaoProjetado | null
  importacaoCustoProjetado: {
    id: number
    referencia: string
    total: number
    importado_em: string
    arquivo: string | null
  } | null
  parametrosObra: CurvaParametrosObra
  parametrosEtapas: CurvaParametroEtapa[]
  etapasHierarquia?: EtapaHierarquia[]
  kpis: CurvaKpis
  meses: string[]
  seriesMensal: CurvaMensalPonto[]
  etapas: CurvaEtapaCalculada[]
}

interface Props {
  projectId: string
  projectName: string
  projects: Array<{ id_prevision: string; nome_projeto: string }>
  onSelectProject: (id: string) => void
}

type TabMode = 'grafico' | 'realizado' | 'mensal' | 'analitica' | 'etapas'
type ScopeFilter = 'todos' | 'material' | 'mao_de_obra'
type ChartMode = 'acumulado_pct' | 'acumulado_reais' | 'mensal_reais' | 'mensal_pct'

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val || 0)

const formatCurrencyDecimals = (val: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0)

const formatMonthLabel = (mesIso: string) => {
  if (!mesIso || !mesIso.includes('-')) return mesIso
  const [ano, mes] = mesIso.split('-')
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const idx = parseInt(mes, 10) - 1
  return `${nomes[idx] || mes}/${ano.slice(2)}`
}

const formatDataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '-')

// Gera os prazos das parcelas: n parcelas, a 1ª em `primeiro` dias e as demais a cada `intervalo` dias
const gerarParcelas = (n: number, primeiro: number, intervalo: number) =>
  Array.from({ length: Math.min(60, Math.max(1, n)) }, (_, i) => primeiro + i * intervalo)

const resumoParcelas = (dias: number[]) =>
  dias.length > 1 ? `${dias.length}× · ${dias[0]} a ${dias[dias.length - 1]} dias` : `${dias[0] ?? 0} dias`

const nivelDoCodigo = (codigo: string) => codigo.split('.').length

export function CurvasFinanceirasView({ projectId, projectName, projects, onSelectProject }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dadosAtuais, setDadosAtuais] = useState<CurvasApiResponse | null>(null)

  // Versões salvas: quando uma está aberta, a tela mostra o payload congelado (somente leitura)
  const [versoes, setVersoes] = useState<VersaoResumo[]>([])
  const [versaoAberta, setVersaoAberta] = useState<VersaoAberta | null>(null)
  const [salvandoVersao, setSalvandoVersao] = useState(false)
  const data = useMemo<CurvasApiResponse | null>(
    () => (versaoAberta && dadosAtuais ? { ...dadosAtuais, ...versaoAberta.payload } : dadosAtuais),
    [dadosAtuais, versaoAberta]
  )

  const [activeTab, setActiveTab] = useState<TabMode>('grafico')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('todos')
  const [chartMode, setChartMode] = useState<ChartMode>('acumulado_reais')
  const [searchTerm, setSearchTerm] = useState('')

  // Tooltip no gráfico
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // Modal de Parâmetros
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [configTab, setConfigTab] = useState<'obra' | 'etapa'>('obra')
  const [savingConfig, setSavingConfig] = useState(false)
  const [configFeedback, setConfigFeedback] = useState<string | null>(null)

  // Draft Parâmetros da Obra
  const [draftObra, setDraftObra] = useState({
    dias_antecedencia_padrao: 10,
    prazo_pagamento_padrao_dias: 28,
    dia_corte_medicao_mo: 20,
    dia_pagamento_mo: 5,
    retencao_mo_ativa: false,
    retencao_mo_percentual: 5,
    data_fim_obra: '',
  })

  // Draft Parâmetros de Etapa
  const [draftEtapa, setDraftEtapa] = useState<{
    codigo_etapa: string
    nivel: 3 | 4 | 5
    tipo: 'MATERIAL' | 'MAO_DE_OBRA'
    dias_antecedencia: number | ''
    num_entregas: number | ''
    tipo_pagamento: 'DIAS' | 'PARCELADO'
    prazo_dias: number | ''
    parcelas_str: string
    ger_parcelas: number
    ger_primeiro: number
    ger_intervalo: number
    retencao_modo: 'HERDAR' | 'SIM' | 'NAO'
    retencao_percentual: number | ''
    observacao: string
  }>({
    codigo_etapa: '',
    nivel: 5,
    tipo: 'MATERIAL',
    dias_antecedencia: 10,
    num_entregas: '',
    tipo_pagamento: 'DIAS',
    prazo_dias: 28,
    parcelas_str: '30, 60',
    ger_parcelas: 2,
    ger_primeiro: 30,
    ger_intervalo: 30,
    retencao_modo: 'HERDAR',
    retencao_percentual: '',
    observacao: '',
  })

  const parcelasDoDraft = useMemo(
    () =>
      draftEtapa.parcelas_str
        .split(/[,/;\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0),
    [draftEtapa.parcelas_str]
  )

  // Carregar dados da API
  const carregarDados = useCallback(async (pId: string) => {
    if (!pId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/curvas-financeiras/dados?projectId=${encodeURIComponent(pId)}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Erro ao carregar curvas financeiras')
      }
      setDadosAtuais(json)
      if (json.parametrosObra) {
        setDraftObra({
          dias_antecedencia_padrao: json.parametrosObra.dias_antecedencia_padrao ?? 10,
          prazo_pagamento_padrao_dias: json.parametrosObra.prazo_pagamento_padrao_dias ?? 28,
          dia_corte_medicao_mo: json.parametrosObra.dia_corte_medicao_mo ?? 20,
          dia_pagamento_mo: json.parametrosObra.dia_pagamento_mo ?? 5,
          retencao_mo_ativa: Boolean(json.parametrosObra.retencao_mo_ativa),
          retencao_mo_percentual: json.parametrosObra.retencao_mo_percentual ?? 5,
          data_fim_obra: json.parametrosObra.data_fim_obra || '',
        })
      }
    } catch (err: any) {
      console.error('Erro ao buscar dados das curvas:', err)
      setError(err.message || 'Falha na comunicação com o servidor')
    } finally {
      setLoading(false)
    }
  }, [])

  const carregarVersoes = useCallback(async (pId: string) => {
    if (!pId) return
    try {
      const res = await fetch(`/api/curvas-financeiras/versoes?projectId=${encodeURIComponent(pId)}`)
      const json = await res.json()
      if (res.ok && json.ok) setVersoes(json.versoes || [])
    } catch (err) {
      console.error('Erro ao listar versões das curvas:', err)
    }
  }, [])

  useEffect(() => {
    setVersaoAberta(null)
    setVersoes([])
    if (projectId) {
      carregarDados(projectId)
      carregarVersoes(projectId)
    }
  }, [projectId, carregarDados, carregarVersoes])

  async function handleSalvarVersao() {
    if (!projectId) return
    const sugestao = `Versão ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
    const nome = prompt('Nome da versão:', sugestao)
    if (nome === null) return
    setSalvandoVersao(true)
    try {
      const res = await fetch('/api/curvas-financeiras/versoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, nome: nome.trim() || sugestao }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao salvar versão')
      await carregarVersoes(projectId)
    } catch (err: any) {
      alert(`Erro: ${err.message}`)
    } finally {
      setSalvandoVersao(false)
    }
  }

  async function handleAbrirVersao(id: string) {
    if (!id) {
      setVersaoAberta(null)
      return
    }
    try {
      const res = await fetch(`/api/curvas-financeiras/versoes/${id}?projectId=${encodeURIComponent(projectId)}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao abrir versão')
      setVersaoAberta(json.versao)
    } catch (err: any) {
      alert(`Erro: ${err.message}`)
    }
  }

  async function handleExcluirVersao() {
    if (!versaoAberta || !confirm(`Excluir a versão "${versaoAberta.nome}"? Essa ação não pode ser desfeita.`)) return
    try {
      const res = await fetch(`/api/curvas-financeiras/versoes/${versaoAberta.id}?projectId=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao excluir versão')
      setVersaoAberta(null)
      await carregarVersoes(projectId)
    } catch (err: any) {
      alert(`Erro: ${err.message}`)
    }
  }

  // Mapa rápido de parâmetros configurados por etapa
  const mapaParametrosEtapas = useMemo(() => {
    const map = new Map<string, CurvaParametroEtapa>()
    if (data?.parametrosEtapas) {
      for (const p of data.parametrosEtapas) {
        map.set(`${p.codigo_etapa}_${p.tipo}`, p)
      }
    }
    return map
  }, [data?.parametrosEtapas])

  // Salvar Parâmetros da Obra
  async function handleSalvarObra(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId) return
    setSavingConfig(true)
    setConfigFeedback(null)
    try {
      const res = await fetch('/api/curvas-financeiras/parametros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          parametrosObra: draftObra,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao salvar parâmetros da obra')
      setConfigFeedback('Parâmetros da obra salvos com sucesso!')
      await carregarDados(projectId)
      setTimeout(() => setConfigFeedback(null), 3000)
    } catch (err: any) {
      setConfigFeedback(`Erro: ${err.message}`)
    } finally {
      setSavingConfig(false)
    }
  }

  // Salvar Parâmetro de Etapa Específica
  async function handleSalvarEtapa(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !draftEtapa.codigo_etapa) return
    setSavingConfig(true)
    setConfigFeedback(null)
    try {
      const ehMaterial = draftEtapa.tipo === 'MATERIAL'
      let parcelas: number[] | null = null
      if (ehMaterial && draftEtapa.tipo_pagamento === 'PARCELADO') {
        if (!parcelasDoDraft.length) throw new Error('Informe ao menos uma parcela.')
        parcelas = parcelasDoDraft
      }

      // Regra de Material: entrega e pagamento. Regra de MO: só retenção técnica (corte e pagamento são da obra).
      const paramPayload = ehMaterial
        ? {
            codigo_etapa: draftEtapa.codigo_etapa,
            tipo: draftEtapa.tipo,
            dias_antecedencia: draftEtapa.dias_antecedencia !== '' ? Number(draftEtapa.dias_antecedencia) : null,
            num_entregas: draftEtapa.num_entregas !== '' ? Number(draftEtapa.num_entregas) : null,
            tipo_pagamento: draftEtapa.tipo_pagamento,
            prazo_dias: draftEtapa.prazo_dias !== '' ? Number(draftEtapa.prazo_dias) : 28,
            parcelas_dias: parcelas,
            retencao_ativa: null,
            retencao_percentual: null,
            observacao: draftEtapa.observacao.trim() || null,
          }
        : {
            codigo_etapa: draftEtapa.codigo_etapa,
            tipo: draftEtapa.tipo,
            dias_antecedencia: null,
            num_entregas: null,
            tipo_pagamento: 'DIAS',
            prazo_dias: null,
            parcelas_dias: null,
            retencao_ativa: draftEtapa.retencao_modo === 'HERDAR' ? null : draftEtapa.retencao_modo === 'SIM',
            retencao_percentual:
              draftEtapa.retencao_modo === 'SIM' && draftEtapa.retencao_percentual !== ''
                ? Number(draftEtapa.retencao_percentual)
                : null,
            observacao: draftEtapa.observacao.trim() || null,
          }

      const res = await fetch('/api/curvas-financeiras/parametros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          parametrosEtapa: paramPayload,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao salvar parâmetro da etapa')
      setConfigFeedback('Parâmetro da etapa salvo com sucesso!')
      await carregarDados(projectId)
      setTimeout(() => setConfigFeedback(null), 3000)
    } catch (err: any) {
      setConfigFeedback(`Erro: ${err.message}`)
    } finally {
      setSavingConfig(false)
    }
  }

  // Remover Override de Etapa (voltar ao padrão)
  async function handleRemoverEtapaOverride(codigoEtapa: string, tipo: 'MATERIAL' | 'MAO_DE_OBRA') {
    if (!projectId) return
    if (!confirm(`Deseja remover as regras específicas da etapa ${codigoEtapa} e voltar aos padrões da obra?`)) return
    setSavingConfig(true)
    try {
      const res = await fetch('/api/curvas-financeiras/parametros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          parametrosEtapa: {
            codigo_etapa: codigoEtapa,
            tipo,
            remover: true,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Erro ao remover override')
      await carregarDados(projectId)
    } catch (err: any) {
      alert(`Erro: ${err.message}`)
    } finally {
      setSavingConfig(false)
    }
  }

  // Abrir edição de uma etapa específica
  // Preenche o formulário com a regra já salva para (código, tipo) ou com os padrões da obra
  function carregarRegraNoDraft(codigo: string, nivel: 3 | 4 | 5, tipo: 'MATERIAL' | 'MAO_DE_OBRA') {
    const override = codigo ? mapaParametrosEtapas.get(`${codigo}_${tipo}`) : undefined
    const parcelas = override?.parcelas_dias?.length ? override.parcelas_dias : [30, 60]
    setDraftEtapa({
      codigo_etapa: codigo,
      nivel,
      tipo,
      dias_antecedencia: override?.dias_antecedencia ?? draftObra.dias_antecedencia_padrao,
      num_entregas: override?.num_entregas ?? '',
      tipo_pagamento: override?.tipo_pagamento ?? 'DIAS',
      prazo_dias: override?.prazo_dias ?? draftObra.prazo_pagamento_padrao_dias,
      parcelas_str: parcelas.join(', '),
      ger_parcelas: parcelas.length,
      ger_primeiro: parcelas[0],
      ger_intervalo: parcelas.length > 1 ? parcelas[1] - parcelas[0] : 30,
      retencao_modo:
        override?.retencao_ativa === true ? 'SIM' : override?.retencao_ativa === false ? 'NAO' : 'HERDAR',
      retencao_percentual: override?.retencao_percentual ?? '',
      observacao: override?.observacao || '',
    })
  }

  function abrirEdicaoEtapa(etapa: CurvaEtapaCalculada) {
    carregarRegraNoDraft(etapa.codigo_etapa, 5, 'MATERIAL')
    setConfigTab('etapa')
    setIsConfigOpen(true)
  }

  // Opções do seletor de etapa conforme o nível escolhido
  const opcoesEtapaPorNivel = useMemo(() => {
    if (draftEtapa.nivel === 5) {
      return (data?.etapas || []).map((et) => ({ codigo: et.codigo_etapa, nome: et.nome, custo: et.custo_total }))
    }
    return (data?.etapasHierarquia || [])
      .filter((e) => Number(e.nivel) === draftEtapa.nivel)
      .map((e) => ({ codigo: e.codigo, nome: e.nome, custo: null as number | null }))
  }, [data?.etapas, data?.etapasHierarquia, draftEtapa.nivel])

  // Quantas etapas nível 5 usam efetivamente cada regra salva
  const etapasAtingidasPorRegra = useMemo(() => {
    const cont = new Map<string, number>()
    for (const et of data?.etapas || []) {
      if (et.regraMaterial) {
        const k = `${et.regraMaterial.codigo_origem}_MATERIAL`
        cont.set(k, (cont.get(k) || 0) + 1)
      }
      if (et.regraMo) {
        const k = `${et.regraMo.codigo_origem}_MAO_DE_OBRA`
        cont.set(k, (cont.get(k) || 0) + 1)
      }
    }
    return cont
  }, [data?.etapas])

  const descreverRegra = (p: CurvaParametroEtapa) => {
    if (p.tipo === 'MAO_DE_OBRA') {
      if (p.retencao_ativa === true) return `Retenção técnica: ${p.retencao_percentual ?? draftObra.retencao_mo_percentual}%`
      if (p.retencao_ativa === false) return 'Sem retenção técnica'
      return 'Retenção: herda da obra'
    }
    const entrega = p.num_entregas ? `${p.num_entregas} entrega(s)` : 'conforme execução'
    const pagto = p.tipo_pagamento === 'PARCELADO' && p.parcelas_dias?.length
      ? resumoParcelas(p.parcelas_dias)
      : `${p.prazo_dias ?? draftObra.prazo_pagamento_padrao_dias} dias`
    return `Antecedência: ${p.dias_antecedencia ?? draftObra.dias_antecedencia_padrao}d • ${entrega} • Pagto: ${pagto}`
  }

  // Exportar dados para CSV
  function exportarCsv() {
    if (!data?.seriesMensal?.length) return
    const headers = [
      'Mês',
      'Econômico Mensal (R$)',
      'Econômico Acumulado (R$)',
      'Competência Mensal Total (R$)',
      '% do Orçamento (Competência)',
      'Competência Material (R$)',
      'Competência Mão de Obra (R$)',
      'Competência Acumulada (R$)',
      'Financeiro Mensal Total (R$)',
      '% do Orçamento (Financeiro)',
      'Financeiro Material (R$)',
      'Financeiro Mão de Obra (R$)',
      'Financeiro Acumulado (R$)',
      'Saldo Caixa do Mês (R$)',
    ]
    const rows = data.seriesMensal.map((s) => [
      s.mes,
      s.economicoMensal.toFixed(2),
      s.economicoAcumulado.toFixed(2),
      s.competenciaMensal.toFixed(2),
      ((s.competenciaMensal / (data.kpis.totalOrcado || 1)) * 100).toFixed(2),
      s.competenciaMaterial.toFixed(2),
      s.competenciaMaoDeObra.toFixed(2),
      s.competenciaAcumulado.toFixed(2),
      s.financeiroMensal.toFixed(2),
      ((s.financeiroMensal / (data.kpis.totalOrcado || 1)) * 100).toFixed(2),
      s.financeiroMaterial.toFixed(2),
      s.financeiroMaoDeObra.toFixed(2),
      s.financeiroAcumulado.toFixed(2),
      (s.competenciaMensal - s.financeiroMensal).toFixed(2),
    ])

    const csvContent = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n')
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `curvas_financeiras_${projectId}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Filtragem de etapas pesquisadas
  const etapasFiltradas = useMemo(() => {
    if (!data?.etapas) return []
    const term = searchTerm.toLowerCase().trim()
    if (!term) return data.etapas
    return data.etapas.filter(
      (e) =>
        e.codigo_etapa.toLowerCase().includes(term) ||
        e.codigo_prevision.toLowerCase().includes(term) ||
        e.nome.toLowerCase().includes(term)
    )
  }, [data?.etapas, searchTerm])

  // Cálculos do Gráfico SVG
  const chartData = useMemo(() => {
    if (!data?.seriesMensal || !data.seriesMensal.length) return null

    const totalOrcado = data.kpis.totalOrcado || 1
    const series = data.seriesMensal

    // Pontos: valor do mês (conforme o filtro Material/MO) -> acumula se o modo for acumulado
    // -> converte em % do orçamento se o modo for percentual.
    const acumulado = chartMode.startsWith('acumulado')
    const emPct = chartMode.endsWith('_pct')
    const acumular = (v: number[]) => {
      let a = 0
      return v.map((x) => (a += x))
    }
    const escalar = (v: number[]) => {
      const base = acumulado ? acumular(v) : v
      if (!emPct) return base
      return base.map((x) => (acumulado ? Math.min(100, (x / totalOrcado) * 100) : (x / totalOrcado) * 100))
    }
    const pointsEcon = escalar(series.map((s) => s.economicoMensal))
    const pointsComp = escalar(
      series.map((s) =>
        scopeFilter === 'material'
          ? s.competenciaMaterial
          : scopeFilter === 'mao_de_obra'
          ? s.competenciaMaoDeObra
          : s.competenciaMensal
      )
    )
    const pointsFin = escalar(
      series.map((s) =>
        scopeFilter === 'material'
          ? s.financeiroMaterial
          : scopeFilter === 'mao_de_obra'
          ? s.financeiroMaoDeObra
          : s.financeiroMensal
      )
    )
    const maiorPonto = Math.max(...pointsEcon, ...pointsComp, ...pointsFin, 0)
    const maxY = acumulado
      ? emPct
        ? 100
        : Math.max(maiorPonto, totalOrcado)
      : Math.max(maiorPonto, emPct ? 0.01 : 1)

    // Configurações do ViewBox
    const W = 1000
    const H = 420
    const padTop = 30
    const padBottom = 45
    const padLeft = 85
    const padRight = 35

    const plotW = W - padLeft - padRight
    const plotH = H - padTop - padBottom

    const n = series.length
    const getX = (idx: number) => padLeft + (n > 1 ? (idx / (n - 1)) * plotW : plotW / 2)
    const getY = (val: number) => padTop + plotH - (val / (maxY || 1)) * plotH

    // Path strings
    const buildPath = (pts: number[]) => {
      if (!pts.length) return ''
      return pts.reduce((acc, val, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(val).toFixed(1)}`, '')
    }

    const pathEcon = buildPath(pointsEcon)
    const pathComp = buildPath(pointsComp)
    const pathFin = buildPath(pointsFin)

    // Área sob a curva financeira (para estética moderna)
    const areaFin =
      pathFin +
      ` L ${getX(n - 1).toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${getX(0).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`

    return {
      W,
      H,
      padTop,
      padBottom,
      padLeft,
      padRight,
      plotW,
      plotH,
      maxY,
      series,
      pointsEcon,
      pointsComp,
      pointsFin,
      pathEcon,
      pathComp,
      pathFin,
      areaFin,
      getX,
      getY,
    }
  }, [data, chartMode, scopeFilter])

  // Mouse move no SVG para tooltip
  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartData || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const clientX = e.clientX - rect.left
    const svgX = (clientX / rect.width) * chartData.W
    const innerX = svgX - chartData.padLeft
    if (innerX < 0 || innerX > chartData.plotW) {
      setHoverIndex(null)
      return
    }
    const ratio = Math.max(0, Math.min(1, innerX / chartData.plotW))
    const index = Math.round(ratio * (chartData.series.length - 1))
    setHoverIndex(index)
  }

  const activeHoverPoint = hoverIndex !== null && chartData?.series[hoverIndex] ? chartData.series[hoverIndex] : null

  const pctOrcamento = (valor: number) =>
    `${((valor / (data?.kpis.totalOrcado || 1)) * 100).toFixed(2).replace('.', ',')}%`

  // Valor do tooltip conforme o modo do gráfico (% sempre sobre o orçamento total)
  const valorTooltip = (mensal: number, acumuladoMes: number) => {
    const total = data?.kpis.totalOrcado || 1
    if (chartMode === 'acumulado_pct') return `${((acumuladoMes / total) * 100).toFixed(1)}%`
    if (chartMode === 'mensal_pct') return `${((mensal / total) * 100).toFixed(2)}%`
    if (chartMode === 'mensal_reais') return formatCurrency(mensal)
    return formatCurrency(acumuladoMes)
  }

  return (
    <div className="curvas-fin-wrapper">
      {/* Header Principal */}
      <header className="curvas-fin-header">
        <div className="curvas-fin-title-area">
          <div className="curvas-fin-icon-badge">
            <WalletCards size={24} />
          </div>
          <div>
            <h2>Curvas de Competência e Financeira</h2>
            <div className="subtitle">
              <span>{projectName ? `${projectName} — Fluxo de Caixa vs Fato Gerador Contábil` : 'Fluxo de Caixa Operacional vs Fato Gerador Contábil'}</span>
              {data?.importacaoCustoProjetado ? (
                <span className="curvas-fin-base-badge" title={`Arquivo: ${data.importacaoCustoProjetado.arquivo || 'Mega ERP'}`}>
                  <CheckCircle2 size={12} />
                  Custo Projetado Piemonte ({formatCurrency(data.importacaoCustoProjetado.total)})
                </span>
              ) : (
                <span className="curvas-fin-base-badge fallback" title="Usando orçamentação original da Prevision">
                  <AlertCircle size={12} />
                  Base CFF Prevision
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="curvas-fin-header-actions">
          <select
            className="curvas-fin-project-select"
            value={projectId}
            onChange={(e) => onSelectProject(e.target.value)}
            disabled={loading}
          >
            <option value="">Selecione uma Obra / Projeto</option>
            {projects.map((p) => (
              <option key={p.id_prevision} value={p.id_prevision}>
                {p.nome_projeto}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="curvas-fin-btn curvas-fin-btn-secondary"
            onClick={() => setIsConfigOpen(true)}
            disabled={!!versaoAberta}
            title={versaoAberta ? 'Volte ao cálculo atual para editar parâmetros' : 'Configurar regras de antecedência, lotes e prazos'}
          >
            <Settings2 size={16} />
            Parâmetros
          </button>

          <button
            type="button"
            className="curvas-fin-btn curvas-fin-btn-secondary"
            onClick={() => {
              setVersaoAberta(null)
              carregarDados(projectId)
            }}
            disabled={loading || !projectId}
            title="Refaz o cálculo com o cronograma e o custo projetado atuais"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            Recalcular
          </button>

          <button
            type="button"
            className="curvas-fin-btn curvas-fin-btn-secondary"
            onClick={handleSalvarVersao}
            disabled={salvandoVersao || !projectId}
            title="Congela o cálculo atual para consultar depois"
          >
            <Save size={16} />
            {salvandoVersao ? 'Salvando...' : 'Salvar versão'}
          </button>

          <select
            className="curvas-fin-project-select"
            value={versaoAberta ? String(versaoAberta.id) : ''}
            onChange={(e) => handleAbrirVersao(e.target.value)}
            disabled={!projectId}
            title="Visualizar o cálculo atual ou uma versão salva"
          >
            <option value="">Visualizando: cálculo atual</option>
            {versoes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nome} — {new Date(v.criado_em).toLocaleDateString('pt-BR')}
              </option>
            ))}
          </select>
        </div>
      </header>

      {versaoAberta && (
        <div className="feedback" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <History size={18} />
          <span>
            Versão <strong>{versaoAberta.nome}</strong>, salva em{' '}
            {new Date(versaoAberta.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} — somente leitura.
          </span>
          <button type="button" className="curvas-fin-btn curvas-fin-btn-secondary" onClick={() => setVersaoAberta(null)}>
            Voltar ao atual
          </button>
          <button
            type="button"
            className="curvas-fin-btn curvas-fin-btn-secondary"
            style={{ color: '#ef4444', borderColor: '#fca5a5' }}
            onClick={handleExcluirVersao}
          >
            <Trash2 size={14} />
            Excluir versão
          </button>
        </div>
      )}

      {/* Conciliação: custo projetado que não entra nas curvas e etapas sem projetado */}
      {data?.conciliacaoProjetado &&
        (data.conciliacaoProjetado.fora.length > 0 || data.conciliacaoProjetado.etapasSemProjetado.length > 0) && (
          <details className="feedback" style={{ margin: 0, display: 'block' }}>
            <summary style={{ cursor: 'pointer' }}>
              <AlertCircle size={16} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              {data.conciliacaoProjetado.fora.length > 0 && (
                <>
                  <strong>{formatCurrency(data.conciliacaoProjetado.totalFora)}</strong> do custo projetado não entram nas
                  curvas (sem etapa nível 5 no cronograma).{' '}
                </>
              )}
              {data.conciliacaoProjetado.etapasSemProjetado.length > 0 && (
                <>
                  {data.conciliacaoProjetado.etapasSemProjetado.length} etapa(s) do cronograma sem custo projetado usam o
                  orçamento da Prevision.{' '}
                </>
              )}
              Ver detalhes
            </summary>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 10, fontSize: 12.5 }}>
              {data.conciliacaoProjetado.fora.length > 0 && (
                <table className="curvas-fin-data-table" style={{ width: 'auto' }}>
                  <thead>
                    <tr>
                      <th className="col-left">Código (fora do cronograma)</th>
                      <th className="col-left">Maior insumo</th>
                      <th>Projetado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.conciliacaoProjetado.fora.map((f) => (
                      <tr key={f.codigo}>
                        <td className="col-left" style={{ fontFamily: 'monospace' }}>{f.codigo}</td>
                        <td className="col-left">{f.descricao || '-'}</td>
                        <td>{formatCurrency(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.conciliacaoProjetado.etapasSemProjetado.length > 0 && (
                <table className="curvas-fin-data-table" style={{ width: 'auto' }}>
                  <thead>
                    <tr>
                      <th className="col-left">Etapa sem custo projetado</th>
                      <th>Orçamento Prevision usado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.conciliacaoProjetado.etapasSemProjetado.map((e) => (
                      <tr key={e.codigo}>
                        <td className="col-left">
                          <span style={{ fontFamily: 'monospace' }}>{e.codigo}</span> {e.nome}
                        </td>
                        <td>{formatCurrency(e.orcamento)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </details>
        )}

      {/* Alerta de Erro */}
      {error && (
        <div className="feedback error" style={{ margin: 0 }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards Grid */}
      {data?.kpis && (
        <div className="curvas-fin-kpis-grid">
          <div className="curvas-fin-kpi-card accent-blue">
            <div className="curvas-fin-kpi-label">
              <span>Total Orçado Projetado</span>
              <Layers size={14} />
            </div>
            <div className="curvas-fin-kpi-val">{formatCurrency(data.kpis.totalOrcado)}</div>
            <div className="curvas-fin-kpi-sub">
              <span>Material: {formatCurrency(data.kpis.totalMaterial)}</span>
              <span>•</span>
              <span>MO: {formatCurrency(data.kpis.totalMaoDeObra)}</span>
            </div>
          </div>

          <div className="curvas-fin-kpi-card accent-amber">
            <div
              className="curvas-fin-kpi-label"
              title="Custo orçado × % físico executado (Prevision). Não é gasto real."
            >
              <span>Avanço Físico Valorizado</span>
              <TrendingUp size={14} />
            </div>
            <div className="curvas-fin-kpi-val">{formatCurrency(data.kpis.realizadoHistorico)}</div>
            <div className="curvas-fin-kpi-sub">
              <span>
                {data.kpis.totalOrcado > 0
                  ? `${((data.kpis.realizadoHistorico / data.kpis.totalOrcado) * 100).toFixed(1)}% do orçamento`
                  : '0%'}
              </span>
            </div>
          </div>

          <div className="curvas-fin-kpi-card accent-emerald">
            <div className="curvas-fin-kpi-label">
              <span>Saldo a Realizar (Futuro)</span>
              <WalletCards size={14} />
            </div>
            <div className="curvas-fin-kpi-val">{formatCurrency(data.kpis.saldoProjetado)}</div>
            <div className="curvas-fin-kpi-sub">
              <span>Aporte financeiro restante</span>
            </div>
          </div>

          <div className="curvas-fin-kpi-card accent-purple">
            <div className="curvas-fin-kpi-label">
              <span>Pico de Desembolso</span>
              <Calendar size={14} />
            </div>
            <div className="curvas-fin-kpi-val">{formatCurrency(data.kpis.picoFinanceiro.valor)}</div>
            <div className="curvas-fin-kpi-sub">
              <span>Mês de maior pressão: {data.kpis.picoFinanceiro.mes ? formatMonthLabel(data.kpis.picoFinanceiro.mes) : '-'}</span>
            </div>
          </div>

          <div className="curvas-fin-kpi-card accent-teal">
            <div className="curvas-fin-kpi-label">
              <span>Horizonte de Obra</span>
              <Calendar size={14} />
            </div>
            <div className="curvas-fin-kpi-val">{data.kpis.totalMeses} meses</div>
            <div className="curvas-fin-kpi-sub">
              <span>
                {data.kpis.inicioProjecao ? formatMonthLabel(data.kpis.inicioProjecao) : '-'} até{' '}
                {data.kpis.fimProjecao ? formatMonthLabel(data.kpis.fimProjecao) : '-'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Barra de Navegação e Filtros */}
      <div className="curvas-fin-nav-bar">
        <div className="curvas-fin-main-tabs">
          <button
            type="button"
            className={`curvas-fin-tab-btn ${activeTab === 'grafico' ? 'active' : ''}`}
            onClick={() => setActiveTab('grafico')}
          >
            <TrendingUp size={16} />
            Gráfico S Comparativo
          </button>
          <button
            type="button"
            className={`curvas-fin-tab-btn ${activeTab === 'realizado' ? 'active' : ''}`}
            onClick={() => setActiveTab('realizado')}
          >
            <History size={16} />
            Realizado + projeção
          </button>
          <button
            type="button"
            className={`curvas-fin-tab-btn ${activeTab === 'mensal' ? 'active' : ''}`}
            onClick={() => setActiveTab('mensal')}
          >
            <Table2 size={16} />
            Planilha Mensal Sintética
          </button>
          <button
            type="button"
            className={`curvas-fin-tab-btn ${activeTab === 'analitica' ? 'active' : ''}`}
            onClick={() => setActiveTab('analitica')}
          >
            <Table2 size={16} />
            Planilha Mensal Analítica
          </button>
          <button
            type="button"
            className={`curvas-fin-tab-btn ${activeTab === 'etapas' ? 'active' : ''}`}
            onClick={() => setActiveTab('etapas')}
          >
            <ListTree size={16} />
            Etapas e Lotes (Nível 5)
          </button>
        </div>

        <div className="curvas-fin-filters-group">
          {/* Seletor de Escopo (Material / MO / Ambos) */}
          <div className="curvas-fin-toggle-pill" title="Filtrar tipo de custo">
            <button
              type="button"
              className={`curvas-fin-pill-btn ${scopeFilter === 'todos' ? 'active' : ''}`}
              onClick={() => setScopeFilter('todos')}
            >
              Todos os Custos
            </button>
            <button
              type="button"
              className={`curvas-fin-pill-btn ${scopeFilter === 'material' ? 'active' : ''}`}
              onClick={() => setScopeFilter('material')}
            >
              Material
            </button>
            <button
              type="button"
              className={`curvas-fin-pill-btn ${scopeFilter === 'mao_de_obra' ? 'active' : ''}`}
              onClick={() => setScopeFilter('mao_de_obra')}
            >
              Mão de Obra
            </button>
          </div>

          {/* Seletor de Modo no Gráfico */}
          {activeTab === 'grafico' && (
            <div className="curvas-fin-toggle-pill" title="Escala do gráfico">
              <button
                type="button"
                className={`curvas-fin-pill-btn ${chartMode === 'acumulado_reais' ? 'active' : ''}`}
                onClick={() => setChartMode('acumulado_reais')}
              >
                Acumulado (R$)
              </button>
              <button
                type="button"
                className={`curvas-fin-pill-btn ${chartMode === 'acumulado_pct' ? 'active' : ''}`}
                onClick={() => setChartMode('acumulado_pct')}
              >
                Acumulado (%)
              </button>
              <button
                type="button"
                className={`curvas-fin-pill-btn ${chartMode === 'mensal_reais' ? 'active' : ''}`}
                onClick={() => setChartMode('mensal_reais')}
              >
                Mensal (R$)
              </button>
              <button
                type="button"
                className={`curvas-fin-pill-btn ${chartMode === 'mensal_pct' ? 'active' : ''}`}
                onClick={() => setChartMode('mensal_pct')}
                title="Quantos % do orçamento são gastos em cada mês"
              >
                Mensal (%)
              </button>
            </div>
          )}

          {activeTab === 'mensal' && (
            <button type="button" className="curvas-fin-btn curvas-fin-btn-secondary" onClick={exportarCsv}>
              <Download size={14} />
              Exportar CSV
            </button>
          )}
        </div>
      </div>

      {activeTab === 'realizado' && projectId && (
        <RealizadoProjecao projectId={projectId} scopeFilter={scopeFilter} />
      )}

      {/* Conteúdo da Aba: Gráfico S */}
      {activeTab === 'grafico' && chartData && (
        <section className="curvas-fin-chart-panel">
          <div className="curvas-fin-chart-legends">
            <div className="curvas-fin-legend-item">
              <span className="curvas-fin-legend-line" style={{ background: '#2563eb' }} />
              <span>
                <strong>Econômico (Cronograma CFF)</strong> — Distribuição física planejada
              </span>
            </div>
            <div className="curvas-fin-legend-item">
              <span className="curvas-fin-legend-line" style={{ background: '#f59e0b' }} />
              <span>
                <strong>Competência (NF Emitida)</strong> — Material recebido antecipado + MO corte dia 20
              </span>
            </div>
            <div className="curvas-fin-legend-item">
              <span className="curvas-fin-legend-line" style={{ background: '#10b981' }} />
              <span>
                <strong>Financeiro (Desembolso de Caixa)</strong> — Pagamento a prazo + MO dia 5 de M+1
              </span>
            </div>
          </div>

          <div className="curvas-fin-chart-svg-wrap">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartData.W} ${chartData.H}`}
              className="curvas-fin-chart-svg"
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                <linearGradient id="finGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {/* Grid Lines Horizontais */}
              {[0, 0.25, 0.5, 0.75, 1.0].map((step) => {
                const y = chartData.padTop + chartData.plotH * (1 - step)
                const val = chartData.maxY * step
                return (
                  <g key={step}>
                    <line
                      x1={chartData.padLeft}
                      y1={y}
                      x2={chartData.padLeft + chartData.plotW}
                      y2={y}
                      stroke="currentColor"
                      strokeOpacity="0.08"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={chartData.padLeft - 10}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="10.5"
                      fill="currentColor"
                      opacity="0.55"
                      fontFamily="system-ui"
                    >
                      {chartMode === 'acumulado_pct' ? `${Math.round(val)}%` : chartMode === 'mensal_pct' ? `${val.toFixed(1).replace('.', ',')}%` : formatCurrency(val)}
                    </text>
                  </g>
                )
              })}

              {/* Rótulos dos Meses no Eixo X */}
              {chartData.series.map((s, i) => {
                // Pular alguns meses se forem muitos para não encavalar
                const stride = Math.max(1, Math.ceil(chartData.series.length / 16))
                if (i % stride !== 0 && i !== chartData.series.length - 1) return null
                const x = chartData.getX(i)
                return (
                  <text
                    key={s.mes}
                    x={x}
                    y={chartData.padTop + chartData.plotH + 20}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill="currentColor"
                    opacity="0.6"
                    fontFamily="system-ui"
                  >
                    {formatMonthLabel(s.mes)}
                  </text>
                )
              })}

              {/* Área Sombreada Financeiro */}
              {!chartMode.startsWith('mensal') && (
                <path d={chartData.areaFin} fill="url(#finGrad)" />
              )}

              {/* Linha Econômico (Azul) */}
              <path
                d={chartData.pathEcon}
                fill="none"
                stroke="#2563eb"
                strokeWidth="2.5"
                strokeDasharray={chartMode.startsWith('mensal') ? '4 3' : 'none'}
              />

              {/* Linha Competência (Âmbar/Laranja) */}
              <path
                d={chartData.pathComp}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.5"
              />

              {/* Linha Financeiro (Verde Esmeralda) */}
              <path
                d={chartData.pathFin}
                fill="none"
                stroke="#10b981"
                strokeWidth="3.2"
              />

              {/* Régua Vertical e Pontos no Hover */}
              {hoverIndex !== null && (
                <g>
                  <line
                    x1={chartData.getX(hoverIndex)}
                    y1={chartData.padTop}
                    x2={chartData.getX(hoverIndex)}
                    y2={chartData.padTop + chartData.plotH}
                    stroke="#0f172a"
                    strokeOpacity="0.4"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  {/* Ponto Econômico */}
                  <circle
                    cx={chartData.getX(hoverIndex)}
                    cy={chartData.getY(chartData.pointsEcon[hoverIndex])}
                    r="4.5"
                    fill="#2563eb"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  {/* Ponto Competência */}
                  <circle
                    cx={chartData.getX(hoverIndex)}
                    cy={chartData.getY(chartData.pointsComp[hoverIndex])}
                    r="4.5"
                    fill="#f59e0b"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  {/* Ponto Financeiro */}
                  <circle
                    cx={chartData.getX(hoverIndex)}
                    cy={chartData.getY(chartData.pointsFin[hoverIndex])}
                    r="5.5"
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                </g>
              )}
            </svg>

            {/* Tooltip Dinâmico */}
            {activeHoverPoint && hoverIndex !== null && (
              <div
                className="curvas-fin-tooltip"
                style={{
                  left: `${(chartData.getX(hoverIndex) / chartData.W) * 100}%`,
                  top: `${(chartData.getY(chartData.pointsFin[hoverIndex]) / chartData.H) * 100}%`,
                }}
              >
                <div className="curvas-fin-tooltip-title">
                  {formatMonthLabel(activeHoverPoint.mes)} ({activeHoverPoint.mes})
                </div>

                <div className="curvas-fin-tooltip-row lead">
                  <span>
                    <span className="curvas-fin-tooltip-badge" style={{ background: '#2563eb' }} />
                    Econômico:
                  </span>
                  <span>
                    {valorTooltip(activeHoverPoint.economicoMensal, activeHoverPoint.economicoAcumulado)}
                  </span>
                </div>

                <div className="curvas-fin-tooltip-row lead">
                  <span>
                    <span className="curvas-fin-tooltip-badge" style={{ background: '#f59e0b' }} />
                    Competência:
                  </span>
                  <span>
                    {valorTooltip(activeHoverPoint.competenciaMensal, activeHoverPoint.competenciaAcumulado)}
                  </span>
                </div>
                <div className="curvas-fin-tooltip-row sub">
                  <span>Material / NF:</span>
                  <span>{formatCurrency(activeHoverPoint.competenciaMaterial)}</span>
                </div>
                <div className="curvas-fin-tooltip-row sub">
                  <span>Mão de Obra (corte dia 20):</span>
                  <span>{formatCurrency(activeHoverPoint.competenciaMaoDeObra)}</span>
                </div>

                <div className="curvas-fin-tooltip-row lead" style={{ marginTop: '8px' }}>
                  <span>
                    <span className="curvas-fin-tooltip-badge" style={{ background: '#10b981' }} />
                    Financeiro:
                  </span>
                  <span>
                    {valorTooltip(activeHoverPoint.financeiroMensal, activeHoverPoint.financeiroAcumulado)}
                  </span>
                </div>
                <div className="curvas-fin-tooltip-row sub">
                  <span>Desembolso Material:</span>
                  <span>{formatCurrency(activeHoverPoint.financeiroMaterial)}</span>
                </div>
                <div className="curvas-fin-tooltip-row sub">
                  <span>Desembolso MO (dia 5):</span>
                  <span>{formatCurrency(activeHoverPoint.financeiroMaoDeObra)}</span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Conteúdo da Aba: Planilha Mensal */}
      {activeTab === 'mensal' && data?.seriesMensal && (
        <section className="curvas-fin-table-panel">
          <div className="curvas-fin-table-actions">
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
              Detalhamento de {data.seriesMensal.length} meses de projeção
            </span>
            <button type="button" className="curvas-fin-btn curvas-fin-btn-secondary" onClick={exportarCsv}>
              <Download size={14} /> Baixar CSV
            </button>
          </div>

          <div className="curvas-fin-table-scroll">
            <table className="curvas-fin-data-table">
              <thead>
                <tr>
                  <th className="col-left">Mês</th>
                  <th className="col-econ">Econômico Mensal</th>
                  <th className="col-econ">Econômico Acumulado</th>
                  <th className="col-comp">Comp. Material</th>
                  <th className="col-comp">Comp. Mão de Obra</th>
                  <th className="col-comp">Competência Mensal</th>
                  <th className="col-comp" title="Competência do mês ÷ total orçado">% do Orç.</th>
                  <th className="col-comp">Competência Acum.</th>
                  <th className="col-fin">Fin. Material</th>
                  <th className="col-fin">Fin. Mão de Obra</th>
                  <th className="col-fin">Financeiro Mensal</th>
                  <th className="col-fin" title="Financeiro do mês ÷ total orçado">% do Orç.</th>
                  <th className="col-fin">Financeiro Acum.</th>
                  <th>Saldo Caixa (Comp - Fin)</th>
                </tr>
              </thead>
              <tbody>
                {data.seriesMensal.map((s) => {
                  const saldoCaixa = s.competenciaMensal - s.financeiroMensal
                  return (
                    <tr key={s.mes}>
                      <td className="col-left">
                        <strong>{formatMonthLabel(s.mes)}</strong>{' '}
                        <small style={{ color: 'var(--text-muted)' }}>({s.mes})</small>
                      </td>
                      <td className="col-econ">{formatCurrencyDecimals(s.economicoMensal)}</td>
                      <td className="col-econ">{formatCurrencyDecimals(s.economicoAcumulado)}</td>
                      <td className="col-comp">{formatCurrencyDecimals(s.competenciaMaterial)}</td>
                      <td className="col-comp">{formatCurrencyDecimals(s.competenciaMaoDeObra)}</td>
                      <td className="col-comp" style={{ fontWeight: 700 }}>
                        {formatCurrencyDecimals(s.competenciaMensal)}
                      </td>
                      <td className="col-comp">{pctOrcamento(s.competenciaMensal)}</td>
                      <td className="col-comp">{formatCurrencyDecimals(s.competenciaAcumulado)}</td>
                      <td className="col-fin">{formatCurrencyDecimals(s.financeiroMaterial)}</td>
                      <td className="col-fin">{formatCurrencyDecimals(s.financeiroMaoDeObra)}</td>
                      <td className="col-fin" style={{ fontWeight: 700 }}>
                        {formatCurrencyDecimals(s.financeiroMensal)}
                      </td>
                      <td className="col-fin">{pctOrcamento(s.financeiroMensal)}</td>
                      <td className="col-fin">{formatCurrencyDecimals(s.financeiroAcumulado)}</td>
                      <td style={{ color: saldoCaixa >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                        {formatCurrencyDecimals(saldoCaixa)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="col-left">TOTAL GERAL</td>
                  <td className="col-econ">
                    {formatCurrencyDecimals(data.seriesMensal.reduce((a, b) => a + b.economicoMensal, 0))}
                  </td>
                  <td className="col-econ">-</td>
                  <td className="col-comp">
                    {formatCurrencyDecimals(data.seriesMensal.reduce((a, b) => a + b.competenciaMaterial, 0))}
                  </td>
                  <td className="col-comp">
                    {formatCurrencyDecimals(data.seriesMensal.reduce((a, b) => a + b.competenciaMaoDeObra, 0))}
                  </td>
                  <td className="col-comp">
                    {formatCurrencyDecimals(data.seriesMensal.reduce((a, b) => a + b.competenciaMensal, 0))}
                  </td>
                  <td className="col-comp">{pctOrcamento(data.seriesMensal.reduce((a, b) => a + b.competenciaMensal, 0))}</td>
                  <td className="col-comp">-</td>
                  <td className="col-fin">
                    {formatCurrencyDecimals(data.seriesMensal.reduce((a, b) => a + b.financeiroMaterial, 0))}
                  </td>
                  <td className="col-fin">
                    {formatCurrencyDecimals(data.seriesMensal.reduce((a, b) => a + b.financeiroMaoDeObra, 0))}
                  </td>
                  <td className="col-fin">
                    {formatCurrencyDecimals(data.seriesMensal.reduce((a, b) => a + b.financeiroMensal, 0))}
                  </td>
                  <td className="col-fin">{pctOrcamento(data.seriesMensal.reduce((a, b) => a + b.financeiroMensal, 0))}</td>
                  <td className="col-fin">-</td>
                  <td>-</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'analitica' && data?.etapas && (
        <PlanilhaAnalitica
          etapas={data.etapas}
          hierarquia={data.etapasHierarquia || []}
          meses={data.meses || []}
          nomeArquivo={`planilha_analitica_${projectId}_${new Date().toISOString().slice(0, 10)}`}
        />
      )}

      {/* Conteúdo da Aba: Etapas (Nível 5) */}
      {activeTab === 'etapas' && (
        <section className="curvas-fin-table-panel">
          <div className="curvas-fin-table-actions">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, maxWidth: '400px' }}>
              <div className="curvas-fin-form-field" style={{ width: '100%' }}>
                <input
                  type="text"
                  placeholder="Filtrar por código ou descrição da etapa..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Mostrando {etapasFiltradas.length} de {data?.etapas?.length || 0} etapas de nível 5
            </span>
          </div>

          <div className="curvas-fin-table-scroll">
            <table className="curvas-fin-data-table">
              <thead>
                <tr>
                  <th className="col-left">Código Prevision</th>
                  <th className="col-left">Código Mega</th>
                  <th className="col-left">Descrição da Etapa</th>
                  <th className="col-left">Período</th>
                  <th>Custo Material</th>
                  <th>Custo MO</th>
                  <th>Custo Total</th>
                  <th className="col-left">Regra Aplicada</th>
                  <th className="col-left">Ações</th>
                </tr>
              </thead>
              <tbody>
                {etapasFiltradas.map((et) => {
                  const origemMat = et.regraMaterial
                  const overrideMat = origemMat ? mapaParametrosEtapas.get(`${origemMat.codigo_origem}_MATERIAL`) : undefined
                  const overrideMo = et.regraMo ? mapaParametrosEtapas.get(`${et.regraMo.codigo_origem}_MAO_DE_OBRA`) : undefined
                  const herdada = (o?: RegraOrigem | null) =>
                    o && o.nivel < 5 ? ` · herdada de ${o.codigo_origem} (N${o.nivel})` : ''
                  return (
                    <tr key={et.codigo_etapa}>
                      <td className="col-left" style={{ fontFamily: 'monospace' }}>
                        {et.codigo_prevision}
                      </td>
                      <td className="col-left" style={{ fontFamily: 'monospace' }}>
                        {et.codigo_etapa}
                      </td>
                      <td className="col-left" style={{ maxWidth: '300px', whiteSpace: 'normal' }}>
                        <strong>{et.nome}</strong>
                      </td>
                      <td className="col-left" style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        {et.data_inicio ? `${et.data_inicio.slice(0, 10)} a ${et.data_fim ? et.data_fim.slice(0, 10) : '-'}` : '-'}
                      </td>
                      <td>{formatCurrency(et.custo_material)}</td>
                      <td>{formatCurrency(et.custo_mao_obra)}</td>
                      <td style={{ fontWeight: 700 }}>{formatCurrency(et.custo_total)}</td>
                      <td className="col-left">
                        {overrideMat ? (
                          <span className="curvas-fin-badge-override" title={`Material: ${descreverRegra(overrideMat)}${herdada(origemMat)}`}>
                            Material: {overrideMat.num_entregas ? `${overrideMat.num_entregas} lotes` : 'conforme execução'}
                            {herdada(origemMat)}
                          </span>
                        ) : (
                          <span className="curvas-fin-badge-default">
                            Material: padrão ({draftObra.dias_antecedencia_padrao}d ant. / {draftObra.prazo_pagamento_padrao_dias}d prazo)
                          </span>
                        )}
                        {overrideMo && (
                          <span className="curvas-fin-badge-override" style={{ marginLeft: 4 }} title={descreverRegra(overrideMo)}>
                            MO: {descreverRegra(overrideMo)}
                            {herdada(et.regraMo)}
                          </span>
                        )}
                      </td>
                      <td className="col-left">
                        <button
                          type="button"
                          className="curvas-fin-btn curvas-fin-btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '11.5px' }}
                          onClick={() => abrirEdicaoEtapa(et)}
                          disabled={!!versaoAberta}
                        >
                          <Settings2 size={12} />
                          Configurar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal / Dialog de Configuração de Parâmetros */}
      {isConfigOpen && (
        <div className="curvas-fin-modal-backdrop" onClick={() => setIsConfigOpen(false)}>
          <div className="curvas-fin-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="curvas-fin-modal-header">
              <h3>Configuração de Regras das Curvas</h3>
              <button type="button" className="curvas-fin-btn curvas-fin-btn-secondary" onClick={() => setIsConfigOpen(false)}>
                <X size={16} />
              </button>
            </div>

            {/* Abas do Modal */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 20px' }}>
              <button
                type="button"
                className={`curvas-fin-tab-btn ${configTab === 'obra' ? 'active' : ''}`}
                style={{ borderRadius: '0', borderBottom: configTab === 'obra' ? '2px solid #10b981' : 'none' }}
                onClick={() => setConfigTab('obra')}
              >
                Parâmetros Gerais da Obra
              </button>
              <button
                type="button"
                className={`curvas-fin-tab-btn ${configTab === 'etapa' ? 'active' : ''}`}
                style={{ borderRadius: '0', borderBottom: configTab === 'etapa' ? '2px solid #10b981' : 'none' }}
                onClick={() => setConfigTab('etapa')}
              >
                Regras por Etapa ({data?.parametrosEtapas?.length || 0})
              </button>
            </div>

            <div className="curvas-fin-modal-body">
              {configFeedback && (
                <div className={`feedback ${configFeedback.startsWith('Erro') ? 'error' : 'success'}`} style={{ margin: 0 }}>
                  {configFeedback}
                </div>
              )}

              {/* Aba 1: Parâmetros da Obra */}
              {configTab === 'obra' && (
                <form onSubmit={handleSalvarObra} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div className="curvas-fin-card-info">
                    <strong>Regras de Padrão Corporativo Piemonte:</strong>
                    <br />
                    Mão de Obra executada de 21/M-1 a 20/M é competência de M e é paga no dia configurado de M+1. Com
                    retenção técnica, o percentual retido sai só do financeiro e é pago 1 ano após o fim da obra.
                    Material vira competência quando chega na obra (dias de antecedência antes da execução) e é pago
                    segundo a condição de pagamento.
                  </div>

                  <div className="curvas-fin-form-grid">
                    <div className="curvas-fin-form-field">
                      <label>Antecedência Padrão de Material (dias)</label>
                      <input
                        type="number"
                        min="0"
                        max="90"
                        value={draftObra.dias_antecedencia_padrao}
                        onChange={(e) =>
                          setDraftObra({ ...draftObra, dias_antecedencia_padrao: parseInt(e.target.value, 10) || 0 })
                        }
                        required
                      />
                      <span className="curvas-fin-hint">Quantos dias antes do início da tarefa o material chega na obra.</span>
                    </div>

                    <div className="curvas-fin-form-field">
                      <label>Prazo Médio de Pagamento Padrão (dias)</label>
                      <input
                        type="number"
                        min="0"
                        max="180"
                        value={draftObra.prazo_pagamento_padrao_dias}
                        onChange={(e) =>
                          setDraftObra({ ...draftObra, prazo_pagamento_padrao_dias: parseInt(e.target.value, 10) || 0 })
                        }
                        required
                      />
                      <span className="curvas-fin-hint">Prazo em dias corridos após a entrega para desembolso do fornecedor (ex: 28).</span>
                    </div>

                    <div className="curvas-fin-form-field">
                      <label>Dia de Corte de Medição MO</label>
                      <input
                        type="number"
                        min="1"
                        max="28"
                        value={draftObra.dia_corte_medicao_mo}
                        onChange={(e) =>
                          setDraftObra({ ...draftObra, dia_corte_medicao_mo: parseInt(e.target.value, 10) || 20 })
                        }
                        required
                      />
                      <span className="curvas-fin-hint">Do dia 21 do mês M-1 até este dia gera competência no mês M (padrão 20).</span>
                    </div>

                    <div className="curvas-fin-form-field">
                      <label>Dia de Pagamento MO</label>
                      <input
                        type="number"
                        min="1"
                        max="28"
                        value={draftObra.dia_pagamento_mo}
                        onChange={(e) =>
                          setDraftObra({ ...draftObra, dia_pagamento_mo: parseInt(e.target.value, 10) || 5 })
                        }
                        required
                      />
                      <span className="curvas-fin-hint">Dia de desembolso no mês M+1 (padrão 5).</span>
                    </div>

                    <div className="curvas-fin-form-field">
                      <label>Retenção Técnica de MO</label>
                      <select
                        value={draftObra.retencao_mo_ativa ? 'SIM' : 'NAO'}
                        onChange={(e) => setDraftObra({ ...draftObra, retencao_mo_ativa: e.target.value === 'SIM' })}
                      >
                        <option value="NAO">Não</option>
                        <option value="SIM">Sim</option>
                      </select>
                      <span className="curvas-fin-hint">Padrão da obra. Cada etapa pode mudar na regra de Mão de Obra.</span>
                    </div>

                    <div className="curvas-fin-form-field">
                      <label>% de Retenção</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={draftObra.retencao_mo_percentual}
                        disabled={!draftObra.retencao_mo_ativa}
                        onChange={(e) =>
                          setDraftObra({ ...draftObra, retencao_mo_percentual: parseFloat(e.target.value) || 0 })
                        }
                      />
                      <span className="curvas-fin-hint">Retido de cada medição, só no financeiro (ex: 5).</span>
                    </div>

                    <div className="curvas-fin-form-field">
                      <label>Data de Fim da Obra</label>
                      <input
                        type="date"
                        value={draftObra.data_fim_obra}
                        onChange={(e) => setDraftObra({ ...draftObra, data_fim_obra: e.target.value })}
                      />
                      <span className="curvas-fin-hint">
                        A retenção é paga 1 ano depois desta data.
                        {!draftObra.data_fim_obra && data?.kpis?.dataFimObraEtapas
                          ? ` Vazio: usa o fim do cronograma (${formatDataBr(data.kpis.dataFimObraEtapas)}).`
                          : ''}
                      </span>
                    </div>
                  </div>

                  <div className="curvas-fin-modal-footer" style={{ padding: 0, background: 'transparent' }}>
                    <button type="submit" className="curvas-fin-btn curvas-fin-btn-primary" disabled={savingConfig}>
                      {savingConfig ? 'Salvando...' : 'Salvar Parâmetros da Obra'}
                    </button>
                  </div>
                </form>
              )}

              {/* Aba 2: Regras Específicas por Etapa */}
              {configTab === 'etapa' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <form onSubmit={handleSalvarEtapa} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px' }}>Adicionar / Editar Regra de Etapa</h4>

                    <div className="curvas-fin-form-grid">
                      <div className="curvas-fin-form-field">
                        <label>Tipo de Custo</label>
                        <select
                          value={draftEtapa.tipo}
                          onChange={(e) =>
                            carregarRegraNoDraft(
                              draftEtapa.codigo_etapa,
                              draftEtapa.nivel,
                              e.target.value as 'MATERIAL' | 'MAO_DE_OBRA'
                            )
                          }
                        >
                          <option value="MATERIAL">Material</option>
                          <option value="MAO_DE_OBRA">Mão de Obra</option>
                        </select>
                      </div>

                      <div className="curvas-fin-form-field">
                        <label>Nível da Etapa</label>
                        <select
                          value={draftEtapa.nivel}
                          onChange={(e) => carregarRegraNoDraft('', Number(e.target.value) as 3 | 4 | 5, draftEtapa.tipo)}
                        >
                          <option value={3}>Nível 3 (vale para todas as etapas abaixo)</option>
                          <option value={4}>Nível 4 (vale para todas as etapas abaixo)</option>
                          <option value={5}>Nível 5 (etapa específica)</option>
                        </select>
                      </div>
                    </div>

                    <div className="curvas-fin-form-field">
                      <label>Etapa de Nível {draftEtapa.nivel} (Orçamento / Cronograma)</label>
                      <select
                        value={draftEtapa.codigo_etapa}
                        onChange={(e) => carregarRegraNoDraft(e.target.value, draftEtapa.nivel, draftEtapa.tipo)}
                        required
                      >
                        <option value="">Selecione a etapa...</option>
                        {opcoesEtapaPorNivel.map((et) => (
                          <option key={et.codigo} value={et.codigo}>
                            {et.codigo} — {et.nome}
                            {et.custo !== null ? ` (${formatCurrency(et.custo)})` : ''}
                          </option>
                        ))}
                      </select>
                      {draftEtapa.nivel < 5 && (
                        <span className="curvas-fin-hint">
                          Uma regra de nível {draftEtapa.nivel} vale para todas as etapas de nível 5 abaixo dela, exceto
                          as que tiverem regra própria em nível mais baixo.
                        </span>
                      )}
                    </div>

                    {draftEtapa.tipo === 'MAO_DE_OBRA' ? (
                      <div className="curvas-fin-form-grid">
                        <div className="curvas-fin-form-field">
                          <label>Tem Retenção Técnica?</label>
                          <select
                            value={draftEtapa.retencao_modo}
                            onChange={(e) =>
                              setDraftEtapa({ ...draftEtapa, retencao_modo: e.target.value as 'HERDAR' | 'SIM' | 'NAO' })
                            }
                          >
                            <option value="HERDAR">
                              Usar padrão da obra ({draftObra.retencao_mo_ativa ? `sim, ${draftObra.retencao_mo_percentual}%` : 'não'})
                            </option>
                            <option value="SIM">Sim</option>
                            <option value="NAO">Não</option>
                          </select>
                        </div>
                        {draftEtapa.retencao_modo === 'SIM' && (
                          <div className="curvas-fin-form-field">
                            <label>% de Retenção</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.5"
                              placeholder={`Padrão: ${draftObra.retencao_mo_percentual}%`}
                              value={draftEtapa.retencao_percentual}
                              onChange={(e) =>
                                setDraftEtapa({
                                  ...draftEtapa,
                                  retencao_percentual: e.target.value === '' ? '' : parseFloat(e.target.value),
                                })
                              }
                            />
                            <span className="curvas-fin-hint">
                              Retido só do financeiro; pago em{' '}
                              {formatDataBr(data?.kpis?.dataLiberacaoRetencao)} (1 ano após o fim da obra).
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                    <div className="curvas-fin-form-grid">
                      <div className="curvas-fin-form-field">
                        <label>Dias de Antecedência</label>
                        <input
                          type="number"
                          placeholder={`Padrão: ${draftObra.dias_antecedencia_padrao} dias`}
                          value={draftEtapa.dias_antecedencia}
                          onChange={(e) =>
                            setDraftEtapa({
                              ...draftEtapa,
                              dias_antecedencia: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                            })
                          }
                        />
                      </div>

                      <div className="curvas-fin-form-field">
                        <label>Número de Entregas (Lotes Uniformes)</label>
                        <input
                          type="number"
                          min="1"
                          max="24"
                          placeholder="Vazio = chega conforme a execução"
                          value={draftEtapa.num_entregas}
                          onChange={(e) =>
                            setDraftEtapa({
                              ...draftEtapa,
                              num_entregas: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                            })
                          }
                        />
                        <span className="curvas-fin-hint">
                          Vazio: o material chega conforme a execução (proporcional ao cronograma). 1: chega 100% antes do
                          início do serviço. N: N lotes iguais espaçados ao longo da etapa.
                        </span>
                      </div>

                      <div className="curvas-fin-form-field">
                        <label>Condição de Pagamento</label>
                        <select
                          value={draftEtapa.tipo_pagamento}
                          onChange={(e) =>
                            setDraftEtapa({
                              ...draftEtapa,
                              tipo_pagamento: e.target.value as 'DIAS' | 'PARCELADO',
                            })
                          }
                        >
                          <option value="DIAS">Prazo Médio Único (ex: 28 dias)</option>
                          <option value="PARCELADO">Parcelado (ex: 30/60 ou 12× a cada 28 dias)</option>
                        </select>
                      </div>

                      {draftEtapa.tipo_pagamento === 'DIAS' ? (
                        <div className="curvas-fin-form-field">
                          <label>Prazo em Dias</label>
                          <input
                            type="number"
                            min="0"
                            max="180"
                            value={draftEtapa.prazo_dias}
                            onChange={(e) =>
                              setDraftEtapa({
                                ...draftEtapa,
                                prazo_dias: e.target.value === '' ? '' : parseInt(e.target.value, 10),
                              })
                            }
                          />
                        </div>
                      ) : (
                        <>
                          <div className="curvas-fin-form-field">
                            <label>Gerar Parcelas</label>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                type="number"
                                min="1"
                                max="60"
                                style={{ width: '64px' }}
                                title="Número de parcelas"
                                value={draftEtapa.ger_parcelas}
                                onChange={(e) => setDraftEtapa({ ...draftEtapa, ger_parcelas: parseInt(e.target.value, 10) || 1 })}
                              />
                              <span>× · 1ª em</span>
                              <input
                                type="number"
                                min="0"
                                style={{ width: '64px' }}
                                title="Dias até a 1ª parcela"
                                value={draftEtapa.ger_primeiro}
                                onChange={(e) => setDraftEtapa({ ...draftEtapa, ger_primeiro: parseInt(e.target.value, 10) || 0 })}
                              />
                              <span>d · a cada</span>
                              <input
                                type="number"
                                min="1"
                                style={{ width: '64px' }}
                                title="Intervalo entre parcelas (dias)"
                                value={draftEtapa.ger_intervalo}
                                onChange={(e) => setDraftEtapa({ ...draftEtapa, ger_intervalo: parseInt(e.target.value, 10) || 1 })}
                              />
                              <span>d</span>
                              <button
                                type="button"
                                className="curvas-fin-btn curvas-fin-btn-secondary"
                                onClick={() =>
                                  setDraftEtapa({
                                    ...draftEtapa,
                                    parcelas_str: gerarParcelas(
                                      draftEtapa.ger_parcelas,
                                      draftEtapa.ger_primeiro,
                                      draftEtapa.ger_intervalo
                                    ).join(', '),
                                  })
                                }
                              >
                                Gerar
                              </button>
                            </div>
                          </div>
                          <div className="curvas-fin-form-field">
                            <label>Dias das Parcelas (a partir da entrega)</label>
                            <input
                              type="text"
                              placeholder="30, 60"
                              value={draftEtapa.parcelas_str}
                              onChange={(e) => setDraftEtapa({ ...draftEtapa, parcelas_str: e.target.value })}
                            />
                            <span className="curvas-fin-hint">
                              {parcelasDoDraft.length
                                ? `${resumoParcelas(parcelasDoDraft)} — cada entrega dividida em ${parcelasDoDraft.length} parcela(s) iguais.`
                                : 'Informe os prazos separados por vírgula ou use o gerador.'}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                      <button type="submit" className="curvas-fin-btn curvas-fin-btn-primary" disabled={savingConfig}>
                        Salvar Regra da Etapa
                      </button>
                    </div>
                  </form>

                  {/* Lista de regras já customizadas */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                      Etapas com Regras Customizadas ({data?.parametrosEtapas?.length || 0})
                    </h4>
                    {data?.parametrosEtapas?.length === 0 ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                        Nenhuma etapa customizada. Todas seguem os parâmetros globais da obra.
                      </p>
                    ) : (
                      data?.parametrosEtapas?.map((p) => (
                        <div key={`${p.codigo_etapa}_${p.tipo}`} className="curvas-fin-override-item">
                          <div
                            style={{ cursor: 'pointer' }}
                            title="Clique para editar"
                            onClick={() =>
                              carregarRegraNoDraft(
                                p.codigo_etapa,
                                Math.min(5, Math.max(3, nivelDoCodigo(p.codigo_etapa))) as 3 | 4 | 5,
                                p.tipo
                              )
                            }
                          >
                            <strong>
                              {p.codigo_etapa} · N{nivelDoCodigo(p.codigo_etapa)} ·{' '}
                              {p.tipo === 'MATERIAL' ? 'Material' : 'Mão de Obra'}
                            </strong>
                            <p>
                              {descreverRegra(p)} • atinge {etapasAtingidasPorRegra.get(`${p.codigo_etapa}_${p.tipo}`) || 0}{' '}
                              etapa(s)
                            </p>
                          </div>
                          <button
                            type="button"
                            className="curvas-fin-btn curvas-fin-btn-secondary"
                            style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                            onClick={() => handleRemoverEtapaOverride(p.codigo_etapa, p.tipo)}
                            title="Remover regra e voltar ao padrão"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
