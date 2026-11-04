import { useEffect, useRef, type ReactNode, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
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
  /**
   * Esconde o botão X padrão (canto sup. direito). Use quando o conteúdo já
   * provê o próprio controle de fechar no cabeçalho (ex.: Visualizador).
   */
  hideClose?: boolean
}

const SIZES = {
  sm: 'w-full max-w-md',
  md: 'w-full max-w-lg',
  lg: 'w-full max-w-2xl',
  xl: 'w-full max-w-4xl',
  // Quase tela cheia, em coluna — para layouts ricos (workbench de painéis).
  full: 'w-[96vw] max-w-none h-[92vh] flex flex-col overflow-hidden'
}

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  size = 'md',
  disableDismiss = false,
  topmost = false,
  hideClose = false
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

  // Renderiza via portal direto em document.body — escapa stacking contexts
  // de pais e fica AO LADO de outros portais (lightbox, leaflet popup).
  // yet-another-react-lightbox usa z-index 9999. topmost=10010 garante
  // o ConfirmDialog acima de qualquer overlay externo.
  // Click-outside: usa ref do box ao inves de e.target===e.currentTarget,
  // porque o overlay (filho do wrapper) sempre invalidaria a igualdade.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'fixed inset-0 flex items-center justify-center',
        topmost ? 'z-[10010]' : 'z-50'
      )}
      onMouseDown={(e) => {
        if (disableDismiss) return
        if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false)
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in pointer-events-none" />
      <div
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative mx-4 rounded-md border border-border-strong bg-bg-panel shadow-2xl animate-slide-up',
          SIZES[size],
          className
        )}
      >
        {!disableDismiss && !hideClose ? (
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => onOpenChange(false)}
            className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  )
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('px-4 py-3 border-b border-border', className)} {...props} />
}

export function DialogTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return <h2 className={cn('text-md font-semibold text-text', className)} {...props} />
}

export function DialogDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): ReactNode {
  return <p className={cn('text-xs text-text-muted mt-0.5', className)} {...props} />
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('px-4 py-4', className)} {...props} />
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
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
