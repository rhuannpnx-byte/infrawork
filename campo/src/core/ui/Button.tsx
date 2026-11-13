import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

// Todo botão tem pelo menos 44 px de altura (alvo de toque com luva, sob sol).
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
    'transition-colors duration-150 ease-out ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-dark active:bg-accent-dark',
        secondary:
          'border border-border bg-bg-elevated text-on-surface hover:border-border-strong',
        ghost: 'bg-transparent text-on-surface hover:bg-on-surface/5 active:bg-on-surface/10',
        outline:
          'border border-border-strong bg-transparent text-on-surface ' +
          'hover:border-accent hover:bg-accent-glow',
        danger: 'bg-bad text-on-status hover:bg-bad/90',
      },
      size: {
        sm: 'min-h-touch px-3 text-sm',
        md: 'min-h-touch px-4 text-sm',
        lg: 'min-h-[48px] px-6 text-base font-semibold',
        icon: 'h-11 w-11 flex-shrink-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
