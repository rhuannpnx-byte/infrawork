import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { COR } from '../../lib/performance-calc'

interface Props {
  /** Produção por dia (ISO → qtd) da entidade focada (ou geral). */
  porDia: Map<string, number>
  /** Dias do período (ISO), em ordem. */
  dias: string[]
  unidade: string | null
}

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const JANELA = 30

const dow = (iso: string): number => new Date(iso + 'T00:00:00').getDay()
const fmtBR = (iso: string): string => iso.split('-').reverse().join('/').slice(0, 5)

// Rampa pelo MESMO verde do "Realizado" do Previsto × Realizado (COR.realizado),
// variando só a opacidade — sem cores extras.
const OPACIDADE = [0, 0.2, 0.42, 0.68, 1]
function nivel(qtd: number, max: number): number {
  if (qtd <= 0) return 0
  const r = qtd / max
  if (r < 0.25) return 1
  if (r < 0.5) return 2
  if (r < 0.75) return 3
  return 4
}
/** Aplica alpha a uma cor oklch: 'oklch(78% .18 145)' → 'oklch(78% .18 145 / 0.4)'. */
const comAlpha = (c: string, a: number): string => c.replace(/\)\s*$/, ` / ${a})`)

/** Mapa de calor da produção diária — janela de 30 dias, navegável (‹ ›) quando
 *  o período é maior. Mesmo visual do CalendarHeatmap do dashboard. */
export function MapaCalorProducao({ porDia, dias, unidade }: Props): ReactNode {
  const [offset, setOffset] = useState(0)
  const totalJanelas = Math.max(1, Math.ceil(dias.length / JANELA))

  const resetKey = `${dias[0] ?? ''}|${dias.length}`
  useEffect(() => { setOffset(0) }, [resetKey])

  const maxPeriodo = useMemo(() => {
    let m = 1
    for (const d of dias) { const q = porDia.get(d) ?? 0; if (q > m) m = q }
    return m
  }, [porDia, dias])

  const { celulas, range, iniIdx, total, diasTrab } = useMemo(() => {
    const fimIdx = dias.length - offset * JANELA
    const ini = Math.max(0, fimIdx - JANELA)
    const slice = dias.slice(ini, fimIdx)
    const cels: Array<{ iso: string; qtd: number } | null> = []
    if (slice.length > 0) {
      for (let i = 0; i < dow(slice[0]); i++) cels.push(null) // alinha 1º dia à coluna
      for (const iso of slice) cels.push({ iso, qtd: porDia.get(iso) ?? 0 })
    }
    let t = 0, dt = 0
    for (const iso of slice) { const q = porDia.get(iso) ?? 0; if (q > 0) { t += q; dt++ } }
    return {
      celulas: cels,
      iniIdx: ini,
      total: t,
      diasTrab: dt,
      range: slice.length ? { de: slice[0], ate: slice[slice.length - 1] } : null
    }
  }, [dias, offset, porDia])

  if (dias.length === 0 || !range) {
    return <div className="h-24 flex items-center justify-center text-2xs font-mono text-text-dim">Sem produção no período.</div>
  }

  const un = unidade ?? ''
  const canOlder = iniIdx > 0
  const canNewer = offset > 0

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs font-mono text-text-dim">
          {fmtBR(range.de)} – {fmtBR(range.ate)}
        </span>
        {totalJanelas > 1 ? (
          <div className="flex items-center gap-1">
            <span className="text-2xs font-mono text-text-dim mr-1">{totalJanelas - offset}/{totalJanelas}</span>
            <button onClick={() => setOffset((o) => o + 1)} disabled={!canOlder}
              className={cn('p-0.5 rounded border border-border', canOlder ? 'text-text hover:bg-bg-hover' : 'text-text-dim/40 cursor-not-allowed')}
              title="30 dias anteriores">
              <ChevronLeft size={12} />
            </button>
            <button onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={!canNewer}
              className={cn('p-0.5 rounded border border-border', canNewer ? 'text-text hover:bg-bg-hover' : 'text-text-dim/40 cursor-not-allowed')}
              title="30 dias seguintes">
              <ChevronRight size={12} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1 text-2xs font-mono text-text-dim text-center">
        {WEEK.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celulas.map((c, i) => {
          if (!c) return <div key={i} className="aspect-square" />
          const n = nivel(c.qtd, maxPeriodo)
          const claro = n >= 3
          const txt = claro ? 'text-black/80' : 'text-text'
          return (
            <div
              key={i}
              className={cn(
                'rounded-sm aspect-square relative flex items-center justify-center overflow-hidden',
                n === 0 && 'bg-bg'
              )}
              style={n > 0 ? { background: comAlpha(COR.realizado, OPACIDADE[n]) } : undefined}
              title={`${c.iso.split('-').reverse().join('/')} — ${formatNumber(c.qtd, 1)} ${un}`}
            >
              <span className={cn('absolute top-0.5 left-1 text-[8px] font-mono leading-none', claro ? 'text-black/50' : 'text-text-dim')}>
                {Number(c.iso.split('-')[2])}
              </span>
              {c.qtd > 0 ? (
                <span className={cn('text-[11px] font-mono font-semibold leading-none', txt)}>{formatNumber(c.qtd, 0)}</span>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="pt-2 mt-auto text-2xs font-mono text-text-dim flex items-center justify-between">
        <span>{formatNumber(total, 0)} {un} no período</span>
        <span>{diasTrab} {diasTrab === 1 ? 'dia' : 'dias'} com produção</span>
      </div>
    </div>
  )
}
