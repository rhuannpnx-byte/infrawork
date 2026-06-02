// AnchoredPopover — popover posicionado em relação a um anchorRect (DOMRect).
//
// Renderizado via createPortal(document.body) para escapar de containers
// com overflow. Fecha em click-outside, Escape, ou scroll global.
//
// Posicionamento em 2 passes pra suportar flip-up quando não cabe abaixo:
//   pass 1: renderiza no DOM com `visibility: hidden` (precisa estar montado
//           pra medir altura real)
//   pass 2: useLayoutEffect mede `offsetHeight`/`offsetWidth`, aplica clamp
//           horizontal + flip vertical se necessário, revela com `visibility: visible`
//
// Ambos passes rodam ANTES do paint (useLayoutEffect síncrono) — sem flicker.
// Quando não cabe nem em cima nem embaixo, clampa no topo da viewport e o
// `maxHeight` no container deixa o conteúdo scrollar internamente.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface AnchoredPopoverProps {
  anchorRect: DOMRect
  onClose: () => void
  children: ReactNode
  className?: string
  /** Alinhamento horizontal da popover em relação ao anchor. */
  align?: 'start' | 'end'
  /** Largura mínima/preferida da popover (default 240). */
  minWidth?: number
}

interface PopoverPos {
  top: number
  left: number
  measured: boolean
}

export function AnchoredPopover({
  anchorRect,
  onClose,
  children,
  className,
  align = 'start',
  minWidth = 240
}: AnchoredPopoverProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PopoverPos>({ top: 0, left: 0, measured: false })

  useLayoutEffect(() => {
    const update = (): void => {
      const el = ref.current
      if (!el) return
      const w = el.offsetWidth || minWidth
      const h = el.offsetHeight
      const margin = 8

      // Horizontal: alinha ao anchor, clampa pra não vazar do viewport
      let left = align === 'end' ? anchorRect.right - w : anchorRect.left
      const maxLeft = window.innerWidth - w - margin
      if (left > maxLeft) left = maxLeft
      if (left < margin) left = margin

      // Vertical: tenta abaixo, flip pra cima se não couber, clampa se nenhum
      // dos lados couber inteiro (conteúdo scrolla via max-h interno).
      const below = anchorRect.bottom + 4
      const fitsBelow = below + h <= window.innerHeight - margin
      let top: number
      if (fitsBelow) {
        top = below
      } else {
        const above = anchorRect.top - h - 4
        if (above >= margin) {
          top = above
        } else {
          // Não cabe nem abaixo nem acima — cola no topo com clamp.
          top = Math.max(margin, window.innerHeight - h - margin)
        }
      }

      setPos({ top, left, measured: true })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRect, align, minWidth])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      className={cn(
        'fixed z-50 rounded-md shadow-lg bg-bg-panel border border-border-strong',
        'animate-slide-up text-xs flex flex-col overflow-hidden',
        className
      )}
      style={{
        top: pos.top,
        left: pos.left,
        minWidth,
        maxHeight: 'calc(100vh - 16px)',
        // Pass 1: invisível enquanto mede; Pass 2: revela após reposicionamento.
        visibility: pos.measured ? 'visible' : 'hidden'
      }}
    >
      {children}
    </div>,
    document.body
  )
}
