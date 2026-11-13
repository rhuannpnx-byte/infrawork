import { useRef, type ReactNode, type HTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './IconButton'
import { useCamadaModal } from './camada-modal'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  side?: 'right' | 'left'
  className?: string
}

export function Sheet({
  open,
  onOpenChange,
  children,
  side = 'right',
  className
}: SheetProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useCamadaModal(open, ref, { aoFechar: () => onOpenChange(false) })

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div
        className="absolute inset-0 bg-[color:var(--veu)] animate-fade-in"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={ref}
        tabIndex={-1}
        className={cn(
          'absolute top-0 bottom-0 w-[420px] max-w-full bg-bg-panel border-border-strong shadow-[var(--sombra-flutuante)] flex flex-col focus:outline-none',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          className
        )}
      >
        <IconButton
          size="sm"
          aria-label="Fechar"
          data-fechar=""
          onClick={() => onOpenChange(false)}
          className="absolute top-2 right-2 z-10"
        >
          <X size={14} />
        </IconButton>
        {children}
      </div>
    </div>
  )
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('px-4 py-3 border-b border-border', className)} {...props} />
}

export function SheetTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return <h2 className={cn('text-lg font-semibold text-text pr-8', className)} {...props} />
}

export function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('flex-1 overflow-auto px-4 py-4', className)} {...props} />
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 px-4 py-3 border-t border-border',
        className
      )}
      {...props}
    />
  )
}
