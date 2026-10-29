import { useEffect, useMemo, useRef, useState } from 'react'
import './SelectBusca.css'

export interface OpcaoBusca {
  value: string
  label: string
}

interface Props {
  opcoes: OpcaoBusca[]
  value: string
  onChange: (valor: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  /** Quando preenchido, mostra esta opção "vazia" no topo da lista (ex.: "Sem vínculo"). */
  rotuloVazio?: string
  /** Largura mínima do campo, em px (padrão 220) */
  largura?: number
}

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Seletor com busca: digite parte do código ou do nome para filtrar. Todas as palavras digitadas
 * precisam aparecer no texto da opção (sem diferenciar maiúsculas nem acentos).
 */
export function SelectBusca({ opcoes, value, onChange, placeholder = 'Buscar…', disabled, required, rotuloVazio, largura }: Props) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const raiz = useRef<HTMLDivElement | null>(null)
  const listaRef = useRef<HTMLUListElement | null>(null)

  const selecionada = opcoes.find((o) => o.value === value)

  const filtradas = useMemo(() => {
    const palavras = normalizar(busca).split(/\s+/).filter(Boolean)
    const lista = palavras.length ? opcoes.filter((o) => {
      const texto = normalizar(o.label)
      return palavras.every((p) => texto.includes(p))
    }) : opcoes
    return rotuloVazio && !palavras.length ? [{ value: '', label: rotuloVazio }, ...lista] : lista
  }, [opcoes, busca, rotuloVazio])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  useEffect(() => { setAtivo(0) }, [busca, aberto])
  useEffect(() => {
    listaRef.current?.children[ativo]?.scrollIntoView?.({ block: 'nearest' })
  }, [ativo])

  const escolher = (valor: string) => {
    onChange(valor)
    setAberto(false)
    setBusca('')
  }

  return (
    <div className="select-busca" ref={raiz} style={largura ? { minWidth: largura } : undefined}>
      <input
        type="text"
        role="combobox"
        aria-expanded={aberto}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={aberto ? busca : selecionada?.label ?? ''}
        onFocus={() => setAberto(true)}
        onChange={(e) => { setBusca(e.target.value); setAberto(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo((a) => Math.min(a + 1, filtradas.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && aberto) { e.preventDefault(); if (filtradas[ativo]) escolher(filtradas[ativo].value) }
          else if (e.key === 'Escape') { setAberto(false); setBusca('') }
        }}
      />
      {/* campo nativo só para a validação "required" do formulário */}
      {required && <input className="select-busca-req" tabIndex={-1} aria-hidden required value={value} onChange={() => {}} />}
      {aberto && !disabled && (
        <ul className="select-busca-lista" role="listbox" ref={listaRef}>
          {filtradas.length === 0 && <li className="select-busca-vazio">Nenhuma etapa encontrada</li>}
          {filtradas.map((o, i) => (
            <li
              key={o.value || '__vazio'}
              role="option"
              aria-selected={o.value === value}
              className={`${i === ativo ? 'ativo' : ''} ${o.value === value ? 'sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); escolher(o.value) }}
              onMouseEnter={() => setAtivo(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
