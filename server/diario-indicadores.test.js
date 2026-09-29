import test from 'node:test'
import assert from 'node:assert/strict'
import { diasSemDiario, montarIndicadores } from './diario-indicadores.js'

test('diasSemDiario conta dias corridos sem relatório entre a primeira e a última data', () => {
  assert.deepEqual(diasSemDiario(['2026-08-01', '2026-08-02', '2026-08-05']), { corridos: 5, comDiario: 3, semDiario: 2 })
  assert.deepEqual(diasSemDiario(['2026-08-01', '2026-08-01']), { corridos: 1, comDiario: 1, semDiario: 0 })
})

test('diasSemDiario respeita o período pedido dentro do intervalo da obra', () => {
  const datas = ['2026-08-01', '2026-08-05', '2026-08-10']
  assert.deepEqual(diasSemDiario(datas, { inicio: '2026-08-03', fim: '2026-08-10' }), { corridos: 8, comDiario: 2, semDiario: 6 })
  assert.deepEqual(diasSemDiario(datas, { inicio: '2026-07-01', fim: '2026-12-31' }), { corridos: 10, comDiario: 3, semDiario: 7 })
})

test('diasSemDiario sem datas ou com período fora do intervalo devolve zeros', () => {
  const zeros = { corridos: 0, comDiario: 0, semDiario: 0 }
  assert.deepEqual(diasSemDiario([]), zeros)
  assert.deepEqual(diasSemDiario(['2026-08-01'], { inicio: '2026-09-01', fim: '2026-09-30' }), zeros)
})

test('diasSemDiario atravessa mês e ano sem erro de fuso', () => {
  assert.deepEqual(diasSemDiario(['2025-12-30', '2026-01-02']), { corridos: 4, comDiario: 2, semDiario: 2 })
})

test('montarIndicadores com entrada vazia devolve zeros e listas vazias (obra sem dados)', () => {
  const r = montarIndicadores({})
  assert.deepEqual(r.efetivo, { porDia: [], porEmpreiteira: [], porFuncao: [], homensDia: 0, diasComEfetivo: 0, mediaPorDia: 0 })
  assert.deepEqual(r.clima.totais, { relatorios: 0, chuvosos: 0, impraticaveis: 0, parados: 0, chuvaMm: 0 })
  assert.deepEqual(r.ocorrencias, { total: 0, relatorios: 0, porTag: [] })
  assert.equal(r.preenchimento.totais.semDiario, 0)
  assert.deepEqual(r.preenchimento.porObra, [])
})

test('montarIndicadores soma totais e converte nomes das colunas', () => {
  const r = montarIndicadores({
    efetivoDia: [{ data: '2026-08-01', total: 10 }, { data: '2026-08-02', total: '15' }],
    efetivoEmpreiteira: [{ chave: 'PEREIRA DECOL', rotulo: 'Pereira Decol', total: '25' }],
    efetivoFuncao: [{ rotulo: 'Pedreiro', total: 12 }],
    climaObra: [
      { obra_id: 'O1', obra_nome: 'Obra 1', relatorios: 2, chuvosos: 1, impraticaveis: 1, parados: 0, chuva_mm: '5.25' },
      { obra_id: 'O2', obra_nome: 'Obra 2', relatorios: 3, chuvosos: 2, impraticaveis: 0, parados: 1, chuva_mm: '0.2' },
    ],
    tags: [{ tag: 'Reunião', total: '4' }],
    ocorrenciaTotais: { ocorrencias: 7, relatorios: 5 },
    preenchimentoObra: [{
      obra_id: 'O1', obra_nome: 'Obra 1', relatorios: 3, aprovados: 2, em_revisao: 1, preenchendo: 0,
      pendentes_antigos: 1, datas: ['2026-08-01', '2026-08-02', '2026-08-04'],
    }],
  }, { dataInicio: null, dataFim: null })
  assert.equal(r.efetivo.homensDia, 25)
  assert.equal(r.efetivo.mediaPorDia, 12.5)
  assert.equal(r.efetivo.porDia[1].total, 15)
  assert.deepEqual(r.clima.totais, { relatorios: 5, chuvosos: 3, impraticaveis: 1, parados: 1, chuvaMm: 5.5 })
  assert.equal(r.ocorrencias.porTag[0].total, 4)
  assert.deepEqual(r.preenchimento.porObra[0], {
    obraId: 'O1', obraNome: 'Obra 1', relatorios: 3, aprovados: 2, emRevisao: 1, preenchendo: 0,
    pendentesAntigos: 1, corridos: 4, comDiario: 3, semDiario: 1,
  })
  assert.equal(r.preenchimento.totais.pendentesAntigos, 1)
  assert.equal(r.preenchimento.totais.semDiario, 1)
})
