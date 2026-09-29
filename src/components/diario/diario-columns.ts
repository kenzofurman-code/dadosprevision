import type { MegaColumnDef } from '../mega/mega-columns'
import type { TabelaDiario } from './diario-api'

type Extra = Partial<Omit<MegaColumnDef, 'id' | 'label' | 'type'>>
const col = (id: string, label: string, type: MegaColumnDef['type'], extra: Extra = {}): MegaColumnDef =>
  ({ id, label, type, category: 'outros', defaultVisible: true, ...extra })

const obraEData: MegaColumnDef[] = [
  col('obra_nome', 'Obra', 'text', { category: 'identificacao' }),
  col('data', 'Data', 'date', { category: 'datas' }),
  col('numero', 'Nº', 'code', { category: 'identificacao', align: 'right' }),
]

export const COLUNAS_DIARIO: Record<TabelaDiario, MegaColumnDef[]> = {
  relatorios: [
    ...obraEData,
    col('dia_semana', 'Dia da semana', 'text', { category: 'datas', defaultVisible: false }),
    col('status', 'Status', 'badge', { category: 'status' }),
    col('clima_manha', 'Clima manhã', 'text'),
    col('condicao_manha', 'Condição manhã', 'text', { defaultVisible: false }),
    col('clima_tarde', 'Clima tarde', 'text'),
    col('condicao_tarde', 'Condição tarde', 'text', { defaultVisible: false }),
    col('clima_noite', 'Clima noite', 'text', { defaultVisible: false }),
    col('condicao_noite', 'Condição noite', 'text', { defaultVisible: false }),
    col('indice_pluviometrico', 'Chuva (mm)', 'number', { category: 'valores', align: 'right' }),
    col('dia_parado', 'Dia parado', 'text', { category: 'status' }),
    col('dia_chuvoso', 'Dia chuvoso', 'text', { category: 'status' }),
    col('dia_impraticavel', 'Impraticável', 'text', { category: 'status' }),
    col('total_fotos', 'Fotos', 'number', { category: 'valores', align: 'right' }),
    col('criado_por', 'Criado por', 'text', { category: 'identificacao' }),
    col('criado_em', 'Criado em', 'date', { category: 'datas', defaultVisible: false }),
    col('modificado_por', 'Modificado por', 'text', { category: 'identificacao', defaultVisible: false }),
    col('modificado_em', 'Modificado em', 'date', { category: 'datas', defaultVisible: false }),
  ],
  atividades: [
    ...obraEData,
    col('descricao', 'Atividade', 'text', { category: 'itens' }),
    col('observacao', 'Observação', 'text', { category: 'itens', defaultVisible: false }),
    col('status', 'Status', 'badge', { category: 'status' }),
    col('porcentagem', 'Avanço (%)', 'number', { category: 'valores', align: 'right' }),
    col('total_fotos', 'Fotos', 'number', { category: 'valores', align: 'right' }),
  ],
  mao_obra: [
    ...obraEData,
    col('funcao', 'Função', 'text', { category: 'itens' }),
    col('quantidade', 'Quantidade', 'number', { category: 'valores', align: 'right' }),
    col('empreiteira', 'Empreiteira', 'text', { category: 'itens' }),
  ],
  equipamentos: [
    ...obraEData,
    col('descricao', 'Equipamento', 'text', { category: 'itens' }),
    col('quantidade', 'Quantidade', 'number', { category: 'valores', align: 'right' }),
  ],
  ocorrencias: [
    ...obraEData,
    col('descricao', 'Ocorrência', 'text', { category: 'itens' }),
    col('tags', 'Tags', 'text', { category: 'itens' }),
    col('paralisacao', 'Paralisação', 'text', { category: 'status' }),
  ],
  fotos: [
    ...obraEData,
    col('url_miniatura', 'Foto', 'text', { category: 'itens' }),
    col('descricao', 'Descrição', 'text', { category: 'itens' }),
    col('origem', 'Origem', 'text', { category: 'itens' }),
  ],
  cargas: [
    col('id', 'Carga', 'code', { category: 'identificacao' }),
    col('iniciada_em', 'Início', 'date', { category: 'datas' }),
    col('finalizada_em', 'Fim', 'date', { category: 'datas' }),
    col('status', 'Status', 'badge', { category: 'status' }),
    col('obras', 'Obras', 'number', { category: 'valores', align: 'right' }),
    col('novos', 'Novos', 'number', { category: 'valores', align: 'right' }),
    col('alterados', 'Alterados', 'number', { category: 'valores', align: 'right' }),
    col('removidos', 'Removidos', 'number', { category: 'valores', align: 'right' }),
    col('erros', 'Erros', 'number', { category: 'valores', align: 'right' }),
  ],
}
