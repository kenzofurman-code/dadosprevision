import test from 'node:test'
import assert from 'node:assert/strict'
import { TABELAS, montarConsulta, validarData, montarUpsert } from './diario-consulta.js'

test('tabela desconhecida vira erro 400 (não vai para o SQL)', () => {
  assert.throws(() => montarConsulta('usuarios; DROP TABLE x'), (e) => e.status === 400 && /desconhecida/.test(e.message))
})

test('sem filtros: só exclui removidos, sem parâmetros de filtro', () => {
  const c = montarConsulta('relatorios')
  assert.match(c.contagem.sql, /FROM diario\.relatorio r JOIN diario\.obra o/)
  assert.match(c.contagem.sql, /WHERE r\.removido_em IS NULL/)
  assert.deepEqual(c.contagem.params, [])
  assert.deepEqual(c.dados.params, [50, 0])
  assert.match(c.dados.sql, /LIMIT \$1 OFFSET \$2/)
})

test('obra e busca entram como parâmetros posicionais, busca em minúsculas', () => {
  const c = montarConsulta('atividades', { obra: 'O1', search: '  Laje ', page: 2, pageSize: 25 })
  assert.deepEqual(c.contagem.params, ['O1', '%laje%'])
  assert.deepEqual(c.dados.params, ['O1', '%laje%', 25, 50])
  assert.match(c.dados.sql, /r\.obra_id = \$1/)
  assert.match(c.dados.sql, /LOWER\(a\.descricao\) LIKE \$2/)
  assert.match(c.dados.sql, /LIMIT \$3 OFFSET \$4/)
  assert.deepEqual(c.paginacao, { page: 2, pageSize: 25, offset: 50 })
})

test('cargas ignora filtro de obra e não filtra removidos', () => {
  const c = montarConsulta('cargas', { obra: 'O1' })
  assert.deepEqual(c.contagem.params, [])
  assert.doesNotMatch(c.contagem.sql, /WHERE/)
})

test('tamanho de página é limitado a 200 e valores absurdos caem no padrão', () => {
  assert.equal(montarConsulta('fotos', { pageSize: 9999 }).paginacao.pageSize, 200)
  assert.equal(montarConsulta('fotos', { pageSize: 'abc', page: -3 }).paginacao.pageSize, 50)
  assert.equal(montarConsulta('fotos', { pageSize: 'abc', page: -3 }).paginacao.page, 0)
})

test('toda coluna DATE selecionada é convertida para texto (o driver pg devolveria Date com fuso)', () => {
  for (const [nome, t] of Object.entries(TABELAS)) {
    if (nome === 'cargas') continue
    assert.match(t.select, /r\.data::text AS data/, nome)
    assert.doesNotMatch(t.select.replace(/r\.data::text AS data/g, ''), /\br\.data\b/, nome)
  }
})

test('toda consulta de relatório-filho devolve relatorio_id (a tela abre o diário pela linha)', () => {
  for (const [nome, t] of Object.entries(TABELAS)) {
    if (nome === 'cargas') continue
    assert.match(t.select, /r\.relatorio_id/, nome)
  }
})

test('validarData aceita AAAA-MM-DD real e vazio; rejeita o resto com 400', () => {
  assert.equal(validarData('2026-09-29', 'dataInicio'), '2026-09-29')
  assert.equal(validarData('', 'dataInicio'), null)
  assert.equal(validarData(undefined, 'dataInicio'), null)
  for (const ruim of ['29/09/2026', '2026-9-1', '2026-13-01', '2026-02-30', 'abc', "2026-01-01'; --"]) {
    assert.throws(() => validarData(ruim, 'dataInicio'), (e) => e.status === 400 && /dataInicio/.test(e.message), ruim)
  }
})

test('montarUpsert gera INSERT ... ON CONFLICT com jsonb e extras', () => {
  assert.equal(
    montarUpsert('t', ['id', 'nome', 'raw'], 'id', { jsonb: ['raw'], extras: [['em', 'now()']] }),
    'INSERT INTO t (id, nome, raw, em) VALUES ($1, $2, $3::jsonb, now()) ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, raw = EXCLUDED.raw, em = now()',
  )
})
