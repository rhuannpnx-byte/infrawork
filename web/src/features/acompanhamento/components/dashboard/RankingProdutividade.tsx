import { type ReactNode, useMemo } from 'react'
import { Info } from 'lucide-react'
import type { ProdutividadeEquipeItem } from '@/types/acompanhamento'
import { corAderenciaCpu } from '@/lib/colors/aderencia'
import { formatNumber } from '@/lib/format'
import { contar } from '@/lib/rotulos'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'

interface Props {
  itens: ProdutividadeEquipeItem[]
  altura?: number
}

// Mostra UMA linha por (equipe × serviço). Anti-padrao do antigo card:
// agregar somas/medias de servicos com unidades diferentes (m²+m³+t)
// produzia um numero sem significado fisico. Agora cada linha mantem
// sua unidade propria e o pct_aderencia_meta vem direto da view (mediana
// de qtd diaria realizada / producao_diaria_qtde da CPU do orcamento).

export function RankingProdutividade({ itens, altura = 220 }: Props): ReactNode {
  // Ordena por pior aderencia primeiro (com pct definido), depois por qtd_total desc
  const data = useMemo(() => {
    const arr = [...(itens ?? [])]
    return arr.sort((a, b) => {
      const aDef = a.pct_aderencia_meta != null
      const bDef = b.pct_aderencia_meta != null
      if (aDef !== bDef) return aDef ? -1 : 1
      if (aDef && bDef) {
        // distancia do alvo (1.0) — pior primeiro
        const distA = Math.abs(Number(a.pct_aderencia_meta) - 1)
        const distB = Math.abs(Number(b.pct_aderencia_meta) - 1)
        if (distA !== distB) return distB - distA
      }
      return Number(b.qtd_total ?? 0) - Number(a.qtd_total ?? 0)
    })
  }, [itens])

  if (data.length === 0) {
    return (
      <ChartEmptyState message="Sem produção lançada para medir a produtividade." height={altura} />
    )
  }

  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ height: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3 shrink-0">
        <h4 className="text-md font-semibold text-text">Produtividade</h4>
        <span
          className="text-xs text-text-muted inline-flex items-center gap-1 shrink-0"
          title="Aderência: mediana diária realizada dividida pela produção diária da composição do orçamento. De 90 a 110% está no alvo; de 70 a 89% ou de 111 a 130% pede atenção; abaixo de 70% está atrasado e acima de 130% vale revisar a composição."
        >
          <Info size={12} /> aderência à composição
        </span>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Produtividade das equipes"
        className="flex-1 overflow-auto px-4 pb-3 space-y-2"
      >
        {data.map((d) => {
          const pctNum = d.pct_aderencia_meta == null ? null : Number(d.pct_aderencia_meta)
          const pctLabel = pctNum == null ? null : `${Math.round(pctNum * 100)}%`
          const cor = corAderenciaCpu(pctNum)
          const unidade = d.unidade ?? ''
          const mediana = Number(d.qtd_p50 ?? 0)
          const cpuDiario = d.producao_diaria_meta != null ? Number(d.producao_diaria_meta) : null
          const total = Number(d.qtd_total ?? 0)
          const dias = Number(d.dias_trabalhados ?? 0)
          // visual width capa em 100% mas mostra real number a direita
          const barFill = pctNum == null ? 4 : Math.min(100, pctNum * 100)
          const key = `${d.equipe_id ?? d.equipe_display_nome}__${d.item_orcamentario_id ?? d.servico_id ?? d.servico_nome}`
          const equipe = d.equipe_id ? d.equipe_display_nome : 'Sem equipe'
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-sm gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="size-2 rounded-sm shrink-0"
                    style={{ background: d.equipe_cor }}
                  />
                  <span className="text-text truncate" title={`${equipe}: ${d.servico_nome}`}>
                    <span className="font-semibold">{equipe}</span>
                    <span className="text-text-dim mx-1">·</span>
                    <span className="text-text-muted">{d.servico_nome}</span>
                  </span>
                </div>
                <span className="tabular-nums shrink-0 font-semibold" style={{ color: cor }}>
                  {pctLabel ?? '—'}
                </span>
              </div>
              <div className="h-1.5 rounded bg-bg overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{ width: `${barFill}%`, background: cor }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-text-muted gap-2">
                <span className="truncate">
                  {contar(dias, 'dia', 'dias')} · {formatNumber(total, 1)} {unidade} no total
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
