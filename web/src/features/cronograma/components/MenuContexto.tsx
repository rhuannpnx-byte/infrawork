/**
 * Menu de contexto das visões (o `ContextMenuHelper` do ApeX no visual do InfraWork): itens com marca, desabilitados,
 * perigosos, separadores e submenus.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ItemMenu =
  | 'sep'
  | {
      rotulo: string
      icone?: ReactNode
      marcado?: boolean
      desabilitado?: boolean
      perigo?: boolean
      padrao?: boolean
      atalho?: string
      acao?: () => void
      sub?: ItemMenu[]
    }

interface Props {
  x: number
  y: number
  itens: ItemMenu[]
  onFechar: () => void
}

export function MenuContexto({ x, y, itens, onFechar }: Props): ReactNode {
  // o foco entra no menu ao abrir (setas, Enter e Esc funcionam) e volta para onde estava ao fechar
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null
    return () => {
      if (anterior && document.contains(anterior) && anterior !== document.body)
        anterior.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const fora = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-menu-contexto]')) onFechar()
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFechar()
    }
    const rolar = (): void => onFechar()
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    window.addEventListener('blur', rolar)
    window.addEventListener('resize', rolar)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
      window.removeEventListener('blur', rolar)
      window.removeEventListener('resize', rolar)
    }
  }, [onFechar])
  return createPortal(
    <Lista x={x} y={y} itens={itens} onFechar={onFechar} focar />,
    document.body
  )
}

function Lista({
  x,
  y,
  itens,
  onFechar,
  lado,
  focar,
  aoVoltar
}: Props & {
  lado?: number
  /** leva o foco ao primeiro item ao abrir */
  focar?: boolean
  /** submenu: seta para a esquerda devolve o foco ao item de origem */
  aoVoltar?: () => void
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [aberto, setAberto] = useState<number | null>(null)
  const [subPos, setSubPos] = useState<{ x: number; y: number; lado: number } | null>(null)
  const [subPeloTeclado, setSubPeloTeclado] = useState(false)

  const ativos = (): HTMLElement[] => [
    ...(ref.current?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not(:disabled)') ??
      [])
  ]
  useEffect(() => {
    if (focar) ativos()[0]?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const abrirSub = (el: HTMLElement, i: number, teclado: boolean): void => {
    const r = el.getBoundingClientRect()
    setAberto(i)
    setSubPeloTeclado(teclado)
    setSubPos({ x: r.right + 2, y: r.top - 4, lado: r.left - 2 })
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth,
      h = el.offsetHeight
    let left = x,
      top = y
    if (left + w > window.innerWidth - 8)
      left = lado !== undefined ? lado - w : window.innerWidth - w - 8
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8)
    setPos({ left: Math.max(8, left), top })
  }, [x, y, lado])

  return (
    <div
      ref={ref}
      data-menu-contexto
      role="menu"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 1100 }}
      className="min-w-[210px] max-w-[320px] rounded border border-border-strong bg-[color:var(--popover)] p-1 shadow-[var(--sombra-flutuante)] animate-slide-up"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const alvo = e.target as HTMLElement
        if (alvo.parentElement !== ref.current) return
        const fs = ativos()
        const i = fs.indexOf(alvo)
        const ir = (el: HTMLElement | undefined): void => {
          e.preventDefault()
          el?.focus()
        }
        if (e.key === 'ArrowDown') ir(fs[(i + 1) % fs.length])
        else if (e.key === 'ArrowUp') ir(fs[(i - 1 + fs.length) % fs.length])
        else if (e.key === 'Home') ir(fs[0])
        else if (e.key === 'End') ir(fs[fs.length - 1])
        else if (e.key === 'ArrowRight' && alvo.hasAttribute('data-sub')) {
          e.preventDefault()
          abrirSub(alvo, Number(alvo.dataset.i), true)
        } else if (e.key === 'ArrowLeft' && aoVoltar) {
          e.preventDefault()
          aoVoltar()
        }
      }}
    >
      {itens.map((it, i) => {
        if (it === 'sep') return <div key={i} className="my-1 h-px bg-border" />
        const temSub = !!it.sub?.length
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            data-i={i}
            data-sub={temSub ? '' : undefined}
            aria-haspopup={temSub ? 'menu' : undefined}
            aria-expanded={temSub ? aberto === i : undefined}
            disabled={it.desabilitado || (it.sub !== undefined && !temSub)}
            onMouseEnter={(e) => {
              if (temSub) abrirSub(e.currentTarget as HTMLElement, i, false)
              else setAberto(null)
            }}
            onClick={(e) => {
              if (temSub) return abrirSub(e.currentTarget as HTMLElement, i, e.detail === 0)
              it.acao?.()
              onFechar()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-left transition-colors',
              'focus-visible:bg-bg-active focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-45',
              it.perigo ? 'text-danger hover:bg-danger/10' : 'text-text hover:bg-bg-hover',
              aberto === i && 'bg-bg-hover',
              it.padrao && 'font-semibold'
            )}
          >
            <span className="w-3.5 shrink-0 flex justify-center text-accent">
              {it.marcado ? <Check size={12} /> : it.icone}
            </span>
            <span className="flex-1 truncate">{it.rotulo}</span>
            {it.atalho ? <span className="tabular text-xs text-text-dim">{it.atalho}</span> : null}
            {it.sub !== undefined ? <ChevronRight size={12} className="text-text-dim" /> : null}
          </button>
        )
      })}
      {aberto !== null &&
      subPos &&
      itens[aberto] !== 'sep' &&
      (itens[aberto] as { sub?: ItemMenu[] }).sub?.length ? (
        <Lista
          x={subPos.x}
          y={subPos.y}
          lado={subPos.lado}
          itens={(itens[aberto] as { sub: ItemMenu[] }).sub}
          onFechar={onFechar}
          focar={subPeloTeclado}
          aoVoltar={() => {
            const origem = ref.current?.querySelector<HTMLElement>(`:scope > [data-i="${aberto}"]`)
            setAberto(null)
            origem?.focus()
          }}
        />
      ) : null}
    </div>
  )
}
