import { useEffect, useRef, useState } from "react"
import { fmtCelula, normPct, rotMes, type DefCurva, type Ponto } from "../../lib/curvas-utils"

interface Props {
  obra: string
  disp: Record<string, Ponto[]>
  defs: DefCurva[]
  meses: string[]
  janela: Set<string>
  mudadas: Set<string>
  onEditar: (versao: string, mes: string, valor: number | null) => void
  onFechar: () => void
}

export function CurveDataDrawer({ obra, disp, defs, meses, janela, mudadas, onEditar, onFechar }: Props) {
  const [apenasJanela, setApenasJanela] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onFechar])

  const cols = defs.filter((d) => disp[d.nome])
  const linhasMes = apenasJanela ? meses.filter((m) => janela.has(m)) : meses

  const mapa: Record<string, Record<string, number>> = {}
  cols.forEach((d) => {
    mapa[d.nome] = Object.fromEntries(disp[d.nome] || [])
  })

  return (
    <div className="curvas-gaveta" id="gaveta" aria-label="Tabela de dados de avanço">
      <div className="curvas-g-topo">
        <strong>{obra}</strong>
        <span className="curvas-g-sub">
          {linhasMes.length} meses · {cols.length}
          {cols.length === 1 ? " curva" : " curvas"}
        </span>
        <span className="curvas-g-legenda">
          <i /> meses no período visível
        </span>
        <button
          type="button"
          className="matrix-btn"
          aria-pressed={apenasJanela}
          onClick={() => setApenasJanela((v) => !v)}
        >
          {apenasJanela ? "Todos os meses" : "Só o período"}
        </button>
        <button
          type="button"
          className="curvas-g-fechar"
          aria-label="Fechar tabela"
          onClick={onFechar}
        >
          ✕
        </button>
      </div>
      <div className="curvas-g-rolagem">
        <table className="curvas-g-tabela">
          <thead>
            <tr>
              <th className="col-data">Data</th>
              {cols.map((d) => (
                <th key={d.nome}>
                  <span className="pt" style={{ background: d.cor }} />
                  {d.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhasMes.map((m) => (
              <tr key={m} className={janela.has(m) ? "naJanela" : undefined}>
                <td className="col-data">{rotMes(m)}</td>
                {cols.map((d) => (
                  <td key={d.nome}>
                    <Celula
                      valor={mapa[d.nome]?.[m] ?? null}
                      mudou={mudadas.has(d.nome + "|" + m)}
                      onCommit={(val) => onEditar(d.nome, m, val)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Celula({
  valor,
  mudou,
  onCommit,
}: {
  valor: number | null
  mudou: boolean
  onCommit: (valor: number | null) => void
}) {
  const [raw, setRaw] = useState(() => fmtCelula(valor))
  const [erro, setErro] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRaw(fmtCelula(valor))
    setErro(false)
  }, [valor])

  function aplica() {
    const bruto = raw.trim()
    if (bruto === "" || bruto === "—") {
      setErro(false)
      onCommit(null)
      return
    }
    const val = normPct(bruto)
    if (val == null || !isFinite(val)) {
      setErro(true)
      return
    }
    setErro(false)
    setRaw(fmtCelula(val))
    onCommit(val)
  }

  function moveFoco(passo: number) {
    const td = ref.current?.closest("td")
    const tr = td?.parentElement
    if (!td || !tr) return
    const col = Array.from(tr.children).indexOf(td)
    const alvo = (passo > 0 ? tr.nextElementSibling : tr.previousElementSibling) as HTMLTableRowElement | null
    if (alvo?.children[col]) {
      alvo.children[col].querySelector("input")?.focus()
    }
  }

  return (
    <input
      ref={ref}
      inputMode="decimal"
      placeholder="—"
      className={[mudou ? "mudou" : "", erro ? "erro" : ""].filter(Boolean).join(" ")}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={aplica}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          aplica()
          moveFoco(1)
        }
        if (e.key === "ArrowDown" && !e.altKey) {
          e.preventDefault()
          moveFoco(1)
        }
        if (e.key === "ArrowUp" && !e.altKey) {
          e.preventDefault()
          moveFoco(-1)
        }
      }}
    />
  )
}
