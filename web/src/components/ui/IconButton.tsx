import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'text-text-muted hover:text-text hover:bg-bg-hover',
        danger: 'text-text-dim hover:text-danger hover:bg-danger/10',
        accent: 'text-text-muted hover:text-accent hover:bg-bg-hover'
      },
      size: {
        sm: 'w-7 h-7',
        default: 'w-8 h-8'
      }
    },
    defaultVariants: { variant: 'ghost', size: 'default' }
  }
)

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  'aria-label': string
}

/**
 * Botão só com ícone, com área de toque de pelo menos 28×28. O `aria-label` é obrigatório e vira também a dica
 * do mouse quando não há `title`.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, type = 'button', title, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      title={title ?? props['aria-label']}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
)
IconButton.displayName = 'IconButton'

export { iconButtonVariants }
