import {
  useState,
  useRef,
  type ReactNode,
  type ReactElement,
  cloneElement,
  isValidElement
} from 'react'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactElement
  shortcut?: string
  delay?: number
}

export function Tooltip({ content, side = 'right', children, shortcut, delay = 250 }: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sideClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5'
  }

  const show = (): void => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = (): void => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setOpen(false)
  }

  if (!isValidElement(children)) return children

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide
  })

  return (
    <div className="relative inline-flex">
      {trigger}
      {open && (
        <div
          role="tooltip"
          className={cn(
            'absolute z-50 whitespace-nowrap rounded border border-border-strong bg-bg-elevated px-2 py-1 text-2xs text-text shadow-lg pointer-events-none animate-fade-in',
            sideClasses[side]
          )}
        >
          {content}
          {shortcut ? (
            <span className="ml-2 font-mono text-text-faint">{shortcut}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}
