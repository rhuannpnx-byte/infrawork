import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Mantido por compatibilidade: o caminho da página já está no menu. */
  breadcrumb?: string[]
  className?: string
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps): ReactNode {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3 border-b border-border bg-bg-panel',
        className
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.005em] text-text">{title}</h1>
        {subtitle ? <p className="text-sm text-text-muted mt-0.5">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
