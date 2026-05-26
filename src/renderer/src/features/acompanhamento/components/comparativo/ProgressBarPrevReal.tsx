import { type ReactNode } from 'react'
import { STATUS_COMP_COR, type StatusComparativo } from '@/types/acompanhamento'

interface Props {
  pct: number | null
  esperado?: number | null
  status: StatusComparativo
}

export function ProgressBarPrevReal({ pct, esperado, status }: Props): ReactNode {
  const real = pct != null ? Math.max(0, Math.min(1, Number(pct))) : 0
  const exp = esperado != null ? Math.max(0, Math.min(1, Number(esperado))) : null
  const cor = STATUS_COMP_COR[status]

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 relative h-2 rounded bg-bg overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 transition-all"
          style={{ width: `${real * 100}%`, background: cor }}
        />
        {exp != null && (
          <div
            className="absolute inset-y-0 w-px bg-text/60"
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
