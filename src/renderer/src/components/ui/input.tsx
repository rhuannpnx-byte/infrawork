import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-7 w-full rounded border border-border-strong bg-bg-elevated px-2 text-xs text-text',
      'placeholder:text-text-dim focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'
