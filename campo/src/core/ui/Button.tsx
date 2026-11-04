import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
    'transition-colors duration-150 ease-out ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Primary tem borda fina translúcida (shadow inset) — replica acento do desktop
        primary:
          'bg-accent text-accent-fg shadow-[0_0_0_1px_var(--accent-line)] ' +
          'hover:bg-accent-dark active:bg-accent-dark',
        secondary: 'bg-bg-elevated text-on-surface hover:bg-bg-elevated/80',
        ghost: 'bg-transparent text-on-surface hover:bg-bg-elevated/60',
        outline:
          'border border-border-strong bg-transparent text-on-surface ' +
          'hover:border-accent hover:bg-accent-glow',
        danger: 'bg-bad text-white hover:bg-bad/90',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'min-h-touch px-6 text-base font-semibold',
        icon: 'h-10 w-10',
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
