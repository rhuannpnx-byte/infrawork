import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      // 16 px: abaixo disso o iOS dá zoom ao focar o campo
      'h-11 w-full rounded-md border border-border-strong bg-bg-panel px-3 text-base text-on-surface',
      'placeholder:text-on-surface-muted',
      'transition-colors duration-150 ease-out',
      'focus-visible:border-accent focus-visible:bg-accent-glow focus-visible:ring-0',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
