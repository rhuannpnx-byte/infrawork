import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface DropdownProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  className?: string
}

interface Position {
  top: number
  left: number
}

export function Dropdown({
  trigger,
  children,
  align = 'start',
  className
}: DropdownProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const update = (): void => {
      const r = triggerRef.current!.getBoundingClientRect()
      const menuW = menuRef.current?.offsetWidth ?? 180
      const top = r.bottom + 4
      const left = align === 'end' ? r.right - menuW : r.left
      setPos({ top, left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div ref={triggerRef} className="relative inline-block" onClick={() => setOpen((o) => !o)}>
        {trigger}
      </div>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
              className={cn(
                'min-w-[180px] rounded-md border border-border-strong bg-bg-elevated p-1 shadow-xl animate-slide-up',
                className
              )}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

interface DropdownItemProps {
  onClick?: () => void
  children: ReactNode
  shortcut?: string
  disabled?: boolean
  variant?: 'default' | 'danger'
}

export function DropdownItem({
  onClick,
  children,
  shortcut,
  disabled,
  variant = 'default'
}: DropdownItemProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-xs text-left transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'danger' ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-bg-hover'
      )}
    >
      <span className="flex items-center gap-2">{children}</span>
      {shortcut ? <span className="font-mono text-2xs text-text-faint">{shortcut}</span> : null}
    </button>
  )
}

export function DropdownSeparator(): ReactNode {
  return <div className="my-1 h-px bg-border" />
}

export function DropdownLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="px-2 pt-1.5 pb-1 text-2xs font-mono uppercase tracking-wider text-text-dim">
      {children}
    </div>
  )
}
