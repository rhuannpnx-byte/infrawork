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
  return createPortal(<Lista x={x} y={y} itens={itens} onFechar={onFechar} />, document.body)
}

function Lista({ x, y, itens, onFechar, lado }: Props & { lado?: number }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [aberto, setAberto] = useState<number | null>(null)
  const [subPos, setSubPos] = useState<{ x: number; y: number; lado: number } | null>(null)

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
      className="min-w-[210px] max-w-[320px] rounded-md border border-border-strong bg-bg-elevated p-1 shadow-xl animate-slide-up"
      onContextMenu={(e) => e.preventDefault()}
    >
      {itens.map((it, i) => {
        if (it === 'sep') return <div key={i} className="my-1 h-px bg-border" />
        const temSub = !!it.sub?.length
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.desabilitado || (it.sub !== undefined && !temSub)}
            onMouseEnter={(e) => {
              if (temSub) {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setAberto(i)
                setSubPos({ x: r.right + 2, y: r.top - 4, lado: r.left - 2 })
              } else setAberto(null)
            }}
            onClick={() => {
              if (temSub) return
              it.acao?.()
              onFechar()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-left transition-colors',
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
            {it.atalho ? (
              <span className="font-mono text-2xs text-text-faint">{it.atalho}</span>
            ) : null}
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
        />
      ) : null}
    </div>
  )
}
