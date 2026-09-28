// Acesso a banco da Gestão de Contratações. Regras puras em ./contratacoes.js.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { query, withTransaction } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PADRAO = JSON.parse(fs.readFileSync(path.join(__dirname, 'contratacoes-padrao.json'), 'utf8'))

export async function carregarPadraoSeVazio() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM contratacao_grupos WHERE projeto_id IS NULL')
  if (rows[0].n > 0) return 0
  await withTransaction(async (q) => {
    for (const g of PADRAO.grupos) {
      const { rows: [novo] } = await q(
        `INSERT INTO contratacao_grupos (projeto_id, tipo, item, insumos, pacote_servicos, ordem,
           prazo_levantamento, prazo_solicitacao, prazo_negociacao, prazo_emissao, prazo_entrega)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [g.tipo, g.item, g.insumos, g.pacote_servicos, g.ordem, g.prazos.levantamento,
          g.prazos.solicitacao, g.prazos.negociacao, g.prazos.emissao, g.prazos.entrega],
      )
      for (const e of g.etapas) {
        await q(
          `INSERT INTO contratacao_grupo_etapas (grupo_id, projeto_id, codigo_etapa, nivel, nome_padrao)
           VALUES ($1, NULL, $2, $3, $4)`,
          [novo.id, e.codigo, e.nivel, e.nome],
        )
      }
    }
  })
  return PADRAO.grupos.length
}
