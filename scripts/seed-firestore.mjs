import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const serviceAccountPath = process.argv[2]

if (!serviceAccountPath) {
  console.error('Uso: npm run seed:firestore -- caminho/para/service-account.json')
  process.exit(1)
}

const absolutePath = path.resolve(serviceAccountPath)
const serviceAccount = JSON.parse(await readFile(absolutePath, 'utf8'))

initializeApp({
  credential: cert(serviceAccount),
})

const db = getFirestore()

const projetoInicial = {
  id_prevision: 'exemplo-001',
  nome_projeto: 'Projeto exemplo',
  empresa_nome: 'Empresa exemplo',
  data_inicio: '2026-01-01',
  data_fim: '2026-12-31',
  status: 'Ativo',
  desativado: false,
  criado_em: new Date().toISOString(),
}

await db.collection('prevision_projetos').doc(String(projetoInicial.id_prevision)).set(projetoInicial)

const savedDoc = await db.collection('prevision_projetos').doc(String(projetoInicial.id_prevision)).get()

console.log('Colecao prevision_projetos criada/atualizada com documento exemplo-001.')
console.log(savedDoc.exists ? 'Documento confirmado no Firestore.' : 'Documento nao encontrado apos escrita.')
