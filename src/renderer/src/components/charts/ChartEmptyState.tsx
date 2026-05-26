import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  message: string
  hint?: ReactNode
  height?: number | string
  className?: string
  /** Quando true, usa absolute inset-0 em vez de altura propria. Para sobrepor sobre um chart/mapa. */
  overlay?: boolean
}

/**
 * Empty state padrao de charts e mapas. Substitui a repeticao
 * "rounded border bg-bg-panel flex items-center justify-center text-text-dim text-2xs font-mono".
 */
export function ChartEmptyState({ message, hint, height, className, overlay = false }: Props): ReactNode {
  if (overlay) {
    return (
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center gap-1 text-text-dim text-2xs font-mono p-4 text-center pointer-events-none',
          className
        )}
      >
        <div>{message}</div>
        {hint ? <div className="text-text-faint">{hint}</div> : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded border border-border bg-bg-panel flex flex-col items-center justify-center gap-1 text-text-dim text-2xs font-mono p-4 text-center',
        className
      )}
      style={height != null ? { height } : undefined}
    >
      <div>{message}</div>
      {hint ? <div className="text-text-faint">{hint}</div> : null}
    </div>
  )
}
