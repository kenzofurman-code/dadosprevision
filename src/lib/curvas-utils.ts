export type Ponto = [mes: string, pct: number]
export type PorObra = Record<string, Record<string, Ponto[]>>

export const TRACOS = {
  sólido: "none",
  tracejado: "7 4",
  pontilhado: "0.1 5",
  "pontilhado largo": "0.1 7",
} as const

export type EstiloTraco = keyof typeof TRACOS

export interface DefCurva {
  nome: string
  cor: string
  traco: EstiloTraco
  ref: string | null
}

export const DEFS_PADRAO: DefCurva[] = [
  { nome: "Planejamento R00", cor: "#14532D", traco: "sólido", ref: "Realizado engenharia" },
  { nome: "Replanejado", cor: "#E01B24", traco: "sólido", ref: "Realizado engenharia" },
  { nome: "Realizado engenharia", cor: "#2B6CB0", traco: "sólido", ref: null },
  { nome: "Curva SFH", cor: "#4FA871", traco: "pontilhado", ref: "Realizado SFH" },
  { nome: "Curva SFH ANTERIOR", cor: "#8FC7A3", traco: "pontilhado largo", ref: "Realizado SFH" },
  { nome: "Projeção SFH", cor: "#E01B24", traco: "tracejado", ref: "Realizado SFH" },
  { nome: "Realizado SFH", cor: "#6BA6D9", traco: "pontilhado", ref: null },
]

export const PALETA = [
  "#14532D",
  "#E01B24",
  "#2B6CB0",
  "#4FA871",
  "#8FC7A3",
  "#6BA6D9",
  "#B45309",
  "#7C3AED",
  "#0F766E",
  "#BE185D",
  "#0284C7",
  "#D97706",
  "#4338CA",
  "#059669",
]

export const CINZA = "#5A6169"

export const achaDef = (defs: DefCurva[], nome: string) => defs.find((d) => d.nome === nome)
export const corDe = (defs: DefCurva[], nome: string) => achaDef(defs, nome)?.cor ?? CINZA
export const tracoDe = (defs: DefCurva[], nome: string) => TRACOS[achaDef(defs, nome)?.traco ?? "sólido"]
export const larguraDe = (defs: DefCurva[], nome: string) =>
  (achaDef(defs, nome)?.traco ?? "sólido") === "sólido" ? 2.2 : 3.2

export const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

export const fmt = (p: number) =>
  (p * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"

export const fmtCelula = (p: number | null | undefined) =>
  p == null ? "" : (p * 100).toFixed(2).replace(".", ",") + "%"

export const rotMes = (m: string) => {
  if (!m) return "-"
  const [y, mm] = m.split("-")
  if (!y || !mm) return m
  return (MES[+mm - 1] || mm) + "/" + y.slice(2)
}

const semAcento = (t: unknown) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()

const APELIDOS: Record<string, string> = {
  realizado: "Realizado engenharia",
  "realizado obra": "Realizado engenharia",
  "realizado físico": "Realizado engenharia",
  "planejado": "Planejamento R00",
  "planejamento": "Planejamento R00",
  "base": "Planejamento R00",
  "curva base": "Planejamento R00",
  "curva prevista": "Replanejado",
  "previsto": "Replanejado",
  "projecao sfh": "Projeção SFH",
}

export const canonVersao = (v: string) => APELIDOS[semAcento(v)] || String(v).trim()

export type Row = [obra: string, data: string, versao: string, pct: number]

export function indexa(linhas: Row[]): { porObra: PorObra; obras: string[] } {
  const po: PorObra = {}
  const vistas = new Map<string, string>()
  const maiusc = (x: string) => (String(x).match(/[A-ZÀ-Þ]/g) || []).length

  for (const [o] of linhas) {
    const t = String(o).trim()
    const k = semAcento(t)
    const atual = vistas.get(k)
    if (!atual || maiusc(t) > maiusc(atual)) vistas.set(k, t)
  }

  for (const [o, m, v, p] of linhas) {
    if (o == null || v == null || p == null) continue
    const oc = vistas.get(semAcento(o)) || String(o).trim()
    const vc = canonVersao(v)
    ;(po[oc] ??= {})
    ;(po[oc][vc] ??= []).push([m, p])
  }

  for (const o in po) {
    for (const v in po[o]) {
      po[o][v].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    }
  }

  const obras = Object.keys(po).sort((a, b) => a.localeCompare(b, "pt-BR"))
  return { porObra: po, obras }
}

export function mesesDaObra(disp: Record<string, Ponto[]>): string[] {
  return [...new Set(Object.values(disp).flat().map((p) => p[0]))].sort()
}

const EPOCH = Date.UTC(1899, 11, 30)

export function normData(x: unknown): string | null {
  if (x == null || x === "") return null
  if (x instanceof Date) return x.getUTCFullYear() + "-" + String(x.getUTCMonth() + 1).padStart(2, "0")
  if (typeof x === "number") {
    const d = new Date(EPOCH + Math.round(x) * 864e5)
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0")
  }
  const t = String(x).trim()
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    let a = +m[3]
    if (a < 100) a += 2000
    return a + "-" + m[2].padStart(2, "0")
  }
  m = t.match(/^(\d{4})-(\d{2})/)
  if (m) return m[1] + "-" + m[2]
  m = t.match(/^([a-zç]{3})[a-zç]*[-/ ]+(\d{2,4})$/i)
  if (m) {
    const en = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ")
    const pt = "jan fev mar abr mai jun jul ago set out nov dez".split(" ")
    const k = m[1].toLowerCase()
    let i = en.indexOf(k)
    if (i < 0) i = pt.indexOf(k)
    if (i < 0) return null
    let a = +m[2]
    if (a < 100) a += 2000
    return a + "-" + String(i + 1).padStart(2, "0")
  }
  return null
}

export function normPct(x: unknown): number | null {
  if (x == null || x === "") return null
  if (typeof x === "number") return x > 1.5 ? x / 100 : x
  const t = String(x).trim().replace(/\s|%/g, "").replace(/\./g, "").replace(",", ".")
  const n = Number.parseFloat(t)
  if (!isFinite(n)) return null
  return String(x).includes("%") ? n / 100 : n > 1.5 ? n / 100 : n
}

export interface ParseResult {
  linhas: Row[]
  vazias: number
  semData: number
  semValor: number
  truncou: boolean
  ultima: number
}

const LIMITE = 5000

export function matrizParaLinhas(matriz: unknown[][]): ParseResult {
  let hi = -1
  let col: { o?: number; m?: number; v?: number; p?: number } = {}
  for (let i = 0; i < Math.min(matriz.length, 30); i++) {
    const c: { o?: number; m?: number; v?: number; p?: number } = {}
    ;(matriz[i] || []).forEach((h, j) => {
      const k = semAcento(h)
      if (k === "empreendimento" || k === "obra" || k === "projeto") c.o = j
      else if (k === "data" || k === "mes" || k === "competencia" || k === "periodo") c.m = j
      else if (k === "versao" || k === "curva" || k === "tipo") c.v = j
      else if (k.includes("real%") || k.includes("percentual") || k.includes("avanco") || k.includes("acumulad") || k === "%") c.p = j
    })
    if (c.o != null && c.m != null && c.v != null) {
      hi = i
      col = c
      break
    }
  }
  if (hi < 0) throw new Error("Cabeçalho não encontrado (esperado: Empreendimento / Data / Versão / Percentual)")
  if (col.p == null) col.p = Math.max(col.o!, col.m!, col.v!) + 1

  const linhas: Row[] = []
  let vazias = 0
  let semData = 0
  let semValor = 0
  const fim = Math.min(matriz.length, hi + 1 + LIMITE)

  for (let i = hi + 1; i < fim; i++) {
    const r = matriz[i] || []
    const o = r[col.o!]
    const v = r[col.v!]
    if (o == null || o === "" || v == null || v === "") {
      vazias++
      continue
    }
    const m = normData(r[col.m!])
    const p = normPct(r[col.p!])
    if (m == null) {
      semData++
      continue
    }
    if (p == null) {
      semValor++
      continue
    }
    linhas.push([String(o).trim(), m, String(v).trim(), p])
  }

  if (!linhas.length) throw new Error("Nenhuma linha de dados válida encontrada abaixo do cabeçalho.")
  return { linhas, vazias, semData, semValor, truncou: matriz.length > hi + 1 + LIMITE, ultima: fim }
}

export function csvParaMatriz(txt: string): unknown[][] {
  const primeira = txt.split("\n")[0] || ""
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ";" : ","
  const out: string[][] = []
  let lin: string[] = []
  let campo = ""
  let aspas = false
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]
    if (aspas) {
      if (c === '"') {
        if (txt[i + 1] === '"') {
          campo += '"'
          i++
        } else aspas = false
      } else campo += c
    } else if (c === '"') aspas = true
    else if (c === sep) {
      lin.push(campo)
      campo = ""
    } else if (c === "\n") {
      lin.push(campo)
      out.push(lin)
      lin = []
      campo = ""
    } else if (c !== "\r") campo += c
  }
  lin.push(campo)
  if (lin.length > 1 || lin[0]) out.push(lin)
  return out
}

export function carregaDefsLocal(): DefCurva[] {
  try {
    const raw = localStorage.getItem("dadosprevision_curvas_defs")
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.error("Erro ao carregar defs do localStorage:", e)
  }
  return DEFS_PADRAO
}

export function salvaDefsLocal(defs: DefCurva[]) {
  try {
    localStorage.setItem("dadosprevision_curvas_defs", JSON.stringify(defs))
  } catch (e) {
    console.error("Erro ao salvar defs no localStorage:", e)
  }
}
