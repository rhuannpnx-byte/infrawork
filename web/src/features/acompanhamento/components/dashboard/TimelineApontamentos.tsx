import { type ReactNode } from 'react'
import type { DashboardResumoResposta } from '@/types/acompanhamento'
import { formatNumber } from '@/lib/format'
import { diaMesBR as dataBR } from '@/lib/format/local-date'

interface Props {
  itens: DashboardResumoResposta['ultimos_apontamentos']
  altura?: number
}

export function TimelineApontamentos({ itens, altura = 200 }: Props): ReactNode {
  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-md font-semibold text-text flex items-center gap-1.5">
          Últimos lançamentos
        </h4>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Últimos lançamentos"
        className="flex-1 overflow-auto px-4 pb-3 space-y-1.5"
      >
        {itens.length === 0 && (
          <div className="text-sm text-text-muted flex items-center justify-center h-full text-center px-3">
            Nenhum lançamento ainda.
          </div>
        )}
        {itens.map((i) => {
          // Quando o fator != 1, mostra qtd convertida na unidade do plano
          // (ex.: lançado em m² → t). Senão mostra a qtd lançada.
          const converteu = Number(i.fator_conversao ?? 1) !== 1
          const valor = converteu ? Number(i.qtd_convertida ?? 0) : Number(i.qtd ?? 0)
          const unidade = converteu ? i.unidade_plano : (i.unidade ?? i.unidade_plano)
          return (
            <div key={i.id} className="flex items-start gap-2 text-sm">
              <div
                className="size-2 mt-1 rounded-full shrink-0"
                style={{ background: i.equipe_display_cor ?? 'var(--text-dim)' }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="text-text truncate"
                    title={i.servico_display_nome ?? i.servico_nome ?? ''}
                  >
                    {i.servico_display_nome ?? i.servico_nome ?? '—'}
                  </div>
                  <div className="text-text shrink-0 tabular-nums font-semibold">
                    {formatNumber(valor, 2)}
                    {unidade ? (
                      <span className="ml-1 font-normal text-text-muted">{unidade}</span>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-text-muted truncate">
                  {[
                    dataBR(i.data),
                    i.equipe_display_nome && i.equipe_display_nome !== '—'
                      ? i.equipe_display_nome
                      : 'Sem equipe',
                    i.frente && i.frente !== '(sem frente)' ? i.frente : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
