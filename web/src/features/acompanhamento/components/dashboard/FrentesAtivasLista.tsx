import { type ReactNode } from 'react'
import type { FrenteAtiva } from '@/types/acompanhamento'
import { contar } from '@/lib/rotulos'

interface Props {
  frentes: FrenteAtiva[]
  altura?: number
}

export function FrentesAtivasLista({ frentes, altura = 200 }: Props): ReactNode {
  const dados = (frentes ?? []).slice(0, 8)

  const maxRegistros =
    dados.reduce((m, f) => Math.max(m, Number(f.registros_ultima_semana ?? 0)), 0) || 1

  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-md font-semibold text-text flex items-center gap-1.5">
          Frentes ativas
        </h4>
        <span className="text-xs text-text-muted">últimos 7 dias</span>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Frentes ativas"
        className="flex-1 overflow-auto px-4 pb-3 space-y-1.5"
      >
        {dados.length === 0 && (
          <div className="text-sm text-text-muted flex items-center justify-center h-full text-center px-3">
            Nenhuma frente com lançamento nos últimos 7 dias.
          </div>
        )}
        {dados.map((f) => {
          const pct = Math.round((Number(f.registros_ultima_semana ?? 0) / maxRegistros) * 100)
          return (
            <div key={f.frente} className="space-y-0.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text truncate" title={f.frente}>
                  {f.frente}
                </span>
                <span className="text-text-muted tabular-nums shrink-0 ml-2">
                  {contar(Number(f.dias_ativos ?? 0), 'dia', 'dias')}
                </span>
              </div>
              <div className="h-1.5 bg-bg-elevated overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${Math.max(4, pct)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span className="truncate" title={(f.equipes ?? []).join(', ')}>
                  {(f.equipes ?? []).join(', ')}
                </span>
                <span className="tabular-nums shrink-0 ml-2">
                  {contar(Number(f.registros ?? 0), 'lançamento', 'lançamentos')}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
