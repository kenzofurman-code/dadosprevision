import { getDb } from '../lib/firebase-admin.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Metodo nao permitido.' })
  }

  try {
    const snapshot = await getDb().collection('prevision_projetos').get()
    const projects = snapshot.docs
      .map((doc) => ({ ...doc.data(), firestore_id: doc.id }))
      .sort((first, second) =>
        String(first.nome_projeto || '').localeCompare(String(second.nome_projeto || ''), 'pt-BR'),
      )

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      ok: true,
      projects,
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao carregar projetos do Firestore.',
    })
  }
}
