import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface TabPillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Estado da tab. Active recebe underline accent + texto accent. */
  active: boolean
}

/**
 * Tab "pill" em barra horizontal. Underline 2px accent sob a tab ativa.
 * Substitui o padrao `border-b-2 transition-colors` replicado em
 * TarefaDetailPanel, ProducaoDetailPanel e equipes.tsx.
 *
 * Caller controla layout externo (flex-1, gap, uppercase, etc.) via className.
 */
export const TabPill = forwardRef<HTMLButtonElement, TabPillProps>(
  ({ active, className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'py-2 text-xs font-mono border-b-2 transition-colors',
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-dim hover:text-text',
        className
      )}
      {...props}
    />
  )
)
TabPill.displayName = 'TabPill'
