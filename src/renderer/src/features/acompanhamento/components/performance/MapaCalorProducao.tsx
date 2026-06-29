import { type ReactNode, useMemo } from 'react'
import { formatNumber } from '@/lib/format'
import { COR } from '../../lib/performance-calc'

interface Props {
  /** Produção por dia (ISO → qtd) da entidade focada (ou geral). */
  porDia: Map<string, number>
  /** Dias do período (ISO), em ordem. */
  dias: string[]
  unidade: string | null
}

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
const dow = (iso: string): number => new Date(iso + 'T00:00:00').getDay()

/** Mapa de calor da produção diária (semanas em linhas), na cor do realizado. */
export function MapaCalorProducao({ porDia, dias, unidade }: Props): ReactNode {
  const { celulas, max } = useMemo(() => {
    if (dias.length === 0) return { celulas: [] as Array<{ iso: string; qtd: number; dentro: boolean } | null>, max: 1 }
    const ini = addDays(dias[0], -dow(dias[0])) // alinha ao domingo
    const fimP = dias[dias.length - 1]
    let fim = fimP
    while (dow(fim) !== 6) fim = addDays(fim, 1) // até sábado
    const dentroSet = new Set(dias)
    const cels: Array<{ iso: string; qtd: number; dentro: boolean } | null> = []
    let cur = ini
    let guard = 0
    let mx = 1
    while (cur <= fim && guard < 500) {
      const dentro = dentroSet.has(cur)
      const qtd = porDia.get(cur) ?? 0
      if (dentro && qtd > mx) mx = qtd
      cels.push({ iso: cur, qtd, dentro })
      cur = addDays(cur, 1)
      guard++
    }
    return { celulas: cels, max: mx }
  }, [porDia, dias])

  if (celulas.length === 0) {
    return <div className="h-40 flex items-center justify-center text-2xs font-mono text-text-dim">Sem período.</div>
  }

  const un = unidade ?? ''
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1 text-2xs font-mono text-text-dim text-center">
        {WEEK.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {celulas.map((c, i) => {
          if (!c || !c.dentro) {
            return <div key={i} className="rounded-sm bg-bg/40 aspect-square" />
          }
          const ratio = c.qtd > 0 ? c.qtd / max : 0
          const op = 0.18 + 0.82 * ratio
          const dia = Number(c.iso.split('-')[2])
          return (
            <div
              key={i}
              className="rounded-sm aspect-square relative border border-border/40 bg-bg overflow-hidden flex items-center justify-center"
              title={`${c.iso.split('-').reverse().join('/')} — ${formatNumber(c.qtd, 1)} ${un}`}
            >
              {c.qtd > 0 ? <span className="absolute inset-0" style={{ background: COR.realizado, opacity: op }} /> : null}
              <span className="absolute top-0.5 left-1 text-[8px] font-mono text-text-dim leading-none">{dia}</span>
              {c.qtd > 0 ? (
                <span className="relative text-[9px] font-mono font-semibold text-text leading-none">{formatNumber(c.qtd, 0)}</span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
