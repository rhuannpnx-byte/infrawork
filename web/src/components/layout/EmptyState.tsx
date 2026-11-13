import { type ReactNode } from 'react'
import { Icon } from './IconRenderer'
import { CurvasDeNivel } from './CurvasDeNivel'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action
}: EmptyStateProps): ReactNode {
  return (
    <div className="relative isolate flex flex-col items-center justify-center text-center py-16 px-4 overflow-hidden">
      <CurvasDeNivel className="-z-10" />
      <div className="w-11 h-11 rounded bg-bg-panel flex items-center justify-center mb-3 text-text-muted border border-border-strong">
        <Icon name={icon} size={20} strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-semibold text-text mb-1">{title}</h3>
      {description ? <p className="text-sm text-text-muted max-w-md">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
