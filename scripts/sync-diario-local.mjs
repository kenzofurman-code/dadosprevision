// Carga manual do Diário de Obra (primeira carga leva ~20 min por causa do limite de 150 req/min).
// Uso: npm run sync:diario   (usa TOKEN_DIARIO e as variáveis PG* do .env / ambiente)
import dotenv from 'dotenv'
import { initDb } from '../server/db.js'
import { criarCliente } from '../server/diario-client.js'
import { executarSincronizacaoDiario } from '../server/diario-sync.js'
import { repoDiario } from '../server/diario-db.js'

dotenv.config()
await initDb()
const resultado = await executarSincronizacaoDiario({
  client: criarCliente({ token: process.env.TOKEN_DIARIO }),
  repo: repoDiario,
  log: console.log,
})
console.log(JSON.stringify({ ...resultado, erros: resultado.erros?.slice(0, 10) }, null, 2))
process.exit(resultado.status === 'erro' ? 1 : 0)
