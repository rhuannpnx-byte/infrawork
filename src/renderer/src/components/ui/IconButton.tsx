import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'text-text-dim hover:text-text hover:bg-bg-hover',
        danger: 'text-text-dim hover:text-danger hover:bg-danger/10',
        accent: 'text-text-muted hover:text-accent hover:bg-bg-hover'
      },
      size: {
        // Mínimo WCAG 2.2 SC 2.5.8: 24×24. Default 28 (combina com Button size default).
        sm: 'w-6 h-6',
        default: 'w-7 h-7'
      }
    },
    defaultVariants: { variant: 'ghost', size: 'default' }
  }
)

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  'aria-label': string
}

/**
 * Botão icon-only com hit area ≥24×24. Use para chevron, X de fechar, lápis de
 * editar, lixeira inline, etc. Sempre passe aria-label descritivo.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
)
IconButton.displayName = 'IconButton'

export { iconButtonVariants }
