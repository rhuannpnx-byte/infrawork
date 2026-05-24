import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-medium font-mono tracking-wide uppercase border',
  {
    variants: {
      variant: {
        default: 'bg-bg-elevated text-text-muted border-border-strong',
        accent: 'bg-accent-glow text-accent border-accent-line',
        success: 'bg-success/15 text-success border-success/30',
        warn: 'bg-warn/15 text-warn border-warn/30',
        danger: 'bg-danger/15 text-danger border-danger/30',
        outline: 'bg-transparent text-text-muted border-border'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
))
Badge.displayName = 'Badge'
