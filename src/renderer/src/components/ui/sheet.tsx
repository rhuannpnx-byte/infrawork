import { useEffect, type ReactNode, type HTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from './IconButton'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  side?: 'right' | 'left'
  className?: string
}

export function Sheet({ open, onOpenChange, children, side = 'right', className }: SheetProps): ReactNode {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div
        className={cn(
          'absolute top-0 bottom-0 w-[420px] bg-bg-panel border-border-strong shadow-2xl flex flex-col',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          className
        )}
      >
        <IconButton
          size="sm"
          aria-label="Fechar"
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
  return <h2 className={cn('text-md font-semibold text-text', className)} {...props} />
}

export function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('flex-1 overflow-auto px-4 py-4', className)} {...props} />
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 px-4 py-3 border-t border-border', className)}
      {...props}
    />
  )
}
