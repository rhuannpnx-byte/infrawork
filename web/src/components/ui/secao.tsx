import { type CSSProperties, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { cn } from '@/lib/utils'

interface SecaoProps {
  titulo: string
  /** Frase curta ao lado do título: o que o bloco mostra ou como ler. */
  nota?: ReactNode
  /** Controles à direita do cabeçalho. */
  acoes?: ReactNode
  /** Atalho "ver mais": rótulo e rota. */
  verMais?: { rotulo: string; rota: string }
  /** Sem recuo no corpo, para tabelas e listas que vão de borda a borda. */
  semRecuo?: boolean
  className?: string
  corpoClassName?: string
  style?: CSSProperties
  children: ReactNode
}

/** Bloco de conteúdo com título: a moldura única dos painéis das telas. */
export function Secao({
  titulo,
  nota,
  acoes,
  verMais,
  semRecuo,
  className,
  corpoClassName,
  style,
  children
}: SecaoProps): ReactNode {
  return (
    <section
      aria-label={titulo}
      style={style}
      className={cn('min-w-0 flex flex-col bg-bg-panel border border-border rounded', className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3 pb-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 min-w-0">
          <h2 className="text-lg font-semibold text-text">{titulo}</h2>
          {nota ? <span className="text-sm text-text-muted">{nota}</span> : null}
        </div>
        {acoes || verMais ? (
          <div className="flex flex-wrap items-center gap-2">
            {acoes}
            {verMais ? (
              <button
                type="button"
                onClick={() => navigateActiveTab(verMais.rota)}
                className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline rounded"
              >
                {verMais.rotulo} <ArrowRight size={13} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className={cn('min-h-0 flex-1', !semRecuo && 'px-4 pb-4', corpoClassName)}>
        {children}
      </div>
    </section>
  )
}
