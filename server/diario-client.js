// Cliente HTTP da API externa do Diário de Obra: token no header, teto de requisições por minuto e repetição em 429.

const BASE = 'https://apiexterna.diariodeobra.app/v1'

export function criarCliente({
  token,
  base = BASE,
  fetchImpl = fetch,
  agora = Date.now,
  dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  porMinuto = 130,
  esperaApos429 = 65000,
  tentativas429 = 5,
  timeoutMs = 60000,
} = {}) {
  if (!token) throw new Error('TOKEN_DIARIO não configurado.')
  let marcas = []

  async function respeitarLimite() {
    for (;;) {
      const t = agora()
      marcas = marcas.filter((m) => t - m < 60000)
      if (marcas.length < porMinuto) break
      await dormir(60000 - (t - marcas[0]) + 200)
    }
    marcas.push(agora())
  }

  async function get(caminho) {
    for (let tentativa = 0; ; tentativa++) {
      await respeitarLimite()
      let res
      try {
        res = await fetchImpl(base + caminho, { headers: { token }, signal: AbortSignal.timeout(timeoutMs) })
      } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error(`Diário de Obra não respondeu em ${caminho}`)
        throw err
      }
      if (res.status === 429 && tentativa < tentativas429) {
        await dormir(esperaApos429)
        continue
      }
      if (!res.ok) throw new Error(`Diário de Obra respondeu ${res.status} em ${caminho}`)
      return res.json()
    }
  }

  return { get }
}
