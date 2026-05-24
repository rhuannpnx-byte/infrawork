import { type ReactNode, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { ProdutividadeEquipeItem } from '@/types/acompanhamento'

interface Props { itens: ProdutividadeEquipeItem[]; altura?: number }

interface Agg {
  equipe_nome: string
  cor: string
  vinculada: boolean
  dias: number
  qtd_total: number
  aderencia: number | null
  servicos: number
}

export function RankingProdutividade({ itens, altura = 200 }: Props): ReactNode {
  const data = useMemo<Agg[]>(() => {
    const map = new Map<string, Agg>()
    for (const i of itens ?? []) {
      const key = i.siga_equipe_nome
      const cur = map.get(key) ?? {
        equipe_nome: i.equipe_display_nome ?? i.siga_equipe_nome,
        cor: i.equipe_cor ?? '#94a3b8',
        vinculada: !!i.equipe_planejamento_id,
        dias: 0,
        qtd_total: 0,
        aderencia: null as number | null,
        servicos: 0
      }
      cur.dias = Math.max(cur.dias, Number(i.dias_trabalhados ?? 0))
      cur.qtd_total += Number(i.qtd_total ?? 0)
      cur.servicos += 1
      if (i.pct_aderencia_cpu != null) {
        const a = Number(i.pct_aderencia_cpu)
        cur.aderencia = cur.aderencia == null ? a : (cur.aderencia + a) / 2
      }
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.qtd_total - a.qtd_total).slice(0, 6)
  }, [itens])

  if (data.length === 0) {
    return (
      <div className="rounded border border-border bg-bg-panel p-4 text-text-dim text-2xs font-mono flex items-center justify-center" style={{ height: altura }}>
        Sem dados de produtividade
      </div>
    )
  }

  return (
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text">Produtividade por equipe</h4>
        <span className="text-2xs font-mono text-text-dim">% aderência CPU</span>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-2">
        {data.map((d) => {
          const pct = d.aderencia != null ? Math.round(d.aderencia * 100) : null
          const corBarra = pct == null ? '#64748b' : pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444'
          return (
            <div key={d.equipe_nome} className="space-y-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="size-2 rounded-sm shrink-0" style={{ background: d.cor }} />
                  <span className="text-text truncate" title={d.equipe_nome}>{d.equipe_nome}</span>
                  {!d.vinculada && (
                    <span className="text-2xs text-text-dim italic shrink-0">(não vinculada)</span>
                  )}
                </div>
                <div className={cn('tabular-nums', pct == null ? 'text-text-dim' : 'text-text')}>
                  {pct == null ? '—' : `${pct}%`}
                </div>
              </div>
              <div className="h-1.5 rounded bg-bg overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{ width: pct == null ? '4%' : `${Math.min(100, pct)}%`, background: corBarra }}
                />
              </div>
              <div className="flex items-center justify-between text-2xs font-mono text-text-dim">
                <span>{d.dias} dias · {d.servicos} serviços</span>
                <span className="tabular-nums">{d.qtd_total.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
