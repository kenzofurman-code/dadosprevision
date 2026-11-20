import test from 'node:test'
import assert from 'node:assert/strict'
import { dataRestricao, prepararRestricoes, carregarRestricoes } from '../src/lib/restricoes.ts'

const row = (values = {}) => ({
  projeto_id: 'p1',
  projeto_nome: 'Qoya',
  id_prevision: '1',
  titulo: 'Liberar projeto',
  vencimento_em: '2026-11-04',
  ...values,
})

test('faixas de prazo usam dias civis, com hoje separado do atraso', () => {
  const dates = [
    '2026-10-04',
    '2026-10-06',
    '2026-10-28',
    '2026-10-29',
    '2026-11-04',
    '2026-11-05',
    '2026-11-12',
    '2026-11-13',
    null,
    '2026-02-30',
  ]
  const cards = prepararRestricoes(
    dates.map((date, i) => row({ id_prevision: String(i), vencimento_em: date })),
    '2026-11-05',
  )
  const expected = [
    'mais30',
    'de8a30',
    'de8a30',
    'de1a7',
    'de1a7',
    'hoje',
    'proximos7',
    'futuro',
    'semData',
    'semData',
  ]
  for (let i = 0; i < dates.length; i++)
    assert.equal(cards.find((c) => c.codigo === String(i)).faixa, expected[i])
  assert.equal(cards.find((c) => c.codigo === '4').dias, -1)
  assert.equal(dataRestricao('2024-02-29T00:00:00Z'), '2024-02-29')
  assert.equal(dataRestricao('2026-02-30'), null)
  assert.throws(() => prepararRestricoes([], '2026-02-30'))
})

test('conclusão por data ou fase done prevalece sobre vencimento antigo e checklist pendente', () => {
  for (const completion of [{ concluido_em: '2026-11-01' }, { etapa_fase: 'done' }]) {
    const [card] = prepararRestricoes(
      [row({ ...completion, checklist_itens: [{ status: false, vencimento_em: '2026-10-01' }] })],
      '2026-11-05',
    )
    assert.equal(card.concluida, true)
    assert.equal(card.checklistAtrasados, 0)
  }
})

test('um card por projeto/id, sem multiplicar pelo checklist, com responsáveis e pendências próprias', () => {
  const source = row({
    usuarios: [{ nome: 'Ana' }],
    checklist_itens: JSON.stringify([
      {
        id_prevision: '1',
        descricao: 'Aprovar',
        status: false,
        vencimento_em: '2026-11-01',
        responsavel_nome: 'Bruno',
      },
      { id_prevision: '2', status: true, vencimento_em: '2026-10-01' },
      { id_prevision: '3', status: false, vencimento_em: '2026-11-05' },
    ]),
  })
  const cards = prepararRestricoes([source, source, row({ projeto_id: 'p2' })], '2026-11-05')
  assert.equal(cards.length, 2)
  assert.notEqual(cards[0].id, cards[1].id)
  assert.equal(cards[0].checklist.length, 3)
  assert.equal(cards[0].checklistAtrasados, 1)
  assert.deepEqual(cards[0].responsaveis, ['Ana'])
  assert.equal(cards[0].checklist[0].responsavel, 'Bruno')
})

test('card sem data preserva o prazo original e usa o checklist pendente para o alerta', () => {
  const [card] = prepararRestricoes(
    [
      row({
        vencimento_em: null,
        atraso_dias: 99,
        checklist_itens: [{ status: false, vencimento_em: '2026-11-01' }],
      }),
    ],
    '2026-11-05',
  )
  assert.equal(card.prazo, null)
  assert.equal(card.prazoControle, '2026-11-01')
  assert.equal(card.dias, -4)
  assert.equal(card.faixa, 'de1a7')
  assert.equal(card.checklistAtrasados, 1)
})

test('várias etapas vencidas geram um único card atrasado mesmo com prazo da mãe no futuro', () => {
  const cards = prepararRestricoes(
    [
      row({
        vencimento_em: '2026-11-24',
        checklist_itens: [
          { id_prevision: '1', descricao: 'Cotação', status: false, vencimento_em: '2026-10-02' },
          {
            id_prevision: '2',
            descricao: 'Negociação',
            status: false,
            vencimento_em: '2026-11-10',
          },
          {
            id_prevision: '3',
            descricao: 'Emissão OC',
            status: false,
            vencimento_em: '2026-11-16',
          },
        ],
      }),
    ],
    '2026-11-19',
  )
  assert.equal(cards.length, 1)
  assert.equal(cards.filter((c) => !c.concluida && c.dias !== null && c.dias < 0).length, 1)
  assert.equal(cards[0].checklistAtrasados, 3)
  assert.equal(cards[0].prazo, '2026-11-24')
  assert.equal(cards[0].prazoControle, '2026-10-02')
  assert.equal(cards[0].prazoCardAtrasado, false)
  assert.equal(cards[0].dias, -48)
  assert.equal(cards[0].faixa, 'mais30')
  assert.deepEqual(
    cards[0].checklist.map((i) => i.dias),
    [-48, -9, -3],
  )
})

test('mãe e checklist atrasados contam uma vez; itens concluídos não definem a faixa', () => {
  const [card] = prepararRestricoes(
    [
      row({
        vencimento_em: '2026-11-10',
        checklist_itens: [
          { id_prevision: '1', status: true, vencimento_em: '2026-01-01' },
          { id_prevision: '2', status: false, vencimento_em: '2026-11-16' },
        ],
      }),
    ],
    '2026-11-19',
  )
  assert.equal(card.prazoCardAtrasado, true)
  assert.equal(card.checklistAtrasados, 1)
  assert.equal(card.prazoControle, '2026-11-10')
  assert.equal(card.dias, -9)
  assert.equal(card.faixa, 'de8a30')
})

test('checklist pendente antecipa o próximo alerta; sem nenhum prazo permanece sem data', () => {
  const [card] = prepararRestricoes(
    [
      row({
        vencimento_em: '2026-12-10',
        checklist_itens: [
          { status: false, vencimento_em: '2026-11-22' },
          { status: true, vencimento_em: '2026-11-01' },
        ],
      }),
    ],
    '2026-11-19',
  )
  assert.equal(card.prazoControle, '2026-11-22')
  assert.equal(card.faixa, 'proximos7')
  const [undated] = prepararRestricoes(
    [row({ vencimento_em: null, checklist_itens: [{ status: false, vencimento_em: null }] })],
    '2026-11-19',
  )
  assert.equal(undated.prazoControle, null)
  assert.equal(undated.faixa, 'semData')
})

test('consulta todas as páginas; falha não publica contagem parcial', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url))
    return {
      ok: true,
      json: async () => ({
        records: [row({ id_prevision: String(requests.length) })],
        hasMore: requests.length === 1,
      }),
    }
  })
  assert.equal((await carregarRestricoes(new AbortController().signal)).length, 2)
  assert.match(requests[1], /page=1/)
  globalThis.fetch.mock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ records: [], hasMore: true }),
  }))
  await assert.rejects(carregarRestricoes(new AbortController().signal), /incompletos/)
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false }))
  await assert.rejects(carregarRestricoes(new AbortController().signal), /consultar/)
})
