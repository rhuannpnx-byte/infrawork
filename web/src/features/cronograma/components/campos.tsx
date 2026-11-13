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
      <span className="text-sm font-medium text-text">{rotulo}</span>
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
      className={cn(
        'flex items-start gap-2 text-sm',
        desabilitado ? 'text-text-dim' : 'text-text cursor-pointer'
      )}
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
        <h3 className="text-md font-semibold text-text">{titulo}</h3>
        {acoes}
      </div>
      {children}
    </section>
  )
}
