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

export function EquipeChip({
  nome,
  cor,
  qtd,
  size = 'md',
  onRemove,
  className
}: Props): ReactNode {
  const sizeCls =
    size === 'sm' ? 'text-2xs px-1.5 py-0.5 gap-1' : 'text-xs px-2 py-0.5 gap-1.5'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded font-mono border',
        'border-border bg-bg-panel text-text',
        sizeCls,
        className
      )}
      title={`${nome}${qtd && qtd > 1 ? ` ×${qtd}` : ''}`}
    >
      <span
        className="inline-block rounded-sm"
        style={{ background: cor, width: size === 'sm' ? 6 : 8, height: size === 'sm' ? 6 : 8 }}
      />
      <span className="max-w-[140px] truncate">{nome}</span>
      {qtd && qtd > 1 ? (
        <span className="text-text-dim">×{qtd}</span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="text-text-dim hover:text-text"
        >
          <X size={9} />
        </button>
      ) : null}
    </span>
  )
}
