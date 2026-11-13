import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Opcao<T extends string> {
  valor: T
  rotulo: ReactNode
  titulo?: string
  desabilitado?: boolean
}

interface SegmentadoProps<T extends string> {
  /** Nome do grupo para leitores de tela. */
  rotulo: string
  valor: T | null
  opcoes: Array<Opcao<T>>
  aoMudar: (valor: T) => void
  tamanho?: 'sm' | 'md'
  className?: string
}

/** Escolha única entre poucas opções, lado a lado. Setas trocam a opção. */
export function Segmentado<T extends string>({
  rotulo,
  valor,
  opcoes,
  aoMudar,
  tamanho = 'md',
  className
}: SegmentadoProps<T>): ReactNode {
  const ref = useRef<HTMLDivElement>(null)

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>): void => {
    const passo =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!passo) return
    e.preventDefault()
    const ativas = opcoes.filter((o) => !o.desabilitado)
    const atual = ativas.findIndex((o) => o.valor === valor)
    const proxima = ativas[(atual + passo + ativas.length) % ativas.length]
    if (!proxima) return
    aoMudar(proxima.valor)
    const i = opcoes.indexOf(proxima)
    ref.current?.querySelectorAll<HTMLButtonElement>('button')[i]?.focus()
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={rotulo}
      onKeyDown={aoTeclar}
      className={cn(
        'inline-flex shrink-0 rounded border border-border-strong bg-bg-panel overflow-hidden',
        className
      )}
    >
      {opcoes.map((o, i) => {
        const marcado = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={marcado}
            tabIndex={marcado || (valor == null && i === 0) ? 0 : -1}
            disabled={o.desabilitado}
            title={o.titulo}
            onClick={() => aoMudar(o.valor)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              tamanho === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              i > 0 && 'border-l border-border-strong',
              marcado
                ? 'bg-accent-glow-strong text-accent font-semibold'
                : 'text-text-muted hover:text-text hover:bg-bg-hover'
            )}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}
