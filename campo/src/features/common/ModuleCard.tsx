import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface ModuleCardProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  badge: number
  enabled: boolean
  onClick: () => void
  testId?: string
}

export function ModuleCard({
  icon,
  title,
  subtitle,
  badge,
  enabled,
  onClick,
  testId,
}: ModuleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      data-testid={testId}
      className={cn(
        'group w-full rounded-md text-left',
        'border border-border bg-bg-panel',
        'flex min-h-[80px] items-stretch',
        'transition-colors duration-150 ease-out',
        enabled ? 'hover:border-accent active:bg-bg-elevated' : 'cursor-not-allowed opacity-50',
      )}
    >
      <div className="flex items-center px-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-md border border-accent-line bg-accent-glow text-accent">
          {icon}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center py-3 pr-3">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-semibold text-on-surface">{title}</h3>
          {badge > 0 && (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-warn px-1.5 text-2xs font-bold text-on-status tabular"
              aria-label={`${badge} aguardando envio`}
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-on-surface-dim">{subtitle}</p>
      </div>
      <div className="flex items-center pr-4 text-on-surface-muted">
        <ChevronRight className="h-5 w-5" />
      </div>
    </button>
  )
}
