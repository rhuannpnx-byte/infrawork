import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-[color:var(--bg-panel)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-accent text-[color:var(--on-accent)] border border-accent hover:bg-accent-hover hover:border-accent-hover font-semibold',
        secondary:
          'bg-bg-panel text-text border border-border-strong hover:bg-bg-hover hover:border-border-accent',
        ghost: 'text-text-muted hover:text-text hover:bg-bg-hover',
        outline: 'border border-border-strong bg-transparent text-text hover:bg-bg-hover',
        danger: 'bg-danger/10 text-danger border border-danger/40 hover:bg-danger/20',
        link: 'text-accent hover:text-accent-hover underline-offset-2 hover:underline'
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        default: 'h-8 px-3 text-sm',
        md: 'h-9 px-3.5 text-base',
        lg: 'h-10 px-4 text-base',
        icon: 'h-8 w-8 p-0'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
)
Button.displayName = 'Button'

export { buttonVariants }
