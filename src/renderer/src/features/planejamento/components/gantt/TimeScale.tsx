// TimeScale — header de 2 tiers do GanttPane.
//
// Tier major (28px) e tier minor (28px). Iteração via iterateTier (gerador).
// Cada cell renderiza labelTier adaptativo por largura. Fim de semana e dia
// "hoje" recebem destaque visual.

import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  iterateTier,
  isWeekend,
  labelTier,
  pickScaleTiers,
  sameDay,
  tierStart,
  type ScaleTier
} from '../../lib/time-scale'

interface TimeScaleProps {
  origin: Date
  end: Date
  pxPerDay: number
  todayDate: Date
  /** Para sticky offset com scroll horizontal — opcional. */
  className?: string
}

export function TimeScale({
  origin,
  end,
  pxPerDay,
  todayDate,
  className
}: TimeScaleProps): ReactNode {
  const tiers = useMemo(() => pickScaleTiers(pxPerDay), [pxPerDay])

  return (
    <div
      className={cn(
        'sticky top-0 z-30 bg-bg-panel border-b border-border',
        'select-none',
        className
      )}
    >
      <TierRow
        tier={tiers.major}
        origin={origin}
        end={end}
        pxPerDay={pxPerDay}
        todayDate={todayDate}
        variant="major"
      />
      <TierRow
        tier={tiers.minor}
        origin={origin}
        end={end}
        pxPerDay={pxPerDay}
        todayDate={todayDate}
        variant="minor"
      />
    </div>
  )
}

interface TierRowProps {
  tier: ScaleTier
  origin: Date
  end: Date
  pxPerDay: number
  todayDate: Date
  variant: 'major' | 'minor'
}

function TierRow({ tier, origin, end, pxPerDay, todayDate, variant }: TierRowProps): ReactNode {
  // Itera começando do início do tier que contém `origin` pra labels
  // alinharem com marcos (mês começa dia 1, semana segunda, etc.)
  const spans = useMemo(() => iterateTier(tierStart(origin, tier), end, tier), [origin, end, tier])

  // dateToX baseado no `origin` real (não no tier-snapped), pra o canvas
  // ficar alinhado com as barras.
  const dateToX = (d: Date): number => {
    const days = Math.round((d.getTime() - origin.getTime()) / 86400000)
    return days * pxPerDay
  }

  return (
    <div
      className={cn(
        'relative h-7 border-b border-border',
        variant === 'major' ? 'bg-bg-panel' : 'bg-bg-panel/80'
      )}
    >
      {spans.map((span, i) => {
        const left = dateToX(span.start)
        const right = dateToX(span.end)
        const width = right - left
        if (width <= 0) return null
        const text = labelTier(span, tier, width)
        const isToday = tier === 'day' && sameDay(span.start, todayDate)
        const weekend = tier === 'day' && isWeekend(span.start)
        return (
          <div
            key={i}
            className={cn(
              'absolute top-0 bottom-0 flex items-center px-1.5',
              'border-r border-border text-2xs font-mono uppercase tracking-wider',
              variant === 'major' ? 'text-text-muted' : 'text-text-dim',
              weekend && 'bg-bg-elevated/60',
              isToday && 'bg-accent/15 text-accent font-semibold'
            )}
            style={{ left, width }}
          >
            <span className="truncate">{text}</span>
          </div>
        )
      })}
    </div>
  )
}
