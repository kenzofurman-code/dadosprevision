import { useEffect, useState } from "react"
import { PALETA, TRACOS, type DefCurva, type EstiloTraco } from "../../lib/curvas-utils"

interface Props {
  titulo: string
  descricao: string
  iniciais: DefCurva[]
  outras?: string[]
  permiteRemover?: boolean
  rotuloConfirmar: string
  onConfirmar: (defs: DefCurva[]) => void
  onCancelar: () => void
}

const ESTILOS = Object.keys(TRACOS) as EstiloTraco[]

export function CurveEditorModal({
  titulo,
  descricao,
  iniciais,
  outras = [],
  permiteRemover = false,
  rotuloConfirmar,
  onConfirmar,
  onCancelar,
}: Props) {
  const [linhas, setLinhas] = useState<DefCurva[]>(iniciais)

  useEffect(() => {
    setLinhas(iniciais)
  }, [iniciais])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelar()
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onCancelar])

  function altera(i: number, campo: Partial<DefCurva>) {
    setLinhas((prev) => prev.map((l, k) => (k === i ? { ...l, ...campo } : l)))
  }

  function remove(nome: string) {
    setLinhas((prev) => prev.filter((l) => l.nome !== nome).map((l) => (l.ref === nome ? { ...l, ref: null } : l)))
  }

  const candidatasRef = [...linhas.map((l) => l.nome), ...outras]

  return (
    <div className="curvas-modal-fundo" role="dialog" aria-modal="true" aria-label={titulo} onClick={onCancelar}>
      <div className="curvas-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{titulo}</h2>
        <p className="curvas-modal-sub">{descricao}</p>

        <div className="curvas-reg-lista">
          {linhas.map((l, i) => (
            <div className="curvas-reg-linha" key={l.nome}>
              <strong title={l.nome}>{l.nome}</strong>

              <div className="curvas-reg-cores" role="group" aria-label={"Cor de " + l.nome}>
                {PALETA.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={"curvas-reg-cor" + (l.cor === c ? " ativa" : "")}
                    style={{ background: c }}
                    aria-label={c}
                    aria-pressed={l.cor === c}
                    onClick={() => altera(i, { cor: c })}
                  />
                ))}
              </div>

              <label>
                <span>Traço</span>
                <select value={l.traco} onChange={(e) => altera(i, { traco: e.target.value as EstiloTraco })}>
                  {ESTILOS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Comparar com</span>
                <select value={l.ref ?? ""} onChange={(e) => altera(i, { ref: e.target.value || null })}>
                  <option value="">nenhuma</option>
                  {candidatasRef
                    .filter((n) => n !== l.nome)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                </select>
              </label>

              {permiteRemover && (
                <button
                  type="button"
                  className="curvas-reg-remover"
                  aria-label={"Remover " + l.nome}
                  title="Remover do cadastro"
                  onClick={() => remove(l.nome)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {!linhas.length && <p className="curvas-modal-sub">O cadastro não pode ficar vazio.</p>}

        <div className="curvas-modal-acoes">
          <button type="button" className="matrix-btn" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className="matrix-btn btn-primary"
            disabled={!linhas.length}
            onClick={() => onConfirmar(linhas)}
          >
            {rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
