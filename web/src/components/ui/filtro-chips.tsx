import { type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Opcao<T extends string> {
  valor: T
  rotulo: string
}

/** Filtro de múltipla escolha em botões lado a lado; cada botão liga e desliga uma opção. */
export function FiltroChips<T extends string>({
  rotulo,
  opcoes,
  valores,
  aoMudar,
  className
}: {
  rotulo: string
  opcoes: Array<Opcao<T>>
  valores: T[]
  aoMudar: (valores: T[]) => void
  className?: string
}): ReactNode {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      <span className="text-sm text-text-muted mr-0.5">{rotulo}</span>
      {opcoes.map((o) => {
        const ativo = valores.includes(o.valor)
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={ativo}
            onClick={() =>
              aoMudar(ativo ? valores.filter((v) => v !== o.valor) : [...valores, o.valor])
            }
            className={cn(
              'inline-flex items-center gap-1 h-7 px-2.5 rounded border text-sm transition-colors',
              ativo
                ? 'border-accent bg-accent-glow-strong text-accent font-semibold'
                : 'border-border-strong bg-bg-panel text-text-muted hover:text-text hover:bg-bg-hover'
            )}
          >
            {ativo ? <Check size={12} /> : null}
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}
