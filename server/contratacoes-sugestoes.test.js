import test from 'node:test'
import assert from 'node:assert/strict'
import { sugerirGrupos } from './contratacoes-sugestoes.js'

const grupo = (id, item, insumos = null, tipo = 'MATERIAL', pacote_servicos = item) => ({ id, ordem: id, item, insumos, tipo, pacote_servicos })
const sugerir = (dados) => sugerirGrupos({ codigo: '01.04.01.04.001', nome: 'AÇO CA50', tipo: 'MATERIAL', ...dados })

test('aço da estrutura não recebe o primeiro grupo de infraestrutura com o mesmo nome', () => {
  const grupos = [grupo(1, 'INFRAESTRUTURA', 'AÇO RETO, CORTE E DOBRA', 'MATERIAL', 'CONTENÇÃO'), grupo(2, 'ESTRUTURA', 'AÇO RETO, CORTE E DOBRA')]
  const r = sugerir({ grupos, contexto: 'SUPRAESTRUTURA · CONCRETO ARMADO · ARMADURAS', referencias: [
    { grupo_id: 1, nome: 'AÇO CA50', codigo: '01.03.02.02.006' }, { grupo_id: 2, nome: 'AÇO CA50', codigo: '01.04.01.04.005' },
  ] })
  assert.equal(r.grupo_id, 2)
  assert.equal(r.alternativas[0].grupo_id, 1)
})

test('insumos discriminam aço e concreto mesmo com nome genérico da etapa', () => {
  const r = sugerir({ nome: 'Serviço de fundação', contexto: 'INFRAESTRUTURA',
    grupos: [grupo(1, 'INFRAESTRUTURA', 'AÇO RETO, ARAMES E TELAS'), grupo(2, 'INFRAESTRUTURA', 'CONCRETO, BOMBEAMENTO')],
    insumos: [{ descricao: 'CONCRETO BOMBEADO 30MPA', custo_projetado: 9000 }, { descricao: 'ARAME RECOZIDO', custo_projetado: 100 }] })
  assert.equal(r.grupo_id, 2)
  assert.match(r.motivo, /CONCRETO BOMBEADO/)
})

test('não cruza Material e MO nem usa insumos sem valor para decidir', () => {
  const r = sugerir({ nome: 'Serviço elétrico', tipo: 'MAO_DE_OBRA',
    grupos: [grupo(1, 'AÇO', 'VERGALHÃO'), grupo(2, 'INSTALAÇÕES ELÉTRICAS', null, 'MAO_DE_OBRA')],
    insumos: [{ descricao: 'VERGALHÃO AÇO CA50', custo_projetado: 0 }, { descricao: 'MO INSTALAÇÕES ELÉTRICAS', custo_projetado: 500 }] })
  assert.equal(r.grupo_id, 2)
})

test('MO de armaduras na supraestrutura não vira montagem de andaime', () => {
  const r = sugerir({ tipo: 'MAO_DE_OBRA', contexto: 'SUPRAESTRUTURA · CONCRETO ARMADO · ARMADURAS',
    grupos: [grupo(1, 'MONTAGEM DE ANDAIME', null, 'MAO_DE_OBRA'), grupo(2, 'ESTRUTURA', null, 'MAO_DE_OBRA')],
    insumos: [{ descricao: 'MO EXECUÇÃO DE ARMADURAS (MONTAGEM)', custo_projetado: 2000 }] })
  assert.equal(r.grupo_id, 2)
})

test('porcelanato de piso prioriza o detalhe de porcelanatos e evita fachada', () => {
  const r = sugerir({ nome: 'ASSENTAMENTO DE PORCELANATO EM PISO', contexto: 'REVESTIMENTO CERÂMICO · REVESTIMENTO DE PISO',
    grupos: [grupo(1, 'FACHADA', 'PORCELANATO'), grupo(2, 'REVEST. CERÂMICO', 'AZULEJOS PRIVATIVOS'), grupo(3, 'REVEST. CERÂMICO', 'PORCELANATOS PRIVATIVOS')],
    insumos: [{ descricao: 'PORCELANATO 60X60', custo_projetado: 1200 }] })
  assert.equal(r.grupo_id, 3)
})

test('empates exigem revisão, mantendo alternativas do mesmo tipo', () => {
  const r = sugerir({ grupos: [grupo(1, 'ESTRUTURA', 'AÇO'), grupo(2, 'ESTRUTURA', 'AÇO'), grupo(3, 'ESTRUTURA', 'AÇO', 'MAO_DE_OBRA')] })
  assert.equal(r.confianca, 'BAIXA')
  assert.deepEqual(r.alternativas.map((a) => a.grupo_id), [2])
})

test('não inventa destino para seguro sem grupo compatível, mesmo com contexto genérico', () => {
  assert.equal(sugerir({ nome: 'SEGURO DE RISCO ENGENHARIA', contexto: 'SERVIÇOS PRELIMINARES',
    grupos: [grupo(1, 'TOPOGRAFIA', null, 'MATERIAL', 'SERVIÇOS PRELIMINARES')] }), null)
  assert.equal(sugerir({ grupos: [] }), null)
})
