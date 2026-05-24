import { type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useLocation } from '@tanstack/react-router'
import { getModuleByRoute } from '@/config/modules'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  breadcrumb?: string[]
  className?: string
}

export function PageHeader({ title, subtitle, actions, breadcrumb, className }: PageHeaderProps): ReactNode {
  const location = useLocation()
  const mod = getModuleByRoute(location.pathname)
  const crumbs = breadcrumb ?? (mod ? [mod.title, title] : [title])

  return (
    <header className={cn('flex items-end justify-between gap-4 px-5 py-3 border-b border-border', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-2xs text-text-dim font-mono mb-1">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 ? <ChevronRight size={9} /> : null}
              <span className={cn(i === crumbs.length - 1 && 'text-text-muted')}>{c}</span>
            </span>
          ))}
        </div>
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        {subtitle ? <p className="text-xs text-text-muted mt-0.5">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </header>
  )
}
