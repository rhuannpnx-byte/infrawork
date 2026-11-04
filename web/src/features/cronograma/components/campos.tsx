/** Peças comuns dos diálogos do cronograma. */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Campo({
  rotulo,
  dica,
  children,
  className
}: {
  rotulo: string
  dica?: string
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <label className={cn('flex flex-col gap-1', className)} title={dica}>
      <span className="text-2xs font-mono uppercase tracking-wider text-text-dim">{rotulo}</span>
      {children}
    </label>
  )
}

export function Caixa({
  marcado,
  onMudar,
  children,
  desabilitado,
  dica
}: {
  marcado: boolean
  onMudar: (v: boolean) => void
  children: ReactNode
  desabilitado?: boolean
  dica?: string
}): ReactNode {
  return (
    <label
      className={cn('flex items-start gap-2 text-xs text-text', desabilitado && 'opacity-50')}
      title={dica}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-[var(--accent)]"
        checked={marcado}
        disabled={desabilitado}
        onChange={(e) => onMudar(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

export function Secao({
  titulo,
  children,
  acoes
}: {
  titulo: string
  children: ReactNode
  acoes?: ReactNode
}): ReactNode {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between border-b border-border pb-1">
        <h3 className="text-2xs font-mono uppercase tracking-wider text-text-muted">{titulo}</h3>
        {acoes}
      </div>
      {children}
    </section>
  )
}
