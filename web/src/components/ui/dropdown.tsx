import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useCamadaAberta } from './camada-modal'

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

const itens = (menu: HTMLElement | null): HTMLElement[] =>
  menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')] : []

/**
 * Menu de ações. Abre com clique, Enter ou seta para baixo no gatilho; dentro dele as setas, Home e End movem o
 * foco, Esc e Tab fecham, e o foco volta para o gatilho.
 */
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
      const menuH = menuRef.current?.offsetHeight ?? 0
      // sem espaço abaixo, abre para cima; nunca sai da janela pelos lados
      const cabeAbaixo = r.bottom + 4 + menuH <= window.innerHeight - 8
      const top = cabeAbaixo || r.top - 4 - menuH < 8 ? r.bottom + 4 : r.top - 4 - menuH
      const bruto = align === 'end' ? r.right - menuW : r.left
      const left = Math.max(8, Math.min(bruto, window.innerWidth - menuW - 8))
      setPos({ top, left })
    }
    update()
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, align])

  useCamadaAberta(open)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.querySelector<HTMLElement>('button, [tabindex], a')?.focus()
        return
      }
      if (e.key === 'Tab') {
        setOpen(false)
        return
      }
      const lista = itens(menuRef.current)
      if (!lista.length) return
      const atual = lista.indexOf(document.activeElement as HTMLElement)
      let proximo = -1
      if (e.key === 'ArrowDown') proximo = (atual + 1) % lista.length
      else if (e.key === 'ArrowUp') proximo = (atual - 1 + lista.length) % lista.length
      else if (e.key === 'Home') proximo = 0
      else if (e.key === 'End') proximo = lista.length - 1
      if (proximo < 0) return
      e.preventDefault()
      lista[proximo].focus()
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Com o menu posicionado, o foco vai para o primeiro item.
  const posicionado = open && pos !== null
  useEffect(() => {
    if (posicionado) itens(menuRef.current)[0]?.focus({ preventScroll: true })
  }, [posicionado])

  return (
    <>
      <div
        ref={triggerRef}
        className="relative inline-block"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {trigger}
      </div>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
              className={cn(
                'min-w-[180px] rounded-md border border-border-strong bg-[color:var(--popover)] p-1 shadow-[var(--sombra-flutuante)] animate-slide-up',
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
  /** Motivo quando desabilitado, ou explicação curta da ação. */
  title?: string
}

export function DropdownItem({
  onClick,
  children,
  shortcut,
  disabled,
  variant = 'default',
  title
}: DropdownItemProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'flex w-full min-h-8 items-center justify-between gap-3 rounded-sm px-2 py-1 text-sm text-left transition-colors',
        'focus-visible:outline-none focus-visible:bg-bg-active',
        'disabled:cursor-not-allowed disabled:text-text-dim',
        variant === 'danger' ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-bg-hover'
      )}
    >
      <span className="flex items-center gap-2">{children}</span>
      {shortcut ? <span className="tabular text-xs text-text-dim">{shortcut}</span> : null}
    </button>
  )
}

export function DropdownSeparator(): ReactNode {
  return <div role="separator" className="my-1 h-px bg-border" />
}

export function DropdownLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="px-2 pt-1.5 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
      {children}
    </div>
  )
}
