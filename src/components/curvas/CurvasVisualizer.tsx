import { useEffect, useMemo, useRef, useState } from "react"
import {
  FileSpreadsheet,
  Maximize2,
  Printer,
  RotateCcw,
  SlidersHorizontal,
  Table,
  Upload,
} from "lucide-react"
import {
  PALETA,
  rotMes,
  indexa,
  mesesDaObra,
  matrizParaLinhas,
  csvParaMatriz,
  carregaDefsLocal,
  salvaDefsLocal,
  type DefCurva,
  type EstiloTraco,
  type Ponto,
  type PorObra,
} from "../../lib/curvas-utils"
import { AdvanceChartSvg } from "./AdvanceChartSvg"
import { CurveDataDrawer } from "./CurveDataDrawer"
import { CurveEditorModal } from "./CurveEditorModal"

interface Props {
  projects: Array<{ id_prevision?: string; nome_projeto?: string }>
  selectedProject: string
  onSelectProject: (projectId: string) => void
  cffSummaries?: any[]
}

export function CurvasVisualizer({
  projects,
  selectedProject,
  onSelectProject,
  cffSummaries = [],
}: Props) {
  const [porObra, setPorObra] = useState<PorObra>({})
  const [defs, setDefs] = useState<DefCurva[]>(carregaDefsLocal)
  const [novasCurvas, setNovasCurvas] = useState<string[]>([])
  const [editandoCurvas, setEditandoCurvas] = useState(false)
  const [versoesOn, setVersoesOn] = useState<Set<string>>(() => new Set(carregaDefsLocal().map((d) => d.nome)))
  const [versaoFoco, setVersaoFoco] = useState<string | null>(null)
  const [mostrarValores, setMostrarValores] = useState(false)
  const [mostrarMarcas, setMostrarMarcas] = useState(true)
  const [a4LayoutMode, setA4LayoutMode] = useState(true)

  const [iDe, setIDe] = useState(0)
  const [iAte, setIAte] = useState(100)

  const [tabelaAberta, setTabelaAberta] = useState(false)
  const [mudadas, setMudadas] = useState<Set<string>>(new Set())

  const [arrastando, setArrastando] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<{ v: string; acima: boolean } | null>(null)

  const [fonte, setFonte] = useState<{ txt: string; erro: boolean }>({ txt: "dados da obra", erro: false })
  const [importando, setImportando] = useState(false)
  const inpRef = useRef<HTMLInputElement>(null)
  const segVersaoRef = useRef<HTMLDivElement>(null)

  // Identifica a obra ativa
  const currentProjectName = useMemo(() => {
    const p = projects.find((p) => p.id_prevision === selectedProject)
    return p?.nome_projeto || (projects.length > 0 ? projects[0]?.nome_projeto || "Obra" : "Obra")
  }, [projects, selectedProject])

  // Converte CFF da Prevision para curvas da obra atual
  const previsionCurves = useMemo(() => {
    const pName = currentProjectName
    const curves: Record<string, Ponto[]> = {}

    // Busca dados no CFF summaries
    for (const summary of cffSummaries) {
      if (selectedProject && summary.projeto_id && String(summary.projeto_id) !== selectedProject) {
        continue
      }
      for (const nivel of summary.niveis || []) {
        if (nivel.nivel === "1" || nivel.nivel === 1) {
          const basePts: Ponto[] = []
          const prevPts: Ponto[] = []
          const realPts: Ponto[] = []

          let baseAcc = 0
          let prevAcc = 0
          let realAcc = 0

          for (const m of nivel.meses || []) {
            if (m.data) {
              const mesIso = m.data.slice(0, 7) // YYYY-MM
              baseAcc += Number(m.base) || 0
              prevAcc += Number(m.previsto) || 0
              realAcc += Number(m.realizado) || 0

              basePts.push([mesIso, Math.min(1, baseAcc)])
              prevPts.push([mesIso, Math.min(1, prevAcc)])
              if (realAcc > 0) {
                realPts.push([mesIso, Math.min(1, realAcc)])
              }
            }
          }

          if (basePts.length) curves["Planejamento R00"] = basePts
          if (prevPts.length) curves["Replanejado"] = prevPts
          if (realPts.length) curves["Realizado engenharia"] = realPts
        }
      }
    }

    // Carrega curvas importadas/salvas localmente para esta obra
    try {
      const savedKey = `dadosprevision_curvas_${selectedProject || currentProjectName}`
      const saved = localStorage.getItem(savedKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        Object.assign(curves, parsed)
      }
    } catch (e) {
      console.error("Erro ao carregar curvas salvas:", e)
    }

    return { [pName]: curves }
  }, [cffSummaries, selectedProject, currentProjectName])

  // Sincroniza dados com o estado de porObra
  useEffect(() => {
    setPorObra((prev) => {
      const next = { ...prev, ...previsionCurves }
      return next
    })
  }, [previsionCurves])

  const disp = useMemo(() => porObra[currentProjectName] || {}, [porObra, currentProjectName])
  const mesesObra = useMemo(() => mesesDaObra(disp), [disp])
  const fim = Math.max(0, mesesObra.length - 1)

  useEffect(() => {
    setIDe(0)
    setIAte(fim)
  }, [fim, currentProjectName])

  const deClamp = Math.min(iDe, iAte, fim)
  const ateClamp = Math.min(Math.max(iAte, deClamp), fim)
  const janela = mesesObra.slice(deClamp, ateClamp + 1)
  const janelaSet = useMemo(() => new Set(janela), [janela])

  const novasDefs = useMemo(
    () =>
      novasCurvas.map((nome, i) => ({
        nome,
        cor: PALETA[(defs.length + i) % PALETA.length],
        traco: "sólido" as EstiloTraco,
        ref: null,
      })),
    [novasCurvas, defs.length],
  )

  const nSerie = defs.filter(
    (d) => versoesOn.has(d.nome) && disp[d.nome] && disp[d.nome].some((p) => janela.includes(p[0])),
  ).length

  function toggleVersao(v: string) {
    setVersoesOn((prev) => {
      const s = new Set(prev)
      if (s.has(v)) s.delete(v)
      else s.add(v)
      return s
    })
  }

  function periodoInteiro() {
    setIDe(0)
    setIAte(fim)
  }

  function aplicaZoom(de: number, ate: number) {
    setIDe(deClamp + de)
    setIAte(deClamp + ate)
  }

  function reordena(lista: DefCurva[], movido: string, destino: string, acima: boolean) {
    const alvoObj = lista.find((d) => d.nome === movido)
    if (!alvoObj) return lista
    const sem = lista.filter((d) => d.nome !== movido)
    const i = sem.findIndex((d) => d.nome === destino)
    if (i < 0) return lista
    sem.splice(acima ? i : i + 1, 0, alvoObj)
    return sem
  }

  function aplicaDefs(novo: DefCurva[]) {
    setDefs(novo)
    salvaDefsLocal(novo)
  }

  function moveVersao(v: string, passo: number) {
    const i = defs.findIndex((d) => d.nome === v)
    const j = i + passo
    if (i < 0 || j < 0 || j >= defs.length) return
    const nova = [...defs]
    nova.splice(j, 0, ...nova.splice(i, 1))
    aplicaDefs(nova)
    requestAnimationFrame(() => {
      segVersaoRef.current?.querySelector<HTMLButtonElement>(`[data-versao="${CSS.escape(v)}"]`)?.focus()
    })
  }

  function editaPonto(versao: string, mes: string, valor: number | null) {
    setPorObra((prev) => {
      const obra = prev[currentProjectName] || {}
      const serie = obra[versao] || []
      const i = serie.findIndex((p) => p[0] === mes)
      let nova: Ponto[]
      if (valor == null) {
        if (i < 0) return prev
        nova = serie.filter((_, k) => k !== i)
      } else if (i >= 0) {
        nova = serie.map((p, k) => (k === i ? ([mes, valor] as Ponto) : p))
      } else {
        nova = [...serie, [mes, valor] as Ponto].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      }
      const updatedObra = { ...obra, [versao]: nova }
      try {
        const savedKey = `dadosprevision_curvas_${selectedProject || currentProjectName}`
        localStorage.setItem(savedKey, JSON.stringify(updatedObra))
      } catch (e) {
        console.error("Erro ao persistir ponto:", e)
      }
      return { ...prev, [currentProjectName]: updatedObra }
    })
    setMudadas((prev) => new Set(prev).add(versao + "|" + mes))
  }

  async function importa(arq: File) {
    setImportando(true)
    setFonte({ txt: "Lendo " + arq.name + "...", erro: false })
    try {
      let matriz: unknown[][]
      if (/\.csv$/i.test(arq.name)) {
        matriz = csvParaMatriz(await arq.text())
      } else {
        const XLSX = await import("xlsx")
        const wb = XLSX.read(await arq.arrayBuffer(), { cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][]
      }
      const res = matrizParaLinhas(matriz)
      const idx = indexa(res.linhas)

      const conhecidas = new Set(defs.map((d) => d.nome))
      const vistas = new Set<string>()
      for (const obra of Object.values(idx.porObra)) {
        for (const v in obra) {
          if (!conhecidas.has(v)) vistas.add(v)
        }
      }
      if (vistas.size > 0) {
        setNovasCurvas([...vistas])
      }

      setPorObra((prev) => {
        const merged = { ...prev }
        for (const [oName, oCurves] of Object.entries(idx.porObra)) {
          merged[oName] = { ...(merged[oName] || {}), ...oCurves }
          try {
            const savedKey = `dadosprevision_curvas_${selectedProject || oName}`
            localStorage.setItem(savedKey, JSON.stringify(merged[oName]))
          } catch (e) {
            console.error(e)
          }
        }
        return merged
      })

      setIDe(0)
      setVersaoFoco(null)
      setMudadas(new Set())

      let txt = arq.name + " · " + res.linhas.length.toLocaleString("pt-BR") + " linhas importadas"
      setFonte({ txt, erro: false })
    } catch (e) {
      const msg = e instanceof Error ? "Erro ao ler arquivo: " + e.message : "Erro ao importar planilha"
      setFonte({ txt: msg, erro: true })
    } finally {
      setImportando(false)
    }
  }

  function handlePrint() {
    window.print()
  }

  const janelaLabel = mesesObra.length
    ? janela.length === mesesObra.length
      ? mesesObra.length + " meses"
      : janela.length + " de " + mesesObra.length + " meses"
    : "Sem dados"

  return (
    <div className={"curvas-wrapper" + (tabelaAberta ? " comTabela" : "")}>
      {/* TOP CONTROLS & PROJECT SELECTOR */}
      <div className="gestao-controls-bar">
        <div className="gestao-controls-group">
          <label className="gestao-field">
            <span>Projeto / Obra</span>
            <select
              value={selectedProject}
              onChange={(e) => onSelectProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id_prevision} value={p.id_prevision}>
                  {p.nome_projeto}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="gestao-top-actions">
          <button
            type="button"
            className={"matrix-btn" + (mostrarValores ? " btn-primary" : "")}
            aria-pressed={mostrarValores}
            onClick={() => setMostrarValores((v) => !v)}
          >
            <SlidersHorizontal size={13} />
            <span>{mostrarValores ? "Ocultar Valores" : "Valores no Gráfico"}</span>
          </button>

          <button
            type="button"
            className={"matrix-btn" + (mostrarMarcas ? " btn-primary" : "")}
            aria-pressed={mostrarMarcas}
            onClick={() => setMostrarMarcas((v) => !v)}
          >
            <span>Marcadores</span>
          </button>

          <button
            type="button"
            className={"matrix-btn" + (tabelaAberta ? " btn-primary" : "")}
            aria-pressed={tabelaAberta}
            onClick={() => setTabelaAberta((v) => !v)}
          >
            <Table size={13} />
            <span>{tabelaAberta ? "Ocultar Tabela" : "Mostrar Tabela"}</span>
          </button>

          <button
            type="button"
            className="matrix-btn"
            onClick={() => setEditandoCurvas(true)}
          >
            <FileSpreadsheet size={13} />
            <span>Configurar Curvas</span>
          </button>

          <button
            type="button"
            className="matrix-btn btn-primary"
            disabled={importando}
            onClick={() => inpRef.current?.click()}
          >
            <Upload size={13} />
            <span>{importando ? "Importando..." : "Importar Planilha"}</span>
          </button>

          <input
            ref={inpRef}
            type="file"
            accept=".xlsx,.xlsm,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importa(f)
              e.target.value = ""
            }}
          />

          <button
            type="button"
            className={"matrix-btn" + (a4LayoutMode ? " btn-primary" : "")}
            onClick={() => setA4LayoutMode((prev) => !prev)}
            title="Alternar entre Folha A4 Paisagem e Modo Fluido"
          >
            <Maximize2 size={13} />
            <span>{a4LayoutMode ? "Folha A4" : "Modo Fluido"}</span>
          </button>

          <button
            type="button"
            className="matrix-btn btn-primary"
            onClick={handlePrint}
            title="Imprimir ou Salvar em PDF (A4 Paisagem)"
          >
            <Printer size={13} />
            <span>Imprimir / PDF</span>
          </button>
        </div>
      </div>

      {/* MAIN CONTAINER */}
      <div className={a4LayoutMode ? "a4-landscape-container" : "curvas-fluid-container"}>
        <div className={a4LayoutMode ? "a4-landscape-sheet" : "curvas-sheet-card"}>
          {/* HEADER EXECUTIVO */}
          <div className="a4-sheet-header">
            <div className="a4-sheet-brand">
              <h3 className="a4-sheet-title">CURVAS DE AVANÇO FÍSICO-FINANCEIRO (CURVAS S)</h3>
              <span className="a4-sheet-subtitle">
                {currentProjectName} · {nSerie} {nSerie === 1 ? "curva visível" : "curvas visíveis"} · {fonte.txt}
              </span>
            </div>
            <div className="a4-sheet-meta">
              <div className="a4-sheet-meta-item">
                <strong>{currentProjectName}</strong>
                <small>{janelaLabel}</small>
              </div>
              <div className="a4-sheet-meta-item">
                <strong>{mesesObra.length ? `${rotMes(mesesObra[deClamp])} a ${rotMes(mesesObra[ateClamp])}` : "—"}</strong>
                <small>{new Date().toLocaleDateString("pt-BR")}</small>
              </div>
            </div>
          </div>

          <div className="curvas-main-grid">
            {/* SIDEBAR DE VERSÕES / CHIPS */}
            <aside className="curvas-sidebar">
              <div className="curvas-seg">
                <h4>Curvas & Versões</h4>
                <p className="curvas-hint">
                  Clique para ligar/isolar.
                  <br />
                  Arraste ⠿ para reordenar tooltip.
                </p>
                <div className="curvas-chips" ref={segVersaoRef}>
                  {defs.map((d) => {
                    const v = d.nome
                    const tem = !!disp[v]
                    const on = tem && versoesOn.has(v)
                    const foco = versaoFoco === v && on
                    const sw = d.cor
                    const marca = alvo?.v === v ? (alvo.acima ? " alvoAcima" : " alvoAbaixo") : ""
                    const estilo =
                      d.traco === "sólido" ? "" : d.traco === "tracejado" ? " tracejada" : " pontilhada"
                    return (
                      <button
                        key={v}
                        type="button"
                        data-versao={v}
                        draggable
                        className={
                          "curvas-chip" +
                          estilo +
                          (foco ? " foco" : "") +
                          (arrastando === v ? " arrastando" : "") +
                          marca
                        }
                        aria-pressed={on}
                        disabled={!tem}
                        title={tem ? "" : `${currentProjectName} não tem essa curva`}
                        style={{ ["--sw" as any]: sw }}
                        onClick={() => toggleVersao(v)}
                        onDragStart={(e) => {
                          setArrastando(v)
                          e.dataTransfer.effectAllowed = "move"
                          e.dataTransfer.setData("text/plain", v)
                        }}
                        onDragEnd={() => {
                          setArrastando(null)
                          setAlvo(null)
                        }}
                        onDragOver={(e) => {
                          if (!arrastando || arrastando === v) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = "move"
                          const r = e.currentTarget.getBoundingClientRect()
                          setAlvo({ v, acima: e.clientY < r.top + r.height / 2 })
                        }}
                        onDragLeave={() => setAlvo((a) => (a?.v === v ? null : a))}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (!arrastando || arrastando === v) return
                          const r = e.currentTarget.getBoundingClientRect()
                          const acima = e.clientY < r.top + r.height / 2
                          const movido = arrastando
                          aplicaDefs(reordena(defs, movido, v, acima))
                          setArrastando(null)
                          setAlvo(null)
                        }}
                        onKeyDown={(e) => {
                          if (!e.altKey) return
                          if (e.key === "ArrowUp") {
                            e.preventDefault()
                            moveVersao(v, -1)
                          }
                          if (e.key === "ArrowDown") {
                            e.preventDefault()
                            moveVersao(v, 1)
                          }
                        }}
                      >
                        <span className="curvas-pega" aria-hidden="true">
                          ⠿
                        </span>
                        <span className="curvas-swatch" />
                        <span className="curvas-chip-label">{v}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </aside>

            {/* SEÇÃO PRINCIPAL DO GRÁFICO */}
            <section className="curvas-plot-section">
              {/* TIMELINE RANGE SLIDERS */}
              <div className="curvas-periodo-bar">
                <span className="curvas-periodo-label">Período:</span>
                <input
                  type="range"
                  min={0}
                  max={fim}
                  value={deClamp}
                  disabled={!mesesObra.length}
                  aria-label="Mês inicial"
                  onChange={(e) => {
                    const v = +e.target.value
                    setIDe(v)
                    if (v > ateClamp) setIAte(v)
                  }}
                />
                <output>{mesesObra.length ? rotMes(mesesObra[deClamp]) : "—"}</output>
                <span className="curvas-ate">até</span>
                <input
                  type="range"
                  min={0}
                  max={fim}
                  value={ateClamp}
                  disabled={!mesesObra.length}
                  aria-label="Mês final"
                  onChange={(e) => {
                    const v = +e.target.value
                    setIAte(v)
                    if (v < deClamp) setIDe(v)
                  }}
                />
                <output>{mesesObra.length ? rotMes(mesesObra[ateClamp]) : "—"}</output>
                <span className="curvas-janela-info">({janelaLabel})</span>
                <button
                  type="button"
                  className="matrix-btn"
                  onClick={periodoInteiro}
                  title="Restaurar período completo"
                >
                  <RotateCcw size={11} />
                  <span>Período inteiro</span>
                </button>
              </div>

              {/* GRÁFICO SVG INTERATIVO */}
              <AdvanceChartSvg
                disp={disp}
                defs={defs}
                meses={janela}
                versoesOn={versoesOn}
                versaoFoco={versaoFoco}
                mostrarMarcas={mostrarMarcas}
                mostrarValores={mostrarValores}
                onToggleFoco={setVersaoFoco}
                onZoom={aplicaZoom}
                onResetZoom={periodoInteiro}
              />
            </section>
          </div>

          <div className="a4-sheet-footer">
            <div className="a4-sheet-legend">
              <span className="a4-legend-item">
                <span className="a4-legend-color" style={{ background: "#14532D" }} /> Planejamento Base
              </span>
              <span className="a4-legend-item">
                <span className="a4-legend-color" style={{ background: "#E01B24" }} /> Replanejado
              </span>
              <span className="a4-legend-item">
                <span className="a4-legend-color" style={{ background: "#2B6CB0" }} /> Realizado Engenharia
              </span>
              <span className="a4-legend-item">
                <span className="a4-legend-color" style={{ background: "#4FA871" }} /> Curvas SFH / Extras
              </span>
            </div>
            <span>Curvas de Avanço S · Dados Prevision</span>
          </div>
        </div>
      </div>

      {/* GAVETA DE TABELA DE DADOS */}
      {tabelaAberta && (
        <CurveDataDrawer
          obra={currentProjectName}
          disp={disp}
          defs={defs}
          meses={mesesObra}
          janela={janelaSet}
          mudadas={mudadas}
          onEditar={editaPonto}
          onFechar={() => setTabelaAberta(false)}
        />
      )}

      {/* MODAL PARA CURVAS NOVAS IMPORTADAS */}
      {novasCurvas.length > 0 && (
        <CurveEditorModal
          titulo={`${novasCurvas.length} ${novasCurvas.length === 1 ? "Curva Nova Encontrada" : "Curvas Novas Encontradas"}`}
          descricao="Defina as cores e estilos para que apareçam no gráfico e relatórios."
          iniciais={novasDefs}
          outras={defs.map((d) => d.nome)}
          rotuloConfirmar="Cadastrar Curvas"
          onCancelar={() => setNovasCurvas([])}
          onConfirmar={(cadastradas) => {
            aplicaDefs([...defs, ...cadastradas])
            setVersoesOn((prev) => {
              const s = new Set(prev)
              cadastradas.forEach((d) => s.add(d.nome))
              return s
            })
            setNovasCurvas([])
          }}
        />
      )}

      {/* MODAL DE EDIÇÃO GERAL DE CURVAS */}
      {editandoCurvas && (
        <CurveEditorModal
          titulo="Cadastro & Estilo das Curvas S"
          descricao="Ajuste cores, espessuras de traço e a qual curva realizada cada planejamento é comparado."
          iniciais={defs}
          permiteRemover
          rotuloConfirmar="Salvar Configurações"
          onCancelar={() => setEditandoCurvas(false)}
          onConfirmar={(novo) => {
            aplicaDefs(novo)
            setEditandoCurvas(false)
          }}
        />
      )}
    </div>
  )
}
