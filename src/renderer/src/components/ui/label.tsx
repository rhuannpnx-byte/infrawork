import { forwardRef, type LabelHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        'text-2xs font-medium uppercase tracking-wider text-text-muted font-mono',
        className
      )}
      {...props}
    />
  )
)
Label.displayName = 'Label'
