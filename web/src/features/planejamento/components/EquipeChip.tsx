import { type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  nome: string
  cor: string
  qtd?: number
  size?: 'sm' | 'md'
  onRemove?: () => void
  className?: string
}

export function EquipeChip({ nome, cor, qtd, size = 'md', onRemove, className }: Props): ReactNode {
  const sizeCls = size === 'sm' ? 'text-xs px-1.5 py-0.5 gap-1' : 'text-sm px-2 py-0.5 gap-1.5'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border',
        'border-border bg-bg-panel text-text',
        sizeCls,
        className
      )}
      title={`${nome}${qtd && qtd > 1 ? ` ×${qtd}` : ''}`}
    >
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-sm"
        style={{ background: cor, width: size === 'sm' ? 6 : 8, height: size === 'sm' ? 6 : 8 }}
      />
      <span className="max-w-[140px] truncate">{nome}</span>
      {qtd && qtd > 1 ? <span className="tabular text-text-muted">×{qtd}</span> : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remover ${nome}`}
          title={`Remover ${nome}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="-my-0.5 -mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-text-dim hover:bg-bg-hover hover:text-text"
        >
          <X size={12} />
        </button>
      ) : null}
    </span>
  )
}
