// mega-columns.ts — Definições, presets e persistência de colunas do painel Mega ERP

export type ColumnCategory =
  | 'identificacao'
  | 'insumos'
  | 'itens'
  | 'valores'
  | 'datas'
  | 'status'
  | 'outros'

export type ColumnType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'badge'
  | 'code'

export interface MegaColumnDef {
  id: string
  label: string
  category: ColumnCategory
  type: ColumnType
  align?: 'left' | 'right' | 'center'
  defaultVisible?: boolean
  isRawData?: boolean
  rawKey?: string
  description?: string
  priority?: number
}

export interface SavedView {
  id: string
  name: string
  tableKey: string
  columns: string[]
  isDefaultPreset?: boolean
  createdAt?: string
}

// Formatadores auxiliares
const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
})

const integerFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 0,
})

export function formatDateIso(value: any): string {
  if (!value) return '-'
  const str = String(value)
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : str
}

export function formatCurrencyValue(value: any): string {
  const num = Number(value)
  return Number.isFinite(num) ? currencyFormatter.format(num) : '-'
}

export function formatNumberValue(value: any): string {
  const num = Number(value)
  return Number.isFinite(num) ? numberFormatter.format(num) : '-'
}

export function formatIntegerValue(value: any): string {
  const num = Number(value)
  return Number.isFinite(num) ? integerFormatter.format(num) : '-'
}

// Extrai o valor de um registro (seja coluna direta ou do campo raw_data)
export function getRecordValue(record: any, col: MegaColumnDef): any {
  if (!record) return null
  const key = col.id
  if (record[key] !== undefined && record[key] !== null) {
    return record[key]
  }
  const rawKey = col.rawKey || key
  if (record.raw_data && typeof record.raw_data === 'object') {
    if (record.raw_data[rawKey] !== undefined && record.raw_data[rawKey] !== null) {
      return record.raw_data[rawKey]
    }
  }
  return null
}

// Definições de Colunas por Tabela
export const TABLE_COLUMNS: Record<string, MegaColumnDef[]> = {
  // 1. ANÁLISE DE SALDO — PEDIDOS
  analise_pedidos: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'codigo_pedido', label: 'Cód. Pedido', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'cod_insumo', label: 'Cód. Insumo', category: 'insumos', type: 'code', isRawData: true, defaultVisible: false, priority: 4, description: 'Código do insumo original' },
    { id: 'descricao_insumo', label: 'Descrição do Insumo', category: 'insumos', type: 'text', isRawData: true, defaultVisible: false, priority: 5, description: 'Nome e descrição do insumo' },
    { id: 'fornecedor', label: 'Fornecedor', category: 'identificacao', type: 'text', defaultVisible: true, priority: 6 },
    { id: 'cod_item', label: 'Cód. Item', category: 'itens', type: 'code', isRawData: true, defaultVisible: false, priority: 7 },
    { id: 'descricao', label: 'Descrição do Item', category: 'itens', type: 'text', isRawData: true, defaultVisible: false, priority: 8 },
    { id: 'qtde_pedido', label: 'Qtde Pedido', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 9 },
    { id: 'unidade', label: 'Unidade', category: 'itens', type: 'text', isRawData: true, defaultVisible: false, priority: 10 },
    { id: 'valor_unitario', label: 'Valor Unitário', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 11 },
    { id: 'qtde_apropriada', label: 'Qtde Apropriada', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 12 },
    { id: 'valor_apropriacao', label: 'Valor Apropriação', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 13 },
    { id: 'cod_estruturado', label: 'Cód. Estruturado', category: 'itens', type: 'code', isRawData: true, defaultVisible: false, priority: 14 },
    { id: 'codigo_processo', label: 'Cód. Processo', category: 'identificacao', type: 'code', isRawData: true, defaultVisible: false, priority: 15 },
    { id: 'situacao_do_item', label: 'Situação do Item', category: 'status', type: 'badge', isRawData: true, defaultVisible: false, priority: 16 },
    { id: 'data_emissao', label: 'Data Emissão', category: 'datas', type: 'date', isRawData: true, defaultVisible: false, priority: 17 },
    { id: 'sequencia_item', label: 'Seq. Item', category: 'identificacao', type: 'number', align: 'right', isRawData: true, defaultVisible: false, priority: 18 },
    { id: 'qtde_convertida', label: 'Qtde Convertida', category: 'valores', type: 'number', align: 'right', isRawData: true, defaultVisible: false, priority: 19 },
    { id: 'obra_nome', label: 'Nome da Obra', category: 'identificacao', type: 'text', defaultVisible: false, priority: 20 },
  ],

  // 2. ANÁLISE DE SALDO — CONTRATOS
  analise_contratos: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'codigo_contrato', label: 'Cód. Contrato', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'cod_insumo', label: 'Cód. Insumo', category: 'insumos', type: 'code', isRawData: true, defaultVisible: false, priority: 4, description: 'Código do insumo do contrato' },
    { id: 'descricao_insumo', label: 'Descrição do Insumo', category: 'insumos', type: 'text', isRawData: true, defaultVisible: false, priority: 5, description: 'Nome do insumo contratado' },
    { id: 'fornecedor', label: 'Fornecedor', category: 'identificacao', type: 'text', defaultVisible: true, priority: 6 },
    { id: 'status_pre_contrato', label: 'Status Pré-Contrato', category: 'status', type: 'badge', defaultVisible: true, priority: 7 },
    { id: 'cod_item', label: 'Cód. Item', category: 'itens', type: 'code', isRawData: true, defaultVisible: false, priority: 8 },
    { id: 'descricao', label: 'Descrição do Item', category: 'itens', type: 'text', isRawData: true, defaultVisible: false, priority: 9 },
    { id: 'saldo_qtde_contrato', label: 'Saldo Qtde', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 10 },
    { id: 'unidade', label: 'Unidade', category: 'itens', type: 'text', isRawData: true, defaultVisible: false, priority: 11 },
    { id: 'valor_unitario', label: 'Valor Unitário', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 12 },
    { id: 'total', label: 'Total', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 13 },
    { id: 'cod_estruturado', label: 'Cód. Estruturado', category: 'itens', type: 'code', isRawData: true, defaultVisible: false, priority: 14 },
    { id: 'origem', label: 'Origem', category: 'identificacao', type: 'text', isRawData: true, defaultVisible: false, priority: 15 },
    { id: 'liberado', label: 'Liberado', category: 'status', type: 'badge', isRawData: true, defaultVisible: false, priority: 16 },
    { id: 'data_inicio', label: 'Data Início', category: 'datas', type: 'date', isRawData: true, defaultVisible: false, priority: 17 },
    { id: 'qtde_apropriada', label: 'Qtde Apropriada', category: 'valores', type: 'number', align: 'right', isRawData: true, defaultVisible: false, priority: 18 },
    { id: 'valor_apropriacao', label: 'Valor Apropriação', category: 'valores', type: 'currency', align: 'right', isRawData: true, defaultVisible: false, priority: 19 },
    { id: 'saldo_qtde_convertida', label: 'Saldo Qtde Convertida', category: 'valores', type: 'number', align: 'right', isRawData: true, defaultVisible: false, priority: 20 },
    { id: 'obra_nome', label: 'Nome da Obra', category: 'identificacao', type: 'text', defaultVisible: false, priority: 21 },
  ],

  // 3. ANÁLISE DE SALDO — REALIZADO
  analise_realizado: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'documento', label: 'Documento', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'data_documento', label: 'Data Doc.', category: 'datas', type: 'date', defaultVisible: true, priority: 4 },
    { id: 'cod_item_compra', label: 'Cód. Insumo/Item Compra', category: 'insumos', type: 'code', isRawData: true, defaultVisible: false, priority: 5 },
    { id: 'desc_item_compra', label: 'Descrição Insumo/Compra', category: 'insumos', type: 'text', isRawData: true, defaultVisible: false, priority: 6 },
    { id: 'ap', label: 'AP', category: 'identificacao', type: 'code', defaultVisible: true, priority: 7 },
    { id: 'fornecedor', label: 'Fornecedor', category: 'identificacao', type: 'text', defaultVisible: true, priority: 8 },
    { id: 'cod_item', label: 'Cód. Item', category: 'itens', type: 'code', isRawData: true, defaultVisible: false, priority: 9 },
    { id: 'descricao', label: 'Descrição', category: 'itens', type: 'text', isRawData: true, defaultVisible: false, priority: 10 },
    { id: 'unidade', label: 'Unidade', category: 'itens', type: 'text', isRawData: true, defaultVisible: false, priority: 11 },
    { id: 'valor_apropriacao', label: 'Valor Apropriação', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 12 },
    { id: 'cod_estruturado', label: 'Cód. Estruturado', category: 'itens', type: 'code', isRawData: true, defaultVisible: false, priority: 13 },
    { id: 'serie_da_ap', label: 'Série AP', category: 'identificacao', type: 'text', isRawData: true, defaultVisible: false, priority: 14 },
    { id: 'cod_fornecedor', label: 'Cód. Fornecedor', category: 'identificacao', type: 'code', isRawData: true, defaultVisible: false, priority: 15 },
    { id: 'qtde_apropriada', label: 'Qtde Apropriada', category: 'valores', type: 'number', align: 'right', isRawData: true, defaultVisible: false, priority: 16 },
    { id: 'obra_nome', label: 'Nome da Obra', category: 'identificacao', type: 'text', defaultVisible: false, priority: 17 },
  ],

  // 4. PEDIDOS DE COMPRA
  pedidos_compra: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'numero_do_pedido', label: 'Nº Pedido', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'item_pedido', label: 'Item', category: 'identificacao', type: 'number', defaultVisible: true, priority: 4 },
    { id: 'situacao_do_pedido', label: 'Situação', category: 'status', type: 'badge', defaultVisible: true, priority: 5 },
    { id: 'dt_emissao', label: 'Dt. Emissão', category: 'datas', type: 'date', defaultVisible: true, priority: 6 },
    { id: 'nome_fantasia', label: 'Fornecedor', category: 'identificacao', type: 'text', defaultVisible: true, priority: 7 },
    { id: 'descricao_do_item', label: 'Descrição do Item', category: 'itens', type: 'text', defaultVisible: true, priority: 8 },
    { id: 'quantidade', label: 'Qtde', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 9 },
    { id: 'total_pedido_compra', label: 'Total Pedido', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 10 },
    { id: 'obra_nome', label: 'Nome da Obra', category: 'identificacao', type: 'text', defaultVisible: false, priority: 11 },
  ],

  // 5. VISUALIZAÇÃO DE ITENS
  visualizacao_itens: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'orcamento', label: 'Orçamento', category: 'identificacao', type: 'text', defaultVisible: true, priority: 3 },
    { id: 'solicitacao', label: 'Solicitação', category: 'identificacao', type: 'code', defaultVisible: true, priority: 4 },
    { id: 'sequencia', label: 'Seq', category: 'identificacao', type: 'number', defaultVisible: true, priority: 5 },
    { id: 'situacao_do_item', label: 'Situação', category: 'status', type: 'badge', defaultVisible: true, priority: 6 },
    { id: 'fornecedor', label: 'Fornecedor', category: 'identificacao', type: 'text', defaultVisible: true, priority: 7 },
    { id: 'cod_item', label: 'Cód. Item', category: 'itens', type: 'code', defaultVisible: true, priority: 8 },
    { id: 'descricao', label: 'Descrição', category: 'itens', type: 'text', defaultVisible: true, priority: 9 },
    { id: 'qtde_solicitada', label: 'Qtde Solicitada', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 10 },
    { id: 'data_de_necessidade', label: 'Data Necessidade', category: 'datas', type: 'date', defaultVisible: true, priority: 11 },
    { id: 'valor_total', label: 'Valor Total', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 12 },
    { id: 'cod_pedido', label: 'Cód. Pedido', category: 'identificacao', type: 'code', defaultVisible: true, priority: 13 },
    { id: 'cod_contrato', label: 'Cód. Contrato', category: 'identificacao', type: 'code', defaultVisible: true, priority: 14 },
  ],

  // 6. ITENS SOLICITADOS
  itens_solicitados: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'codigo_solicitacao', label: 'Cód. Solicitação', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'numero_rm', label: 'Nº RM', category: 'identificacao', type: 'code', defaultVisible: true, priority: 4 },
    { id: 'sequencial_item', label: 'Seq', category: 'identificacao', type: 'number', defaultVisible: true, priority: 5 },
    { id: 'data_de_emissao', label: 'Dt. Emissão', category: 'datas', type: 'date', defaultVisible: true, priority: 6 },
    { id: 'situacao_do_item', label: 'Situação', category: 'status', type: 'badge', defaultVisible: true, priority: 7 },
    { id: 'descricao_do_item', label: 'Descrição do Item', category: 'itens', type: 'text', defaultVisible: true, priority: 8 },
    { id: 'quantidade_solicitada', label: 'Qtde Solicitada', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 9 },
    { id: 'quantidade_baixada', label: 'Qtde Baixada', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 10 },
    { id: 'unidade', label: 'Unidade', category: 'itens', type: 'text', defaultVisible: true, priority: 11 },
  ],

  // 7. SOLICITAÇÕES POR ETAPA
  solicitacoes_por_etapa: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'codigo_solicitacao', label: 'Cód. Solicitação', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'sequencial_item', label: 'Seq', category: 'identificacao', type: 'number', defaultVisible: true, priority: 4 },
    { id: 'codigo_etapa', label: 'Código Etapa', category: 'itens', type: 'code', defaultVisible: true, priority: 5 },
    { id: 'numero_insumo', label: 'Insumo', category: 'insumos', type: 'code', defaultVisible: true, priority: 6 },
    { id: 'descricao_insumo', label: 'Descrição do Insumo', category: 'insumos', type: 'text', defaultVisible: true, priority: 7 },
    { id: 'projeto', label: 'Projeto', category: 'identificacao', type: 'text', defaultVisible: true, priority: 8 },
    { id: 'data_de_emissao', label: 'Dt. Emissão', category: 'datas', type: 'date', defaultVisible: true, priority: 9 },
    { id: 'data_de_necessidade', label: 'Dt. Necessidade', category: 'datas', type: 'date', defaultVisible: true, priority: 10 },
    { id: 'situacao_do_item', label: 'Situação', category: 'status', type: 'badge', defaultVisible: true, priority: 11 },
    { id: 'obra_nome', label: 'Nome da Obra', category: 'identificacao', type: 'text', defaultVisible: false, priority: 12 },
  ],

  // 8. STATUS DAS CARGAS
  cargas: [
    { id: 'id', label: 'ID', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'relatorio', label: 'Relatório', category: 'identificacao', type: 'text', defaultVisible: true, priority: 3 },
    { id: 'arquivo', label: 'Arquivo', category: 'identificacao', type: 'text', defaultVisible: true, priority: 4 },
    { id: 'bloqueado', label: 'Status', category: 'status', type: 'badge', defaultVisible: true, priority: 5 },
    { id: 'obras_ok', label: 'Obras OK', category: 'outros', type: 'text', defaultVisible: true, priority: 6 },
    { id: 'obras_sem_movimento', label: 'Obras Sem Movimento', category: 'outros', type: 'text', defaultVisible: true, priority: 7 },
    { id: 'obras_falhou', label: 'Obras Falhou', category: 'outros', type: 'text', defaultVisible: true, priority: 8 },
    { id: 'motivo_bloqueio', label: 'Motivo', category: 'outros', type: 'text', defaultVisible: true, priority: 9 },
    { id: 'executado_em', label: 'Executado Em', category: 'datas', type: 'date', defaultVisible: true, priority: 10 },
  ],

  // 9. FOLLOW_ITENSCONTRATOS — ITENS DE CONTRATOS
  follow_itenscontratos_itens: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'cod_contrato', label: 'Contrato', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'cod_item', label: 'Item', category: 'identificacao', type: 'code', defaultVisible: true, priority: 4 },
    { id: 'aditivo', label: 'Aditivo', category: 'identificacao', type: 'text', defaultVisible: true, priority: 5 },
    { id: 'descricao', label: 'Descrição', category: 'itens', type: 'text', defaultVisible: true, priority: 6 },
    { id: 'unidade', label: 'Unidade', category: 'itens', type: 'text', defaultVisible: true, priority: 7 },
    { id: 'quantidade', label: 'Quantidade', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 8 },
    { id: 'valor_unitario', label: 'Valor Unitário', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 9 },
    { id: 'total_item', label: 'Total do Item', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 10 },
    { id: 'total_contratado', label: 'Total Contratado', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 11 },
    { id: 'situacao', label: 'Situação', category: 'status', type: 'badge', defaultVisible: true, priority: 12 },
    { id: 'cod_alternativo', label: 'Código Alternativo', category: 'identificacao', type: 'code', defaultVisible: false, priority: 13 },
    { id: 'consolidador', label: 'Consolidador', category: 'identificacao', type: 'text', defaultVisible: false, priority: 14 },
    { id: 'cod_agrupador', label: 'Código Agrupador', category: 'identificacao', type: 'code', defaultVisible: false, priority: 15 },
    { id: 'item_alternativo', label: 'Item Alternativo', category: 'itens', type: 'text', defaultVisible: false, priority: 16 },
    { id: 'cod_padrao', label: 'Código Padrão', category: 'itens', type: 'code', defaultVisible: false, priority: 17 },
    { id: 'cod_unidade', label: 'Código Unidade', category: 'itens', type: 'code', defaultVisible: false, priority: 18 },
    { id: 'obra_nome', label: 'Nome da Obra', category: 'identificacao', type: 'text', defaultVisible: false, priority: 19 },
  ],

  // 10. FOLLOW_ITENSCONTRATOS — MEDIÇÕES DE CONTRATOS
  follow_itenscontratos_medicoes: [
    { id: 'obra', label: 'Obra', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'numero_contrato', label: 'Contrato', category: 'identificacao', type: 'code', defaultVisible: true, priority: 3 },
    { id: 'numero_medicao', label: 'Medição', category: 'identificacao', type: 'code', defaultVisible: true, priority: 4 },
    { id: 'item_sequencial', label: 'Item', category: 'identificacao', type: 'number', defaultVisible: true, priority: 5 },
    { id: 'descricao_servico', label: 'Descrição do Serviço', category: 'itens', type: 'text', defaultVisible: true, priority: 6 },
    { id: 'unidade', label: 'Unidade', category: 'itens', type: 'text', defaultVisible: true, priority: 7 },
    { id: 'quantidade_medida', label: 'Quantidade Medida', category: 'valores', type: 'number', align: 'right', defaultVisible: true, priority: 8 },
    { id: 'valor_unitario', label: 'Valor Unitário', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 9 },
    { id: 'valor_total', label: 'Valor Total', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 10 },
    { id: 'valor_faturado', label: 'Valor Faturado', category: 'valores', type: 'currency', align: 'right', defaultVisible: true, priority: 11 },
    { id: 'fornecedor_nome', label: 'Fornecedor', category: 'identificacao', type: 'text', defaultVisible: true, priority: 12 },
    { id: 'situacao_medicao', label: 'Situação', category: 'status', type: 'badge', defaultVisible: true, priority: 13 },
    { id: 'periodo_inicio', label: 'Início do Período', category: 'datas', type: 'date', defaultVisible: false, priority: 14 },
    { id: 'periodo_fim', label: 'Fim do Período', category: 'datas', type: 'date', defaultVisible: false, priority: 15 },
    { id: 'fornecedor_cnpj', label: 'CNPJ', category: 'identificacao', type: 'text', defaultVisible: false, priority: 16 },
    { id: 'data_emissao', label: 'Data de Emissão', category: 'datas', type: 'date', defaultVisible: false, priority: 17 },
    { id: 'inss', label: 'INSS', category: 'valores', type: 'currency', align: 'right', defaultVisible: false, priority: 18 },
    { id: 'iss', label: 'ISS', category: 'valores', type: 'currency', align: 'right', defaultVisible: false, priority: 19 },
    { id: 'irrf', label: 'IRRF', category: 'valores', type: 'currency', align: 'right', defaultVisible: false, priority: 20 },
    { id: 'caucao', label: 'Caução', category: 'valores', type: 'currency', align: 'right', defaultVisible: false, priority: 21 },
    { id: 'obra_nome', label: 'Nome da Obra', category: 'identificacao', type: 'text', defaultVisible: false, priority: 22 },
  ],

  // 11. FOLLOW_ITENSCONTRATOS — HISTÓRICO DE CARGAS
  follow_itenscontratos_historico: [
    { id: 'id', label: 'ID', category: 'identificacao', type: 'code', defaultVisible: true, priority: 1 },
    { id: 'data_extracao', label: 'Data Extração', category: 'datas', type: 'date', defaultVisible: true, priority: 2 },
    { id: 'relatorio', label: 'Relatório', category: 'identificacao', type: 'text', defaultVisible: true, priority: 3 },
    { id: 'arquivo', label: 'Arquivo', category: 'identificacao', type: 'text', defaultVisible: true, priority: 4 },
    { id: 'bloqueado', label: 'Status', category: 'status', type: 'badge', defaultVisible: true, priority: 5 },
    { id: 'obras_ok', label: 'Obras OK', category: 'outros', type: 'text', defaultVisible: true, priority: 6 },
    { id: 'obras_sem_movimento', label: 'Sem Movimento', category: 'outros', type: 'text', defaultVisible: true, priority: 7 },
    { id: 'obras_falhou', label: 'Obras com Falha', category: 'outros', type: 'text', defaultVisible: true, priority: 8 },
    { id: 'motivo_bloqueio', label: 'Motivo', category: 'outros', type: 'text', defaultVisible: true, priority: 9 },
    { id: 'executado_em', label: 'Executado Em', category: 'datas', type: 'date', defaultVisible: true, priority: 10 },
  ],
}

// Presets de Visões Nativas
export function getPresetViews(tableKey: string): SavedView[] {
  const allCols = TABLE_COLUMNS[tableKey] || []
  const defaultCols = allCols.filter((c) => c.defaultVisible).map((c) => c.id)

  const presets: SavedView[] = [
    {
      id: 'preset_padrao',
      name: 'Padrão do Sistema',
      tableKey,
      columns: defaultCols,
      isDefaultPreset: true,
    },
  ]

  // Para tabelas com insumos (Análise de Saldo), adiciona o preset "Com Insumos"
  const hasInsumos = allCols.some((c) => c.category === 'insumos')
  if (hasInsumos) {
    let insumoCols: string[] = []
    if (tableKey === 'analise_pedidos') {
      insumoCols = [
        'obra',
        'data_extracao',
        'codigo_pedido',
        'cod_insumo',
        'descricao_insumo',
        'fornecedor',
        'cod_item',
        'descricao',
        'qtde_pedido',
        'unidade',
        'valor_unitario',
        'qtde_apropriada',
        'valor_apropriacao',
        'situacao_do_item',
      ]
    } else if (tableKey === 'analise_contratos') {
      insumoCols = [
        'obra',
        'data_extracao',
        'codigo_contrato',
        'cod_insumo',
        'descricao_insumo',
        'fornecedor',
        'status_pre_contrato',
        'cod_item',
        'descricao',
        'saldo_qtde_contrato',
        'unidade',
        'valor_unitario',
        'total',
      ]
    } else if (tableKey === 'analise_realizado') {
      insumoCols = [
        'obra',
        'data_extracao',
        'documento',
        'data_documento',
        'cod_item_compra',
        'desc_item_compra',
        'fornecedor',
        'ap',
        'cod_item',
        'descricao',
        'unidade',
        'valor_apropriacao',
      ]
    } else {
      insumoCols = allCols.map((c) => c.id)
    }

    presets.push({
      id: 'preset_insumos',
      name: 'Com Insumos (Recomendada)',
      tableKey,
      columns: insumoCols.filter((id) => allCols.some((c) => c.id === id)),
      isDefaultPreset: true,
    })
  }

  // Preset completo com todas as colunas
  presets.push({
    id: 'preset_completa',
    name: 'Todas as Colunas',
    tableKey,
    columns: allCols.map((c) => c.id),
    isDefaultPreset: true,
  })

  return presets
}

// Chaves de armazenamento no localStorage
const STORAGE_PREFIX_VIEWS = 'dadosprevision_mega_views_'
const STORAGE_PREFIX_ACTIVE = 'dadosprevision_mega_active_view_'

export function getCustomSavedViews(tableKey: string): SavedView[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX_VIEWS}${tableKey}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error(`Erro ao carregar visões salvas para ${tableKey}:`, e)
    return []
  }
}

export function getAllViews(tableKey: string): SavedView[] {
  return [...getPresetViews(tableKey), ...getCustomSavedViews(tableKey)]
}

export function saveCustomView(tableKey: string, name: string, columns: string[]): SavedView {
  const existing = getCustomSavedViews(tableKey)
  const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const newView: SavedView = {
    id,
    name: name.trim() || `Visão ${existing.length + 1}`,
    tableKey,
    columns,
    isDefaultPreset: false,
    createdAt: new Date().toISOString(),
  }

  const updated = [...existing, newView]
  try {
    localStorage.setItem(`${STORAGE_PREFIX_VIEWS}${tableKey}`, JSON.stringify(updated))
  } catch (e) {
    console.error(`Erro ao salvar visão no localStorage:`, e)
  }
  return newView
}

export function updateCustomView(tableKey: string, viewId: string, name: string, columns: string[]): SavedView | null {
  const existing = getCustomSavedViews(tableKey)
  const idx = existing.findIndex((v) => v.id === viewId)
  if (idx < 0) return null

  existing[idx] = {
    ...existing[idx],
    name: name.trim() || existing[idx].name,
    columns,
  }

  try {
    localStorage.setItem(`${STORAGE_PREFIX_VIEWS}${tableKey}`, JSON.stringify(existing))
  } catch (e) {
    console.error(`Erro ao atualizar visão no localStorage:`, e)
  }
  return existing[idx]
}

export function deleteCustomView(tableKey: string, viewId: string): void {
  const existing = getCustomSavedViews(tableKey)
  const filtered = existing.filter((v) => v.id !== viewId)
  try {
    localStorage.setItem(`${STORAGE_PREFIX_VIEWS}${tableKey}`, JSON.stringify(filtered))
  } catch (e) {
    console.error(`Erro ao deletar visão do localStorage:`, e)
  }
}

export function getActiveViewSelection(tableKey: string): { activeViewId: string | null; columns: string[] } {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX_ACTIVE}${tableKey}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.columns) && parsed.columns.length > 0) {
        return {
          activeViewId: parsed.activeViewId || null,
          columns: parsed.columns,
        }
      }
    }
  } catch (e) {
    console.error(`Erro ao ler visão ativa de ${tableKey}:`, e)
  }

  // Fallback para preset recomendado se tiver insumos, senão padrão
  const presets = getPresetViews(tableKey)
  const defaultPreset = presets.find((p) => p.id === 'preset_insumos') || presets[0]
  return {
    activeViewId: defaultPreset.id,
    columns: defaultPreset.columns,
  }
}

export function setActiveViewSelection(tableKey: string, activeViewId: string | null, columns: string[]): void {
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX_ACTIVE}${tableKey}`,
      JSON.stringify({ activeViewId, columns }),
    )
  } catch (e) {
    console.error(`Erro ao salvar visão ativa de ${tableKey}:`, e)
  }
}
