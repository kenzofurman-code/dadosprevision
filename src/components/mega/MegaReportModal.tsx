import { useState } from 'react'
import {
  X,
  FileSpreadsheet,
  Printer,
  FileText,
  Download,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import {
  type MegaColumnDef,
  getRecordValue,
  formatDateIso,
  formatNumberValue,
  formatCurrencyValue,
} from './mega-columns'

interface MegaReportModalProps {
  isOpen: boolean
  onClose: () => void
  tableTitle: string
  tableKey: string
  selectedObra: string
  obraNome?: string
  search: string
  activeColumns: string[]
  allColumns: MegaColumnDef[]
  currentRecords: any[]
  totalRecords: number
  fetchFilteredRecords: (limit: number) => Promise<any[]>
}

export function MegaReportModal({
  isOpen,
  onClose,
  tableTitle,
  tableKey,
  selectedObra,
  obraNome,
  search,
  activeColumns,
  allColumns,
  currentRecords,
  totalRecords,
  fetchFilteredRecords,
}: MegaReportModalProps) {
  const [scope, setScope] = useState<'page' | 'all'>('all')
  const [columnsScope, setColumnsScope] = useState<'visible' | 'all'>('visible')
  const [isExporting, setIsExporting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  if (!isOpen) return null

  // Colunas a incluir no relatório
  const columnsToExport =
    columnsScope === 'visible'
      ? allColumns.filter((c) => activeColumns.includes(c.id))
      : allColumns

  // Função para buscar as linhas de acordo com o escopo
  const getRows = async (): Promise<any[]> => {
    if (scope === 'page') {
      return currentRecords
    }
    // Baixa até 5.000 registros para o relatório completo
    return await fetchFilteredRecords(5000)
  }

  // 1. Exportar para Excel (.xlsx)
  const handleExportXlsx = async () => {
    setIsExporting(true)
    setStatusMessage('Preparando dados para Excel...')
    try {
      const XLSX = await import('xlsx')
      const rows = await getRows()

      // Formatar linhas com os cabeçalhos legíveis e valores tratados
      const formattedData = rows.map((row) => {
        const item: Record<string, any> = {}
        columnsToExport.forEach((col) => {
          const val = getRecordValue(row, col)
          if (col.type === 'date') {
            item[col.label] = formatDateIso(val)
          } else if (col.type === 'currency' || col.type === 'number') {
            const num = Number(val)
            item[col.label] = Number.isFinite(num) ? num : val || ''
          } else {
            item[col.label] = val !== null && val !== undefined ? String(val) : ''
          }
        })
        return item
      })

      const ws = XLSX.utils.json_to_sheet(formattedData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Relatório Mega')

      const dateStr = new Date().toISOString().slice(0, 10)
      const fileName = `Relatorio_Mega_${tableKey}_Obra${selectedObra || 'Todas'}_${dateStr}.xlsx`
      XLSX.writeFile(wb, fileName)

      setStatusMessage('Planilha Excel gerada com sucesso!')
      setTimeout(() => {
        setStatusMessage(null)
        onClose()
      }, 1200)
    } catch (err) {
      console.error('Erro ao gerar relatório Excel:', err)
      setStatusMessage('Erro ao gerar planilha Excel.')
    } finally {
      setIsExporting(false)
    }
  }

  // 2. Exportar para CSV
  const handleExportCsv = async () => {
    setIsExporting(true)
    setStatusMessage('Gerando arquivo CSV...')
    try {
      const rows = await getRows()
      const headers = columnsToExport.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(';')

      const lines = rows.map((row) => {
        return columnsToExport
          .map((col) => {
            const val = getRecordValue(row, col)
            if (val === null || val === undefined) return '""'
            if (col.type === 'date') return `"${formatDateIso(val)}"`
            if (col.type === 'currency') return `"${formatCurrencyValue(val)}"`
            if (col.type === 'number') return `"${formatNumberValue(val)}"`
            return `"${String(val).replace(/"/g, '""')}"`
          })
          .join(';')
      })

      const csvContent = '\uFEFF' + [headers, ...lines].join('\r\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const dateStr = new Date().toISOString().slice(0, 10)
      link.setAttribute('href', url)
      link.setAttribute(
        'download',
        `Relatorio_Mega_${tableKey}_Obra${selectedObra || 'Todas'}_${dateStr}.csv`,
      )
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      setStatusMessage('CSV baixado com sucesso!')
      setTimeout(() => {
        setStatusMessage(null)
        onClose()
      }, 1200)
    } catch (err) {
      console.error('Erro ao gerar CSV:', err)
      setStatusMessage('Erro ao gerar arquivo CSV.')
    } finally {
      setIsExporting(false)
    }
  }

  // 3. Imprimir / Salvar como PDF
  const handlePrintPdf = async () => {
    setIsExporting(true)
    setStatusMessage('Preparando página de impressão...')
    try {
      const rows = await getRows()

      // Abre uma janela popup de impressão formatada com estilo da Piemonte
      const printWindow = window.open('', '_blank', 'width=1100,height=800')
      if (!printWindow) {
        alert('Por favor, autorize pop-ups para gerar a visualização de impressão.')
        setIsExporting(false)
        return
      }

      const dateStr = new Date().toLocaleString('pt-BR')
      const obraStr = selectedObra ? `Obra ${selectedObra} ${obraNome ? `— ${obraNome}` : ''}` : 'Todas as Obras'

      const tableHeadersHtml = columnsToExport
        .map(
          (c) =>
            `<th style="text-align: ${c.align === 'right' ? 'right' : 'left'}; padding: 6px 8px; border-bottom: 2px solid #334155; font-size: 11px; text-transform: uppercase;">${c.label}</th>`,
        )
        .join('')

      const tableRowsHtml = rows
        .map((row, idx) => {
          const cells = columnsToExport
            .map((c) => {
              const val = getRecordValue(row, c)
              let displayVal = '-'
              if (val !== null && val !== undefined) {
                if (c.type === 'date') displayVal = formatDateIso(val)
                else if (c.type === 'currency') displayVal = formatCurrencyValue(val)
                else if (c.type === 'number') displayVal = formatNumberValue(val)
                else displayVal = String(val)
              }
              return `<td style="text-align: ${c.align === 'right' ? 'right' : 'left'}; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${displayVal}</td>`
            })
            .join('')

          const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc'
          return `<tr style="background-color: ${bg};">${cells}</tr>`
        })
        .join('')

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Relatório Mega ERP - ${tableTitle}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; margin: 24px; line-height: 1.4; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #00b871; padding-bottom: 12px; margin-bottom: 16px; }
            .brand h2 { margin: 0; color: #143f38; font-size: 20px; }
            .brand p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
            .meta { text-align: right; font-size: 11px; color: #475569; }
            .filters-bar { background: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 16px; display: flex; gap: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            .footer { margin-top: 24px; font-size: 10px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 8px; }
            @media print {
              body { margin: 10mm; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="brand">
              <h2>PIEMONTE CONSTRUTORA</h2>
              <p>Relatório de Dados do Mega ERP — ${tableTitle}</p>
            </div>
            <div class="meta">
              <div><strong>Emitido em:</strong> ${dateStr}</div>
              <div><strong>Total de Linhas:</strong> ${rows.length} registros</div>
            </div>
          </div>

          <div class="filters-bar">
            <div><strong>Filtro de Obra:</strong> ${obraStr}</div>
            ${search ? `<div><strong>Busca:</strong> "${search}"</div>` : ''}
            <div><strong>Colunas:</strong> ${columnsToExport.length} colunas</div>
          </div>

          <table>
            <thead><tr>${tableHeadersHtml}</tr></thead>
            <tbody>${tableRowsHtml}</tbody>
          </table>

          <div class="footer">
            Piemonte Construtora • Dados Prevision & Mega ERP • Relatório emitido automaticamente
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
        </html>
      `

      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
      onClose()
    } catch (err) {
      console.error('Erro ao gerar visualização de impressão:', err)
      setStatusMessage('Erro ao preparar relatório para impressão.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="mega-modal-overlay" onClick={onClose}>
      <div className="mega-modal-container compact" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mega-modal-header">
          <div className="mega-modal-title">
            <FileSpreadsheet size={18} className="text-primary" />
            <div>
              <h3>Gerar Relatório — {tableTitle}</h3>
              <p>Exporte em Excel, PDF/Impressão ou CSV com a formatação escolhida</p>
            </div>
          </div>
          <button type="button" className="mega-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="mega-report-modal-body">
          {/* Configuração de Escopo de Linhas */}
          <div className="mega-report-config-section">
            <span className="mega-report-config-label">Escopo dos Registros:</span>
            <div className="mega-report-options-grid">
              <label
                className={`mega-report-option ${scope === 'all' ? 'active' : ''}`}
                onClick={() => setScope('all')}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                />
                <div>
                  <strong>Todos os Registros Filtrados</strong>
                  <small>
                    Exporta até {Math.min(5000, totalRecords)} registros da consulta
                  </small>
                </div>
              </label>

              <label
                className={`mega-report-option ${scope === 'page' ? 'active' : ''}`}
                onClick={() => setScope('page')}
              >
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'page'}
                  onChange={() => setScope('page')}
                />
                <div>
                  <strong>Apenas Página Atual</strong>
                  <small>{currentRecords.length} registros visíveis na tela</small>
                </div>
              </label>
            </div>
          </div>

          {/* Configuração de Colunas */}
          <div className="mega-report-config-section">
            <span className="mega-report-config-label">Colunas a Incluir:</span>
            <div className="mega-report-options-grid">
              <label
                className={`mega-report-option ${columnsScope === 'visible' ? 'active' : ''}`}
                onClick={() => setColumnsScope('visible')}
              >
                <input
                  type="radio"
                  name="colsScope"
                  checked={columnsScope === 'visible'}
                  onChange={() => setColumnsScope('visible')}
                />
                <div>
                  <strong>Colunas da Visão Atual</strong>
                  <small>{activeColumns.length} colunas configuradas na tabela</small>
                </div>
              </label>

              <label
                className={`mega-report-option ${columnsScope === 'all' ? 'active' : ''}`}
                onClick={() => setColumnsScope('all')}
              >
                <input
                  type="radio"
                  name="colsScope"
                  checked={columnsScope === 'all'}
                  onChange={() => setColumnsScope('all')}
                />
                <div>
                  <strong>Todas as Colunas Disponíveis</strong>
                  <small>{allColumns.length} colunas (incluindo insumos e raw_data)</small>
                </div>
              </label>
            </div>
          </div>

          {/* Botões de Ação de Exportação */}
          <div className="mega-report-actions-grid">
            <button
              type="button"
              className="mega-report-action-card primary"
              onClick={handleExportXlsx}
              disabled={isExporting}
            >
              <div className="mega-report-action-icon">
                <FileSpreadsheet size={22} />
              </div>
              <div className="mega-report-action-text">
                <strong>Exportar Planilha Excel (.xlsx)</strong>
                <span>Formato completo com formatação de valores e cabeçalhos</span>
              </div>
              <Download size={16} className="mega-report-action-arrow" />
            </button>

            <button
              type="button"
              className="mega-report-action-card"
              onClick={handlePrintPdf}
              disabled={isExporting}
            >
              <div className="mega-report-action-icon printer">
                <Printer size={22} />
              </div>
              <div className="mega-report-action-text">
                <strong>Imprimir / Salvar como PDF</strong>
                <span>Documento limpo com cabeçalho Piemonte pronto para impressão</span>
              </div>
              <Printer size={16} className="mega-report-action-arrow" />
            </button>

            <button
              type="button"
              className="mega-report-action-card"
              onClick={handleExportCsv}
              disabled={isExporting}
            >
              <div className="mega-report-action-icon csv">
                <FileText size={22} />
              </div>
              <div className="mega-report-action-text">
                <strong>Exportar Arquivo CSV</strong>
                <span>Formato texto separado por ponto e vírgula com UTF-8 BOM</span>
              </div>
              <Download size={16} className="mega-report-action-arrow" />
            </button>
          </div>

          {/* Feedback de status */}
          {statusMessage && (
            <div className="mega-report-status">
              {isExporting ? (
                <Loader2 size={16} className="mega-loading-spinner text-primary" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald" />
              )}
              <span>{statusMessage}</span>
            </div>
          )}
        </div>

        <div className="mega-modal-footer">
          <button type="button" className="mega-btn" onClick={onClose} disabled={isExporting}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
