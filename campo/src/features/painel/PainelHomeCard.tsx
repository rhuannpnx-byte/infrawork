import { ChevronRight, LineChart } from 'lucide-react'
import { usePainel } from '@/core/db/daos'
import { cn } from '@/lib/cn'
import { idadeDados, moeda, pct } from './lib'

/** Cartão da home (engenheiro, adm e god): entrada da visão estratégica com o avanço e o valor executado guardados. */
export function PainelHomeCard({
  obraId,
  enabled,
  onClick,
}: {
  obraId: string | null | undefined
  enabled: boolean
  onClick: () => void
}) {
  const painel = usePainel(obraId)
  const idade = painel ? idadeDados(painel.fetchedAt) : null
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      data-testid="card-visao-estrategica"
      className={cn(
        'group w-full overflow-hidden rounded-lg border border-accent/40 bg-bg-panel text-left',
        'transition-colors duration-150 ease-out',
        enabled ? 'hover:border-accent active:bg-bg-elevated' : 'cursor-not-allowed opacity-40',
      )}
    >
      <div className="flex items-center gap-4 px-4 py-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent-glow text-accent">
          <LineChart className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-accent">
            Visão estratégica
          </p>
          {painel ? (
            <>
              <p className="mt-1 font-mono text-base text-on-surface tabular">
                <span className="whitespace-nowrap">{pct(painel.resumo.avanco)} físico</span>
                {' · '}
                <span className="whitespace-nowrap">{moeda(painel.financeiro.executado)}</span>
              </p>
              <p
                className={cn(
                  'mt-0.5 text-[11px]',
                  idade?.antigo ? 'text-warn' : 'text-on-surface-muted',
                )}
              >
                Avanço, serviços e equipes · dados de {idade?.texto}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-on-surface-dim">
              Avanço, serviços, equipes e valor agregado da obra
            </p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-on-surface-muted" />
      </div>
    </button>
  )
}
