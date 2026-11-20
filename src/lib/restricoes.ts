export type RestrictionRecord = Record<string, unknown>
export type Prazo = 'mais30' | 'de8a30' | 'de1a7' | 'hoje' | 'proximos7' | 'futuro' | 'semData'
export const FAIXAS: { id: Prazo; label: string; detalhe: string; tom: string }[] = [
  { id: 'mais30', label: '> 30 dias', detalhe: 'Atrasadas há mais de 30 dias', tom: 'danger' },
  { id: 'de8a30', label: '8–30 dias', detalhe: 'Atrasadas entre 8 e 30 dias', tom: 'danger' },
  { id: 'de1a7', label: '1–7 dias', detalhe: 'Atrasadas entre 1 e 7 dias', tom: 'danger' },
  { id: 'hoje', label: 'Hoje', detalhe: 'Vencem hoje', tom: 'warning' },
  {
    id: 'proximos7',
    label: 'Em até 7 dias',
    detalhe: 'Vencem nos próximos 7 dias',
    tom: 'warning',
  },
  { id: 'futuro', label: 'Após 7 dias', detalhe: 'Vencem após os próximos 7 dias', tom: 'info' },
  { id: 'semData', label: 'Sem prazo', detalhe: 'Sem data de vencimento válida', tom: 'neutral' },
]

export interface ChecklistRestriction {
  id: string
  descricao: string
  concluido: boolean
  prazo: string | null
  conclusao: string | null
  responsavel: string
  atrasado: boolean
}
export interface RestrictionCard {
  id: string
  codigo: string
  projetoId: string
  projeto: string
  titulo: string
  descricao: string
  criado: string | null
  prazo: string | null
  conclusao: string | null
  concluida: boolean
  dias: number | null
  faixa: Prazo
  etapa: string
  servico: string
  pavimento: string
  eap: string
  responsaveis: string[]
  etiquetas: string[]
  checklist: ChecklistRestriction[]
  checklistAtrasados: number
}

export function hojeRestricoes() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function dataRestricao(value: unknown): string | null {
  const iso = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === iso ? iso : null
}

function diasEntre(date: string, reference: string) {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / 86_400_000,
  )
}

function array(value: unknown): RestrictionRecord[] {
  if (typeof value === 'string') {
    try {
      return array(JSON.parse(value))
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : []
}

function nomes(values: unknown, fallback: unknown): string[] {
  const names = array(values)
    .map((v) => String(v.nome || v.email || '').trim())
    .filter(Boolean)
  return [
    ...new Set(
      names.length
        ? names
        : String(fallback || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    ),
  ]
}

export function prepararRestricoes(
  records: RestrictionRecord[],
  referencia: string,
): RestrictionCard[] {
  if (!dataRestricao(referencia)) throw new Error('Data de referência inválida.')
  const unique = new Map<string, RestrictionCard>()
  records.forEach((r, index) => {
    const projetoId = String(r.projeto_id || '')
    const codigo = String(r.id_prevision || '')
    const id = JSON.stringify([projetoId, codigo || r.firestore_id || index])
    const prazo = dataRestricao(r.vencimento_em)
    const dias = prazo ? diasEntre(prazo, referencia) : null
    const concluida = Boolean(r.concluido_em) || String(r.etapa_fase || '').toLowerCase() === 'done'
    const faixa: Prazo =
      dias === null
        ? 'semData'
        : dias < -30
          ? 'mais30'
          : dias < -7
            ? 'de8a30'
            : dias < 0
              ? 'de1a7'
              : dias === 0
                ? 'hoje'
                : dias <= 7
                  ? 'proximos7'
                  : 'futuro'
    const checklist = array(r.checklist_itens).map((item, i): ChecklistRestriction => {
      const date = dataRestricao(item.vencimento_em)
      const done =
        item.status === true ||
        item.status === 1 ||
        item.status === 'true' ||
        Boolean(item.concluido_em)
      return {
        id: String(item.id_prevision || i),
        descricao: String(item.descricao || 'Item sem descrição'),
        concluido: done,
        prazo: date,
        conclusao: dataRestricao(item.concluido_em),
        responsavel: String(item.responsavel_nome || item.responsavel_email || ''),
        atrasado: !concluida && !done && !!date && date < referencia,
      }
    })
    unique.set(id, {
      id,
      codigo,
      projetoId,
      projeto: String(r.projeto_nome || 'Projeto não informado'),
      titulo: String(r.titulo || 'Restrição sem título'),
      descricao: String(r.descricao || ''),
      criado: dataRestricao(r.criado_em),
      prazo,
      conclusao: dataRestricao(r.concluido_em),
      concluida,
      dias,
      faixa,
      etapa: String(r.etapa_nome || 'Sem etapa'),
      servico: String(r.servico_nome || ''),
      pavimento: String(r.pavimento_nome || ''),
      eap: String(r.codigo_eap || ''),
      responsaveis: nomes(r.usuarios, r.usuarios_nomes),
      etiquetas: nomes(r.etiquetas, r.etiquetas_nomes),
      checklist,
      checklistAtrasados: checklist.filter((i) => i.atrasado).length,
    })
  })
  return [...unique.values()].sort(
    (a, b) =>
      (a.prazo || '9999').localeCompare(b.prazo || '9999') ||
      a.projeto.localeCompare(b.projeto, 'pt-BR') ||
      a.titulo.localeCompare(b.titulo, 'pt-BR'),
  )
}

export async function carregarRestricoes(signal: AbortSignal): Promise<RestrictionRecord[]> {
  const records: RestrictionRecord[] = []
  for (let page = 0; ; page++) {
    const response = await fetch(`/api/data?type=restrictions&limit=200&page=${page}`, { signal })
    if (!response.ok)
      throw new Error('Não foi possível consultar as restrições da Prevision. Tente novamente.')
    const payload = await response.json()
    if (!Array.isArray(payload.records) || (payload.hasMore && payload.records.length === 0)) {
      throw new Error('A consulta retornou dados incompletos. Recarregue as restrições.')
    }
    records.push(...payload.records)
    if (!payload.hasMore) return records
  }
}

export function formatarPrazo(card: RestrictionCard) {
  if (card.concluida) return 'Concluída'
  if (card.dias === null) return 'Sem prazo'
  if (card.dias < 0) return `${-card.dias} d de atraso`
  if (card.dias === 0) return 'Vence hoje'
  return `Em ${card.dias} d`
}
