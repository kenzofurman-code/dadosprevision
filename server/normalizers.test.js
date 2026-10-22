import assert from 'node:assert/strict'
import test from 'node:test'
import { pointSeries } from './normalizers.js'

const datas = ['2024-07-31', '2024-08-31', '2024-09-30', '2024-10-31', '2024-11-30', '2024-12-31', '2025-01-31']

test('pontos da Prevision entram no mês da data deles (x), não pela posição na lista', () => {
  // etapa que começa em dez/2024: a Prevision manda os pontos a partir do próprio mês
  const serie = pointSeries([{ x: '2024-12-31', y: 0.6 }, { x: '2025-01-31', y: 0.4 }], datas)
  assert.equal(serie.length, datas.length)
  assert.deepEqual(serie.map((p) => p.y), [0, 0, 0, 0, 0, 0.6, 0.4])
})

test('casa pelo mês mesmo quando o dia do x difere da lista de datas', () => {
  const serie = pointSeries([{ x: '2024-09-15T00:00:00Z', y: 1 }], datas)
  assert.deepEqual(serie.map((p) => p.y), [0, 0, 1, 0, 0, 0, 0])
})

test('ponto sem data cai pela posição (formato antigo)', () => {
  assert.deepEqual(pointSeries([{ y: 2 }, { y: 3 }], datas).map((p) => p.y), [2, 3, 0, 0, 0, 0, 0])
})

test('ponto fora do período da lista vai para a ponta mais próxima, sem perder valor', () => {
  const serie = pointSeries([{ x: '2024-05-31', y: 1 }, { x: '2025-03-31', y: 2 }], datas)
  assert.equal(serie[0].y, 1)
  assert.equal(serie[6].y, 2)
})
