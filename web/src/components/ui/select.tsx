import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative inline-flex w-full">
      <select
        ref={ref}
        className={cn(
          'h-8 w-full appearance-none rounded border border-border-strong bg-bg-panel pl-2.5 pr-7 text-sm text-text',
          'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-muted"
      />
    </div>
  )
)
Select.displayName = 'Select'
