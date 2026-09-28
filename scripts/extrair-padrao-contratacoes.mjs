// scripts/extrair-padrao-contratacoes.mjs
// Uso: node scripts/extrair-padrao-contratacoes.mjs "<caminho da planilha do Nizza>"
// Gera server/contratacoes-padrao.json (padrão de grupos de contratação).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'

const arquivo = process.argv[2]
if (!arquivo) {
  console.error('Informe o caminho da planilha do Nizza.')
  process.exit(1)
}
const wb = XLSX.readFile(arquivo)
const linhas = (aba) => XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null })
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim())
const numero = (v) => (typeof v === 'number' ? Math.round(v) : Number(String(v ?? '').replace(',', '.')) || 0)
const nivel = (c) => c.split('.').length
const ehCodigo = (c) => /^\d{2}(\.\d{2,3}){1,4}$/.test(c)

// Nomes das etapas pela aba CUSTOS: coluna F (código) e G (descrição).
const nomes = new Map()
for (const r of linhas('CUSTOS').slice(1)) {
  const codigo = texto(r[5])
  if (ehCodigo(codigo) && !nomes.has(codigo)) nomes.set(codigo, texto(r[6]))
}

const grupos = []
let ordem = 0
for (const r of linhas('MATERIAIS').slice(5)) {
  if (!texto(r[2])) continue
  const etapas = []
  for (const v of r.slice(18, 23)) {
    const codigo = texto(v)
    if (!ehCodigo(codigo) || ![4, 5].includes(nivel(codigo))) continue
    if (etapas.some((e) => e.codigo === codigo)) continue
    etapas.push({ codigo, nivel: nivel(codigo), nome: nomes.get(codigo) || '' })
  }
  grupos.push({
    ordem: ++ordem, tipo: 'MATERIAL', item: texto(r[2]), insumos: texto(r[3]) || null,
    pacote_servicos: texto(r[4]) || null,
    prazos: { levantamento: numero(r[5]), solicitacao: numero(r[6]), negociacao: numero(r[7]), emissao: numero(r[8]), entrega: numero(r[9]) },
    etapas,
  })
}
for (const r of linhas('MÃO DE OBRA').slice(5)) {
  if (!texto(r[2])) continue
  grupos.push({
    ordem: ++ordem, tipo: 'MAO_DE_OBRA', item: texto(r[2]), insumos: null,
    pacote_servicos: texto(r[3]) || null,
    prazos: { levantamento: numero(r[4]), solicitacao: 0, negociacao: numero(r[6]), emissao: numero(r[7]), entrega: numero(r[5]) },
    etapas: [],
  })
}

const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'contratacoes-padrao.json')
fs.writeFileSync(destino, JSON.stringify({ origem: path.basename(arquivo), grupos }, null, 2) + '\n', 'utf8')
const mat = grupos.filter((g) => g.tipo === 'MATERIAL')
console.log(`grupos: ${grupos.length} (material ${mat.length}, mão de obra ${grupos.length - mat.length}); etapas: ${mat.reduce((s, g) => s + g.etapas.length, 0)}`)
