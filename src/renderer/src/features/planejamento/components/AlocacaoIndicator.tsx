import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

interface Props {
  /** Soma de quantidade_alocada de todas as tarefas-folha deste item. */
  alocado: number
  /** quantidade_referencia do item orçado. */
  total: number
  /** Unidade do item (m³, t, etc.). Opcional. */
  unidade?: string | null
  /** Versão compacta (só percentual). */
  compact?: boolean
}

/**
 * Pílula que indica a alocação de quantidade de um item orçado entre as
 * tarefas-folha do planejamento.
 *
 * Cores:
 *   - verde      → alocado ≈ total (100%)
 *   - âmbar      → alocado < total (alocação parcial — falta planejar)
 *   - vermelho   → alocado > total (estouro — defensivo; backend bloqueia)
 */
export function AlocacaoIndicator({
  alocado,
  total,
  unidade,
  compact = false
}: Props): ReactNode {
  const pct = total > 0 ? alocado / total : 0
  const tol = Math.max(Math.abs(total) * 0.001, 0.0001)
  const status: 'ok' | 'parcial' | 'estourado' =
    Math.abs(alocado - total) <= tol
      ? 'ok'
      : alocado > total
        ? 'estourado'
        : 'parcial'

  const color =
    status === 'ok'
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : status === 'parcial'
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : 'bg-red-500/15 text-red-400 border-red-500/30'

  const label = compact
    ? `${Math.round(pct * 100)}%`
    : `${formatNumber(alocado)}/${formatNumber(total)}${unidade ? ' ' + unidade : ''} · ${Math.round(pct * 100)}%`

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-2xs tabular-nums whitespace-nowrap',
        color
      )}
      title={`Alocado ${formatNumber(alocado)} de ${formatNumber(total)}${unidade ? ' ' + unidade : ''}`}
    >
      {label}
    </span>
  )
}
