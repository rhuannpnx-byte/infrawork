import { type ReactNode, useMemo } from 'react'
import { Info } from 'lucide-react'
import type { ProdutividadeEquipeItem } from '@/types/acompanhamento'
import { corAderenciaCpu } from '@/lib/colors/aderencia'
import { formatNumber } from '@/lib/format'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'

interface Props { itens: ProdutividadeEquipeItem[]; altura?: number }

// Mostra UMA linha por (equipe × serviço). Anti-padrao do antigo card:
// agregar somas/medias de servicos com unidades diferentes (m²+m³+t)
// produzia um numero sem significado fisico. Agora cada linha mantem
// sua unidade propria e o pct_aderencia_cpu vem direto da view (mediana
// de qtd diaria realizada / producao_diaria_qtde da CPU do orcamento).

export function RankingProdutividade({ itens, altura = 220 }: Props): ReactNode {
  // Ordena por pior aderencia primeiro (com pct definido), depois por qtd_total desc
  const data = useMemo(() => {
    const arr = [...(itens ?? [])]
    return arr.sort((a, b) => {
      const aDef = a.pct_aderencia_cpu != null
      const bDef = b.pct_aderencia_cpu != null
      if (aDef !== bDef) return aDef ? -1 : 1
      if (aDef && bDef) {
        // distancia do alvo (1.0) — pior primeiro
        const distA = Math.abs(Number(a.pct_aderencia_cpu) - 1)
        const distB = Math.abs(Number(b.pct_aderencia_cpu) - 1)
        if (distA !== distB) return distB - distA
      }
      return Number(b.qtd_total ?? 0) - Number(a.qtd_total ?? 0)
    })
  }, [itens])

  if (data.length === 0) {
    return <ChartEmptyState message="Sem dados de produtividade" height={altura} />
  }

  return (
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between shrink-0">
        <h4 className="text-xs font-semibold text-text">Produtividade por equipe × serviço</h4>
        <span
          className="text-2xs font-mono text-text-dim inline-flex items-center gap-1"
          title="Aderência = mediana diária realizada / produção diária esperada pela CPU do orçamento. 90-110% = no alvo (verde); 70-89% ou 111-130% = atenção (amarelo); <70% atrasado ou >130% revisar CPU (vermelho)."
        >
          <Info size={10} /> aderência CPU
        </span>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-2">
        {data.map((d) => {
          const pctNum = d.pct_aderencia_cpu == null ? null : Number(d.pct_aderencia_cpu)
          const pctLabel = pctNum == null ? null : `${Math.round(pctNum * 100)}%`
          const cor = corAderenciaCpu(pctNum)
          const unidade = d.unidade ?? ''
          const mediana = Number(d.qtd_p50 ?? 0)
          const cpuDiario = d.producao_diaria_cpu != null ? Number(d.producao_diaria_cpu) : null
          const total = Number(d.qtd_total ?? 0)
          const dias = Number(d.dias_trabalhados ?? 0)
          // visual width capa em 100% mas mostra real number a direita
          const barFill = pctNum == null ? 4 : Math.min(100, pctNum * 100)
          const key = `${d.siga_equipe_nome}__${d.siga_servico_id ?? d.servico_nome}`
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-xs font-mono gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="size-2 rounded-sm shrink-0" style={{ background: d.equipe_cor }} />
                  <span className="text-text truncate" title={`${d.equipe_display_nome} — ${d.servico_nome}`}>
                    <span className="font-semibold">{d.equipe_display_nome}</span>
                    <span className="text-text-dim mx-1">·</span>
                    <span className="text-text-muted">{d.servico_nome}</span>
                  </span>
                  {!d.equipe_planejamento_id && (
                    <span className="text-2xs text-text-dim italic shrink-0">(n/v)</span>
                  )}
                </div>
                <span
                  className="tabular-nums shrink-0 font-semibold"
                  style={{ color: cor }}
                >
                  {pctLabel ?? '—'}
                </span>
              </div>
              <div className="h-1.5 rounded bg-bg overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{ width: `${barFill}%`, background: cor }}
                />
              </div>
              <div className="flex items-center justify-between text-2xs font-mono text-text-dim gap-2">
                <span className="truncate">
                  {dias} dia{dias !== 1 ? 's' : ''} · {formatNumber(total, 1)} {unidade} total
                </span>
                <span className="tabular-nums shrink-0">
                  {formatNumber(mediana, 1)}
                  {cpuDiario != null ? (
                    <>
                      <span className="text-text-dim"> / </span>
                      {formatNumber(cpuDiario, 1)}
                    </>
                  ) : null}
                  {unidade ? <span className="ml-0.5">{unidade}/dia</span> : null}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
