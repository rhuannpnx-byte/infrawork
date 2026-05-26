import { type ReactNode } from 'react'
import { Activity } from 'lucide-react'
import type { DashboardResumoResposta } from '@/types/acompanhamento'

interface Props {
  itens: DashboardResumoResposta['ultimos_apontamentos']
  altura?: number
}

export function TimelineApontamentos({ itens, altura = 200 }: Props): ReactNode {
  return (
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <Activity size={11} /> Últimos apontamentos
        </h4>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5">
        {itens.length === 0 && (
          <div className="text-text-dim text-2xs font-mono flex items-center justify-center h-full">
            Sem apontamentos
          </div>
        )}
        {itens.map((i) => {
          // Quando ha match e fator != 1, mostra qtd convertida na unidade
          // do plano (ex: CBUQ apontado em m² -> t). Senao mostra raw.
          const converteu = i.servico_match_id && Number(i.fator_conversao ?? 1) !== 1
          const valor = converteu ? Number(i.qtd_convertida ?? 0) : Number(i.qtd ?? 0)
          const unidade = converteu ? i.unidade_plano : (i.siga_unidade_nome ?? i.unidade_plano)
          return (
            <div key={i.id} className="flex items-start gap-2 text-xs">
              <div
                className="size-2 mt-1 rounded-full shrink-0"
                style={{ background: i.equipe_display_cor ?? '#94a3b8' }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-text truncate" title={i.servico_display_nome ?? i.siga_servico_nome ?? ''}>
                    {i.servico_display_nome ?? i.siga_servico_nome ?? '—'}
                  </div>
                  <div className="text-2xs font-mono text-text-dim shrink-0 tabular-nums">
                    {valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                    {unidade ? <span className="ml-1">{unidade}</span> : null}
                  </div>
                </div>
                <div className="text-2xs font-mono text-text-dim truncate">
                  {i.equipe_display_nome ?? '—'} · {i.frente ?? '—'} · {i.data ?? '—'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
