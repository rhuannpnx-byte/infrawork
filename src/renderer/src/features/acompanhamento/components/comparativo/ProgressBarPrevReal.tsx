import { type ReactNode } from 'react'
import { STATUS_COMP_COR, type StatusComparativo } from '@/types/acompanhamento'

interface Props {
  pct: number | null
  esperado?: number | null
  status: StatusComparativo
  /** Modo neutro (cliente): cor de acento, sem marcador "esperado" nem semântica
   *  de atraso/adiantamento. */
  neutral?: boolean
}

export function ProgressBarPrevReal({ pct, esperado, status, neutral }: Props): ReactNode {
  const real = pct != null ? Math.max(0, Math.min(1, Number(pct))) : 0
  const exp = neutral || esperado == null ? null : Math.max(0, Math.min(1, Number(esperado)))
  const cor = neutral ? 'var(--accent)' : STATUS_COMP_COR[status]

  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 relative h-2">
        {/* trilho + carga (clipado pras bordas arredondadas) */}
        <div className="absolute inset-0 rounded bg-bg overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all"
            style={{ width: `${real * 100}%`, background: cor }}
          />
        </div>
        {/* marcador "esperado hoje" — onde a barra DEVERIA estar */}
        {exp != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-[3px] rounded-full bg-amber-300 ring-1 ring-bg shadow-sm"
            style={{ left: `${exp * 100}%` }}
            title={`Esperado hoje: ${(exp * 100).toFixed(0)}%`}
          />
        )}
      </div>
      <span className="font-mono tabular-nums text-2xs text-text shrink-0">
        {pct != null ? `${(real * 100).toFixed(0)}%` : '—'}
      </span>
    </div>
  )
}
