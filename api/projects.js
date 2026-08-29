import { readCollection } from '../lib/firestore-reader.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Metodo nao permitido.' })
  }

  try {
    const projects = (await readCollection('prevision_projetos'))
      .map(({ restricoes: _restrictions, ...project }) => project)
      .sort((first, second) =>
        String(first.nome_projeto || '').localeCompare(String(second.nome_projeto || ''), 'pt-BR'),
      )

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json({ ok: true, projects })
  } catch (error) {
    console.error(error)
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Erro ao carregar projetos do Firestore.',
    })
  }
}
