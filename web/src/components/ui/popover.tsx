import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
}

/**
 * Popover portal-based. Renderiza o conteúdo via `createPortal(document.body)`
 * com `position: fixed`, evitando clipping por containers com `overflow`. As
 * coordenadas são recalculadas em scroll/resize.
 *
 * Substitui a versão anterior que usava `position: absolute` dentro do trigger
 * (problema: ficava clipado por overflow:auto/hidden de containers ancestrais,
 * comum em tabelas virtualizadas e grid layouts).
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  className,
  align = 'start'
}: PopoverProps): ReactNode {
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const update = (): void => {
      const r = triggerRef.current!.getBoundingClientRect()
      const menuW = menuRef.current?.offsetWidth ?? 220
      const top = r.bottom + 4
      let left = r.left
      if (align === 'end') left = r.right - menuW
      else if (align === 'center') left = r.left + (r.width - menuW) / 2
      // Clamp horizontal pra não vazar do viewport
      const maxLeft = window.innerWidth - menuW - 8
      if (left > maxLeft) left = maxLeft
      if (left < 8) left = 8
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
      onOpenChange(false)
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
    <>
      <div ref={triggerRef} className="relative inline-block">
        {trigger}
      </div>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              data-portal-popover=""
              style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
              className={cn(
                'min-w-[220px] rounded-md border border-border-strong bg-bg-elevated p-1 shadow-xl animate-slide-up',
                className
              )}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
