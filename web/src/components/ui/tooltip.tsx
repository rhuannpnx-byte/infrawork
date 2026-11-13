import {
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  content: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactElement
  shortcut?: string
  delay?: number
}

/**
 * Dica ao passar o mouse ou focar. Sai em portal com posição fixa, para não ser cortada por contêiner com
 * rolagem, e fica ligada ao gatilho por `aria-describedby`. Esc esconde.
 */
export function Tooltip({
  content,
  side = 'top',
  children,
  shortcut,
  delay = 250
}: TooltipProps): ReactNode {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const gatilho = useRef<HTMLElement | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mostrar = (e: { currentTarget: EventTarget }): void => {
    gatilho.current = e.currentTarget as HTMLElement
    if (espera.current) clearTimeout(espera.current)
    espera.current = setTimeout(() => setOpen(true), delay)
  }
  const esconder = (): void => {
    if (espera.current) clearTimeout(espera.current)
    setOpen(false)
  }

  useLayoutEffect(() => {
    if (!open || !gatilho.current || !caixa.current) return
    const g = gatilho.current.getBoundingClientRect()
    const c = caixa.current.getBoundingClientRect()
    const folga = 6
    let top = side === 'bottom' ? g.bottom + folga : side === 'top' ? g.top - c.height - folga : 0
    let left = side === 'right' ? g.right + folga : side === 'left' ? g.left - c.width - folga : 0
    if (side === 'top' || side === 'bottom') left = g.left + (g.width - c.width) / 2
    else top = g.top + (g.height - c.height) / 2
    if (side === 'top' && top < 4) top = g.bottom + folga
    top = Math.max(4, Math.min(top, window.innerHeight - c.height - 4))
    left = Math.max(4, Math.min(left, window.innerWidth - c.width - 4))
    setPos({ top, left })
  }, [open, side])

  if (!isValidElement(children)) return children

  const gatilhoEl = cloneElement(children as ReactElement<Record<string, unknown>>, {
    onMouseEnter: mostrar,
    onMouseLeave: esconder,
    onFocus: mostrar,
    onBlur: esconder,
    onKeyDown: (e: { key: string }) => {
      if (e.key === 'Escape') esconder()
    },
    'aria-describedby': open ? id : undefined
  })

  return (
    <>
      {gatilhoEl}
      {open
        ? createPortal(
            <div
              ref={caixa}
              id={id}
              role="tooltip"
              style={{
                position: 'fixed',
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                zIndex: 10020
              }}
              className="pointer-events-none max-w-[320px] rounded border border-border-strong bg-[color:var(--popover)] px-2 py-1 text-xs text-text shadow-[var(--sombra-flutuante)] animate-fade-in"
            >
              {content}
              {shortcut ? <span className="ml-2 tabular text-text-dim">{shortcut}</span> : null}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
