import { useEffect, useRef, type ReactNode, type HTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /**
   * Quando true, bloqueia ESC e click-outside. Use durante operações em andamento
   * pra não perder o form preenchido por engano.
   */
  disableDismiss?: boolean
  /**
   * Quando true, renderiza acima de qualquer overlay externo (lightbox,
   * leaflet popup, etc). Use no ConfirmDialog global.
   */
  topmost?: boolean
}

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl'
}

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  size = 'md',
  disableDismiss = false,
  topmost = false
}: DialogProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !disableDismiss) onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange, disableDismiss])

  if (!open) return null

  // yet-another-react-lightbox usa z-index 9999. topmost=10010 garante
  // o ConfirmDialog acima de qualquer overlay externo.
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 flex items-center justify-center',
        topmost ? 'z-[10010]' : 'z-50'
      )}
      onClick={(e) => {
        if (disableDismiss) return
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div
        ref={ref}
        className={cn(
          'relative w-full mx-4 rounded-md border border-border-strong bg-bg-panel shadow-2xl animate-slide-up',
          SIZES[size],
          className
        )}
      >
        {!disableDismiss ? (
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => onOpenChange(false)}
            className="absolute top-2.5 right-2.5 text-text-dim hover:text-text transition-colors"
          >
            <X size={14} />
          </button>
        ) : null}
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div className={cn('px-4 py-3 border-b border-border', className)} {...props} />
  )
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return <h2 className={cn('text-md font-semibold text-text', className)} {...props} />
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>): ReactNode {
  return <p className={cn('text-xs text-text-muted mt-0.5', className)} {...props} />
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('px-4 py-4', className)} {...props} />
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 px-4 py-3 border-t border-border', className)}
      {...props}
    />
  )
}

/** Banner de erro pra usar no topo do DialogBody. */
export function DialogErrorBanner({ message }: { message: string | null }): ReactNode {
  if (!message) return null
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-3 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-2xs font-mono text-danger"
    >
      <span className="mt-px shrink-0">⚠</span>
      <span className="leading-relaxed">{message}</span>
    </div>
  )
}
