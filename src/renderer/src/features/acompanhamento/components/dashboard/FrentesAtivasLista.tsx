import { type ReactNode } from 'react'
import { MapPin } from 'lucide-react'
import type { FrenteAtiva } from '@/types/acompanhamento'
import { formatNumber } from '@/lib/format'

interface Props { frentes: FrenteAtiva[]; altura?: number }

export function FrentesAtivasLista({ frentes, altura = 200 }: Props): ReactNode {
  const dados = (frentes ?? []).slice(0, 8)

  const maxRegistros = dados.reduce((m, f) => Math.max(m, Number(f.registros_ultima_semana ?? 0)), 0) || 1

  return (
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <MapPin size={11} /> Frentes ativas
        </h4>
        <span className="text-2xs font-mono text-text-dim">últ. 7d</span>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5">
        {dados.length === 0 && (
          <div className="text-text-dim text-2xs font-mono flex items-center justify-center h-full">
            Sem frente ativa
          </div>
        )}
        {dados.map((f) => {
          const pct = Math.round((Number(f.registros_ultima_semana ?? 0) / maxRegistros) * 100)
          return (
            <div key={f.frente} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-text truncate" title={f.frente}>{f.frente}</span>
                <span className="text-text-dim tabular-nums shrink-0 ml-2">{f.dias_ativos}d</span>
              </div>
              <div className="h-1 rounded bg-bg overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${Math.max(4, pct)}%` }} />
              </div>
              <div className="flex items-center justify-between text-2xs font-mono text-text-dim">
                <span className="truncate" title={(f.equipes ?? []).join(', ')}>{(f.equipes ?? []).join(', ')}</span>
                <span className="tabular-nums shrink-0 ml-2">{formatNumber(Number(f.qtd_total ?? 0), 0)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
