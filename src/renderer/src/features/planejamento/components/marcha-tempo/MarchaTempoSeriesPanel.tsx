// MarchaTempoSeriesPanel — legenda interativa por série (= código de serviço).
// Cada chip: clicar liga/desliga, botão de "estilo" abre popover com cor,
// traço (sólido/tracejado/pontilhado) e espessura. Port do design Claude Design.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EstiloSerie, TracoTarefa } from '@/types/planejamento'

const SWATCHES = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#f472b6',
  '#2dd4bf',
  '#fb923c'
]

const DASHES: Record<EstiloSerie['dash'], string> = {
  solido: '',
  tracejado: '7 5',
  pontilhado: '1.5 5'
}

const DASH_LABEL: Record<EstiloSerie['dash'], string> = {
  solido: 'Sólido',
  tracejado: 'Tracejado',
  pontilhado: 'Pontilhado'
}

const ESPESSURAS = [
  { k: 'fina', v: 1.7 },
  { k: 'média', v: 2.4 },
  { k: 'grossa', v: 3.2 }
]

interface MarchaTempoSeriesPanelProps {
  tracos: TracoTarefa[]
  estilos: Record<string, EstiloSerie>
  onChange: (estilos: Record<string, EstiloSerie>) => void
}

interface ItemSerie {
  codigo: string
  label: string
  count: number
  corFallback: string
}

function obterEstilo(estilos: Record<string, EstiloSerie>, codigo: string, fallback: string): EstiloSerie {
  return (
    estilos[codigo] ?? {
      visivel: true,
      cor: fallback,
      dash: 'solido',
      width: 2.4
    }
  )
}

export function MarchaTempoSeriesPanel({
  tracos,
  estilos,
  onChange
}: MarchaTempoSeriesPanelProps): ReactNode {
  const [menuAberto, setMenuAberto] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuAberto) return
    const h = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-sp-chip]')) setMenuAberto(null)
    }
    window.addEventListener('mousedown', h)
    return (): void => window.removeEventListener('mousedown', h)
  }, [menuAberto])

  // Agrupar tracos por código de serviço
  const itens = new Map<string, ItemSerie>()
  for (const t of tracos) {
    const k = t.codigo ?? t.tarefaId
    const atual = itens.get(k)
    if (atual) atual.count++
    else
      itens.set(k, {
        codigo: k,
        label: t.label,
        count: 1,
        corFallback: t.cor
      })
  }
  const lista = Array.from(itens.values()).sort((a, b) => a.codigo.localeCompare(b.codigo))

  if (lista.length === 0) return null

  const patch = (codigo: string, p: Partial<EstiloSerie>): void => {
    const cur = obterEstilo(estilos, codigo, lista.find((l) => l.codigo === codigo)?.corFallback ?? '#60a5fa')
    onChange({ ...estilos, [codigo]: { ...cur, ...p } })
  }

  return (
    <div
      ref={panelRef}
      className="flex items-center gap-3 flex-wrap px-3 py-2 bg-bg-elevated border-t border-border font-mono"
    >
      <span className="text-2xs uppercase tracking-widest text-text-dim shrink-0">
        SÉRIES · {lista.length}
      </span>
      <div className="flex gap-2 flex-wrap">
        {lista.map((s) => {
          const st = obterEstilo(estilos, s.codigo, s.corFallback)
          const aberto = menuAberto === s.codigo
          return (
            <div
              data-sp-chip="1"
              key={s.codigo}
              className={`relative inline-flex items-stretch border border-border rounded bg-bg ${
                st.visivel ? '' : 'opacity-50'
              }`}
            >
              <button
                onClick={() => patch(s.codigo, { visivel: !st.visivel })}
                className="flex items-center gap-2 cursor-pointer bg-transparent border-none py-1 pl-2 pr-1 text-text-muted"
                title="Mostrar / ocultar no plot"
              >
                <LinhaPreview cor={st.cor} dash={st.dash} width={st.width} oculto={!st.visivel} />
                <span className="text-2xs whitespace-nowrap">
                  {s.label}
                  {s.count > 1 && <span className="text-text-faint ml-1">×{s.count}</span>}
                </span>
              </button>
              <button
                onClick={() => setMenuAberto(aberto ? null : s.codigo)}
                className={`flex items-center justify-center w-6 border-l border-border bg-transparent text-text-dim cursor-pointer hover:bg-bg-hover ${
                  aberto ? 'bg-accent/10 text-accent-hover' : ''
                }`}
                title="Estilo da série"
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="8" cy="3.2" r="1.3" />
                  <circle cx="8" cy="8" r="1.3" />
                  <circle cx="8" cy="12.8" r="1.3" />
                </svg>
              </button>
              {aberto && (
                <div
                  className="absolute bottom-full left-0 mb-2 z-50 w-52 p-3 rounded-md border border-border-strong bg-bg-menu shadow-2xl"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="text-2xs uppercase tracking-wider text-text-dim mb-1.5">
                    Cor
                  </div>
                  <div className="grid grid-cols-8 gap-1">
                    {SWATCHES.map((c) => (
                      <button
                        key={c}
                        onClick={() => patch(s.codigo, { cor: c })}
                        className={`aspect-square w-full rounded-sm border border-white/10 cursor-pointer transition-transform hover:scale-110 ${
                          st.cor === c ? 'outline outline-2 outline-text' : ''
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="text-2xs uppercase tracking-wider text-text-dim mb-1.5">
                    Traço
                  </div>
                  <div className="flex gap-1">
                    {(Object.keys(DASHES) as EstiloSerie['dash'][]).map((d) => (
                      <button
                        key={d}
                        onClick={() => patch(s.codigo, { dash: d })}
                        title={DASH_LABEL[d]}
                        className={`flex-1 flex items-center justify-center px-1 py-1.5 rounded border ${
                          st.dash === d
                            ? 'border-border-accent bg-accent/10 text-accent-hover'
                            : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
                        }`}
                      >
                        <LinhaPreview cor={st.cor} dash={d} width={2.4} />
                      </button>
                    ))}
                  </div>
                  <div className="h-px bg-border my-2" />
                  <div className="text-2xs uppercase tracking-wider text-text-dim mb-1.5">
                    Espessura
                  </div>
                  <div className="flex gap-1">
                    {ESPESSURAS.map((w) => (
                      <button
                        key={w.k}
                        onClick={() => patch(s.codigo, { width: w.v })}
                        className={`flex-1 flex items-center justify-center px-1 py-1.5 rounded border text-2xs ${
                          Math.abs(st.width - w.v) < 0.05
                            ? 'border-border-accent bg-accent/10 text-accent-hover'
                            : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
                        }`}
                      >
                        {w.k}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LinhaPreview({
  cor,
  dash,
  width,
  oculto
}: {
  cor: string
  dash: EstiloSerie['dash']
  width: number
  oculto?: boolean
}): ReactNode {
  return (
    <svg width="28" height="10">
      <line
        x1="2"
        y1="5"
        x2="26"
        y2="5"
        stroke={cor}
        strokeWidth={Math.min(width, 3)}
        strokeDasharray={oculto ? '2 3' : DASHES[dash] || undefined}
        strokeLinecap="round"
      />
    </svg>
  )
}
