import test from 'node:test'
import assert from 'node:assert/strict'
import { diasSemDiario, montarIndicadores } from './diario-indicadores.js'

test('diasSemDiario conta dias corridos e úteis sem relatório no intervalo', () => {
  const r = diasSemDiario(['2026-08-01', '2026-08-02', '2026-08-05'])
  assert.equal(r.corridos, 5)
  assert.equal(r.comDiario, 3)
  assert.equal(r.semDiario, 2)
  assert.equal(r.diasUteis, 3)
  assert.equal(r.comDiarioUteis, 1) // 01 e 02 foram sábado e domingo; 05 foi quarta
  assert.equal(r.semDiarioUteis, 2) // segunda 03 e terça 04 sem diário
})

test('diasSemDiario respeita o período pedido e identifica dias sem diário aprovado', () => {
  const datas = ['2026-08-01', '2026-08-05', '2026-08-10']
  const aprovadas = ['2026-08-05']
  const r = diasSemDiario(datas, { inicio: '2026-08-03', fim: '2026-08-10', datasAprovadas: aprovadas })
  assert.equal(r.corridos, 8)
  assert.equal(r.comDiario, 2)
  assert.equal(r.semDiario, 6)
  assert.equal(r.diasUteis, 6) // 03, 04, 05, 06, 07, 10
  assert.equal(r.comDiarioUteis, 2)
  assert.equal(r.semDiarioUteis, 4)
  assert.equal(r.aprovadosUteis, 1)
  assert.equal(r.semAprovadoUteis, 5)
})

test('diasSemDiario sem datas devolve zeros se sem período', () => {
  const zeros = {
    corridos: 0, comDiario: 0, semDiario: 0,
    diasUteis: 0, comDiarioUteis: 0, semDiarioUteis: 0,
    aprovadosUteis: 0, semAprovadoUteis: 0,
  }
  assert.deepEqual(diasSemDiario([]), zeros)
})

test('diasSemDiario atravessa mês e ano sem erro de fuso', () => {
  const r = diasSemDiario(['2025-12-30', '2026-01-02'])
  assert.equal(r.corridos, 4)
  assert.equal(r.comDiario, 2)
  assert.equal(r.semDiario, 2)
})

test('montarIndicadores com entrada vazia devolve zeros e listas vazias (obra sem dados)', () => {
  const r = montarIndicadores({})
  assert.deepEqual(r.efetivo, { porDia: [], porEmpreiteira: [], porFuncao: [], mediaPorDia: 0, diasComDiario: 0 })
  assert.deepEqual(r.clima.totais, { relatorios: 0, chuvosos: 0, impraticaveis: 0, parados: 0, chuvaMm: 0 })
  assert.deepEqual(r.clima.porDia, [])
  assert.deepEqual(r.ocorrencias, { total: 0, relatorios: 0, porTag: [] })
  assert.equal(r.preenchimento.totais.semDiario, 0)
  assert.deepEqual(r.preenchimento.porObra, [])
})

test('montarIndicadores soma totais, converte nomes das colunas e arredonda médias de pessoas', () => {
  const r = montarIndicadores({
    efetivoDia: [{ data: '2026-08-01', total: 10 }, { data: '2026-08-02', total: '15' }],
    efetivoEmpreiteira: [{ chave: 'PEREIRA DECOL', rotulo: 'Pereira Decol', total: '25' }],
    efetivoFuncao: [{ rotulo: 'Pedreiro', total: 12 }],
    diasComDiario: 4,
    climaObra: [
      { obra_id: 'O1', obra_nome: 'Obra 1', relatorios: 2, chuvosos: 1, impraticaveis: 1, parados: 0, chuva_mm: '5.25' },
      { obra_id: 'O2', obra_nome: 'Obra 2', relatorios: 3, chuvosos: 2, impraticaveis: 0, parados: 1, chuva_mm: '0.2' },
    ],
    climaDia: [
      { data: '2026-08-01', total_obras: 2, chuvosos: 1, impraticaveis: 1, parados: 0, chuva_media_mm: 2.6, chuva_max_mm: 5.2 },
    ],
    tags: [{ tag: 'Reunião', total: '4' }],
    ocorrenciaTotais: { ocorrencias: 7, relatorios: 5 },
    preenchimentoObra: [{
      obra_id: 'O1', obra_nome: 'Obra 1', relatorios: 3, aprovados: 2, em_revisao: 1, preenchendo: 0,
      pendentes_antigos: 1, datas: ['2026-08-01', '2026-08-02', '2026-08-04'],
      datas_aprovadas: ['2026-08-01', '2026-08-04'],
    }],
  }, { dataInicio: null, dataFim: null })
  assert.equal(r.efetivo.porDia[1].total, 15)
  assert.equal(r.efetivo.diasComDiario, 4)
  assert.equal(r.efetivo.mediaPorDia, 6) // 25 homens-dia / 4 dias com diário = 6.25, arredondado para inteiro 6
  assert.deepEqual(r.efetivo.porEmpreiteira, [{ chave: 'PEREIRA DECOL', rotulo: 'Pereira Decol', media: 6 }])
  assert.deepEqual(r.efetivo.porFuncao, [{ rotulo: 'Pedreiro', media: 3 }])
  assert.deepEqual(r.clima.totais, { relatorios: 5, chuvosos: 3, impraticaveis: 1, parados: 1, chuvaMm: 5.5 })
  assert.equal(r.clima.porDia.length, 1)
  assert.equal(r.ocorrencias.porTag[0].total, 4)
  assert.equal(r.preenchimento.porObra[0].obraNome, 'Obra 1')
  assert.equal(r.preenchimento.porObra[0].corridos, 4)
  assert.equal(r.preenchimento.porObra[0].comDiario, 3)
  assert.equal(r.preenchimento.porObra[0].semDiario, 1)
  assert.equal(r.preenchimento.totais.pendentesAntigos, 1)
  assert.equal(r.preenchimento.totais.semDiario, 1)
})

test('montarIndicadores: sem dias com diário a média é zero (sem dividir por zero)', () => {
  const r = montarIndicadores({
    efetivoDia: [{ data: '2026-08-01', total: 10 }],
    efetivoEmpreiteira: [{ chave: 'X', rotulo: 'X', total: 10 }],
    efetivoFuncao: [{ rotulo: 'Y', total: 10 }],
    diasComDiario: 0,
  })
  assert.equal(r.efetivo.mediaPorDia, 0)
  assert.equal(r.efetivo.porEmpreiteira[0].media, 0)
  assert.equal(r.efetivo.porFuncao[0].media, 0)
})
