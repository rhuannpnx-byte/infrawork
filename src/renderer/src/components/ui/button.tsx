import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-accent text-[color:var(--primary-foreground)] hover:bg-accent-hover shadow-[0_0_0_1px_var(--accent-line)]',
        secondary:
          'bg-bg-elevated text-text border border-border-strong hover:bg-bg-hover hover:border-border-accent',
        ghost: 'text-text-muted hover:text-text hover:bg-bg-hover',
        outline: 'border border-border-strong bg-transparent text-text hover:bg-bg-hover',
        danger:
          'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
        link: 'text-accent hover:text-accent-hover underline-offset-2 hover:underline'
      },
      size: {
        sm: 'h-6 px-2 text-2xs',
        default: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-sm',
        lg: 'h-9 px-4 text-sm',
        icon: 'h-7 w-7 p-0'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
)
Button.displayName = 'Button'

export { buttonVariants }
