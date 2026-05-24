import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
}

export function Popover({ open, onOpenChange, trigger, children, className, align = 'start' }: PopoverProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <div ref={containerRef} className="relative inline-block">
      {trigger}
      {open && (
        <div
          className={cn(
            'absolute z-40 mt-1 min-w-[220px] rounded-md border border-border-strong bg-bg-elevated p-1 shadow-xl animate-slide-up',
            align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0',
            className
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
