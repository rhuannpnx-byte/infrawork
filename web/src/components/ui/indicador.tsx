import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Tom = 'neutro' | 'success' | 'warn' | 'danger'

const TOM: Record<Tom, string> = {
  neutro: 'text-text',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger'
}

/**
 * Faixa de indicadores: uma folha só, com os indicadores separados por linha. Substitui a grade de cartões soltos
 * (um cartão por número), que dava o mesmo peso a tudo.
 */
export function FaixaIndicadores({
  children,
  className,
  rotulo
}: {
  children: ReactNode
  className?: string
  rotulo?: string
}): ReactNode {
  return (
    <section
      aria-label={rotulo}
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] bg-bg-panel border border-border rounded overflow-hidden',
        className
      )}
    >
      {children}
    </section>
  )
}

interface IndicadorProps {
  rotulo: string
  valor: ReactNode
  unidade?: string
  /** Cor do valor; o padrão é a tinta do texto. */
  tom?: Tom
  /** `sm` para faixas com muitos indicadores; o padrão destaca o número. */
  tamanho?: 'sm' | 'md'
  carregando?: boolean
  titulo?: string
  /** Linhas de apoio abaixo do valor (uma por filho). */
  children?: ReactNode
  className?: string
}

export function Indicador({
  rotulo,
  valor,
  unidade,
  tom = 'neutro',
  tamanho = 'md',
  carregando,
  titulo,
  children,
  className
}: IndicadorProps): ReactNode {
  return (
    <div
      title={titulo}
      className={cn(
        'px-4 py-3 min-w-0 flex flex-col gap-1 text-sm text-text-muted',
        'shadow-[1px_0_0_0_var(--border),0_1px_0_0_var(--border)]',
        className
      )}
    >
      <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
        {rotulo}
      </span>
      {carregando ? (
        <span
          aria-hidden
          className={cn(
            'block w-24 bg-bg-elevated animate-pulse',
            tamanho === 'sm' ? 'h-6' : 'h-8'
          )}
        />
      ) : (
        <span
          className={cn(
            'font-semibold tabular leading-tight whitespace-nowrap',
            tamanho === 'sm' ? 'text-xl' : 'text-3xl',
            TOM[tom]
          )}
        >
          {valor}
          {unidade ? (
            <span className="ml-1 text-sm font-normal text-text-muted">{unidade}</span>
          ) : null}
        </span>
      )}
      {carregando ? null : children}
    </div>
  )
}

/** Barra fina de avanço para usar dentro de um Indicador. `marca` é o previsto (0–1). */
export function BarraAvanco({
  valor,
  marca,
  tom = 'accent',
  className
}: {
  valor: number
  marca?: number | null
  tom?: 'accent' | 'success' | 'warn' | 'danger'
  className?: string
}): ReactNode {
  const cor =
    tom === 'success'
      ? 'bg-success'
      : tom === 'warn'
        ? 'bg-warn'
        : tom === 'danger'
          ? 'bg-danger'
          : 'bg-accent'
  const limitar = (v: number): number => Math.max(0, Math.min(v, 1)) * 100
  return (
    <div className={cn('relative h-2 bg-bg-elevated border border-border', className)}>
      <div className={cn('h-full', cor)} style={{ width: `${limitar(valor)}%` }} />
      {marca != null ? (
        <span
          className="absolute -top-1 -bottom-1 w-0.5 bg-text"
          style={{ left: `${limitar(marca)}%` }}
        />
      ) : null}
    </div>
  )
}
