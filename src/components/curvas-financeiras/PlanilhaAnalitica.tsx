import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import './PlanilhaAnalitica.css'
import { RastreioPlanilha } from './RastreioPlanilha'
import type { Fluxo } from './rastreio'

// Matriz mensal de cada etapa nível 5: [comp. material, comp. MO, fin. material, fin. MO]
interface EtapaAnalitica {
  codigo_etapa: string
  codigo_prevision?: string | null
  nome: string
  mensal?: Record<string, number[]>
  fluxos?: Fluxo[]
  eventosEconomico?: Array<{ mes: string; valor: number }>
}

interface Props {
  etapas: EtapaAnalitica[]
  hierarquia: Array<{ codigo: string; nome: string; nivel: number }>
  meses: string[]
  nomeArquivo: string
}

type Medida = 'comp_mat' | 'comp_mo' | 'comp_total' | 'fin_mat' | 'fin_mo' | 'fin_total'

const MEDIDAS: Record<Medida, { rotulo: string; indices: number[] }> = {
  comp_mat: { rotulo: 'Material — competência', indices: [0] },
  comp_mo: { rotulo: 'Mão de obra — competência', indices: [1] },
  comp_total: { rotulo: 'Competência total', indices: [0, 1] },
  fin_mat: { rotulo: 'Material — financeiro', indices: [2] },
  fin_mo: { rotulo: 'Mão de obra — financeiro', indices: [3] },
  fin_total: { rotulo: 'Financeiro total', indices: [2, 3] },
}

interface Linha {
  codigo: string
  nome: string
  nivel: number
  valores: number[]
  total: number
}

const moeda = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (v: number) => (Math.abs(v) < 0.005 ? '-' : moeda.format(v))
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rotuloMes = (m: string) => `${NOMES_MES[Number(m.slice(5, 7)) - 1] || m.slice(5, 7)}/${m.slice(2, 4)}`

export function PlanilhaAnalitica({ etapas, hierarquia, meses, nomeArquivo }: Props) {
  const [medida, setMedida] = useState<Medida>('comp_total')
  const [nivelMax, setNivelMax] = useState(5)
  const [modo, setModo] = useState<'medida' | 'rastreio'>('medida')
  const [mostrarVazias, setMostrarVazias] = useState(false)

  const semDetalhe = etapas.length > 0 && etapas.every((e) => !e.mensal)
  const semFluxos = etapas.length > 0 && etapas.every((e) => !e.fluxos)

  // Cada etapa nível 5 soma seus valores nela mesma e em todas as etapas-mãe existentes (prefixo do código)
  const { linhas, totalGeral } = useMemo(() => {
    const { indices } = MEDIDAS[medida]
    const idxMes = new Map(meses.map((m, i) => [m, i]))
    const porCodigo = new Map<string, Linha>()
    const nova = (codigo: string, nome: string, nivel: number): Linha => ({
      codigo, nome, nivel, valores: meses.map(() => 0), total: 0,
    })
    for (const h of hierarquia) porCodigo.set(h.codigo, nova(h.codigo, h.nome, Number(h.nivel)))
    const totalGeral = nova('', 'TOTAL GERAL', 0)

    for (const et of etapas) {
      const codigo = et.codigo_prevision || et.codigo_etapa
      const folha = nova(codigo, et.nome, 5)
      porCodigo.set(codigo, folha)
      const segs = codigo.split('.')
      const alvos = [folha, totalGeral]
      for (let k = 1; k < segs.length; k++) {
        const mae = porCodigo.get(segs.slice(0, k).join('.'))
        if (mae) alvos.push(mae)
      }
      for (const [mes, v] of Object.entries(et.mensal || {})) {
        const i = idxMes.get(mes)
        if (i === undefined) continue
        const valor = indices.reduce((s, k) => s + (v[k] || 0), 0)
        for (const a of alvos) {
          a.valores[i] += valor
          a.total += valor
        }
      }
    }
    const linhas = [...porCodigo.values()].sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
    return { linhas, totalGeral }
  }, [etapas, hierarquia, meses, medida])

  // Só etapas com valor no período, a menos que o usuário peça para ver todas
  const visiveis = useMemo(
    () => linhas.filter((l) => l.nivel <= nivelMax && (mostrarVazias || l.valores.some((v) => Math.abs(v) >= 0.005))),
    [linhas, nivelMax, mostrarVazias]
  )

  function exportarCsv() {
    const cab = ['Código', 'Descrição', 'Nível', ...meses, 'Total']
    const corpo = [...visiveis, totalGeral].map((l) => [
      l.codigo,
      `"${l.nome.replace(/"/g, '""')}"`,
      l.nivel || '',
      ...l.valores.map((v) => v.toFixed(2)),
      l.total.toFixed(2),
    ])
    const csv = [`Medida: ${MEDIDAS[medida].rotulo}`, cab.join(';'), ...corpo.map((r) => r.join(';'))].join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${nomeArquivo}_${medida}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <section className="curvas-fin-table-panel">
      <div className="curvas-fin-table-actions pa-controles">
        <div className="pa-modos" role="tablist">
          <button type="button" role="tab" aria-selected={modo === 'medida'} onClick={() => setModo('medida')}>Por medida</button>
          <button type="button" role="tab" aria-selected={modo === 'rastreio'} onClick={() => setModo('rastreio')}>Rastreio</button>
        </div>
        <label>
          <input type="checkbox" checked={mostrarVazias} onChange={(e) => setMostrarVazias(e.target.checked)} /> Mostrar etapas sem valor
        </label>
        {modo === 'medida' && (<>
        <label>
          Medida{' '}
          <select value={medida} onChange={(e) => setMedida(e.target.value as Medida)}>
            {(Object.keys(MEDIDAS) as Medida[]).map((m) => (
              <option key={m} value={m}>{MEDIDAS[m].rotulo}</option>
            ))}
          </select>
        </label>
        <label>
          Mostrar até{' '}
          <select value={nivelMax} onChange={(e) => setNivelMax(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>Nível {n}</option>
            ))}
          </select>
        </label>
        <button type="button" className="curvas-fin-btn curvas-fin-btn-secondary" onClick={exportarCsv}>
          <Download size={14} /> Baixar CSV
        </button>
        </>)}
      </div>

      {modo === 'rastreio' && (semFluxos ? (
        <p className="pa-aviso">
          O rastreio não fica guardado nas versões salvas. Volte ao cálculo atual (Recalcular) para rastrear os valores.
        </p>
      ) : (
        <RastreioPlanilha etapas={etapas} hierarquia={hierarquia} meses={meses} mostrarVazias={mostrarVazias} />
      ))}

      {modo === 'medida' && (<>

      {semDetalhe && (
        <p className="pa-aviso">
          Esta versão foi salva antes da planilha analítica existir e não guarda o detalhe por etapa. Volte ao cálculo atual para vê-la.
        </p>
      )}

      <div className="curvas-fin-table-scroll pa-scroll">
        <table className="curvas-fin-data-table pa-tabela">
          <thead>
            <tr>
              <th className="col-left pa-fixa">EAP</th>
              {meses.map((m) => <th key={m}>{rotuloMes(m)}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.codigo} className={`pa-n${l.nivel}`}>
                <td className="col-left pa-fixa" style={{ paddingLeft: 8 + (l.nivel - 1) * 14 }} title={l.nome}>
                  <span className="pa-cod">{l.codigo}</span> {l.nome}
                </td>
                {l.valores.map((v, i) => <td key={meses[i]}>{fmt(v)}</td>)}
                <td className="pa-total">{fmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="col-left pa-fixa">TOTAL GERAL</td>
              {totalGeral.valores.map((v, i) => <td key={meses[i]}>{fmt(v)}</td>)}
              <td className="pa-total">{fmt(totalGeral.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      </>)}
    </section>
  )
}
