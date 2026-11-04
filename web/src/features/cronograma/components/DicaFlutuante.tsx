/** Dica flutuante das visões do cronograma (barras do Gantt, linhas do tempo-caminho). */
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ConteudoDica {
  titulo: string
  linhas: [string, string][]
  avisos: string[]
}

export function DicaFlutuante({
  x,
  y,
  conteudo
}: {
  x: number
  y: number
  conteudo: ConteudoDica
}): ReactNode {
  const w = 300
  const left = Math.min(x + 14, window.innerWidth - w - 8)
  const top = Math.min(
    y + 14,
    window.innerHeight - 40 - conteudo.linhas.length * 18 - conteudo.avisos.length * 18
  )
  return createPortal(
    <div
      style={{ position: 'fixed', left, top, width: w, zIndex: 1050 }}
      className="pointer-events-none rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-xs shadow-xl"
    >
      <div className="mb-1 truncate font-semibold text-text">{conteudo.titulo}</div>
      {conteudo.linhas.map(([k, v]) => (
        <div key={k} className="flex gap-2 leading-[18px]">
          <span className="w-20 shrink-0 text-text-dim">{k}</span>
          <span className="min-w-0 flex-1 truncate text-text-muted tabular-nums">{v}</span>
        </div>
      ))}
      {conteudo.avisos.map((a, i) => (
        <div key={i} className="mt-1 flex gap-1.5 text-danger">
          <span>⚑</span>
          <span>{a}</span>
        </div>
      ))}
    </div>,
    document.body
  )
}
