import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-semibold tracking-[0.04em] uppercase whitespace-nowrap border',
  {
    variants: {
      variant: {
        default: 'bg-bg-elevated text-text-muted border-border-strong',
        accent: 'bg-accent-glow text-accent border-accent-line',
        success: 'bg-success/10 text-success border-success/40',
        warn: 'bg-warn/10 text-warn border-warn/40',
        danger: 'bg-danger/10 text-danger border-danger/40',
        outline: 'bg-transparent text-text-muted border-border'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
)
Badge.displayName = 'Badge'
