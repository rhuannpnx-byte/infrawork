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
        'group relative w-full overflow-hidden rounded-md text-left',
        'border border-border bg-bg-panel',
        'flex min-h-[80px] items-stretch gap-0',
        'transition-all duration-150 ease-out',
        enabled
          ? 'hover:border-border-strong hover:bg-bg-elevated active:bg-bg-elevated/80'
          : 'cursor-not-allowed opacity-40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'w-[2px] bg-transparent transition-colors duration-150',
          enabled && 'group-hover:bg-accent group-active:bg-accent',
        )}
      />
      <div className="flex items-center px-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-accent/30 bg-accent-glow text-accent">
          {icon}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center py-3 pr-3">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-semibold text-on-surface">{title}</h3>
          {badge > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warn px-1.5 text-[10px] font-bold text-bg-base tabular">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-on-surface-dim">{subtitle}</p>
      </div>
      <div className="flex items-center pr-4 text-on-surface-muted">
        <ChevronRight className="h-4 w-4" />
      </div>
    </button>
  )
}
