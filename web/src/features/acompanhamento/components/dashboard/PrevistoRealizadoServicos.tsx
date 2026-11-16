import { type ReactNode, useMemo } from 'react'
import type { CurvaSPonto, PrevistoRealizadoItem } from '@/types/acompanhamento'
import { Secao } from '@/components/ui/secao'
import { corAderenciaSobreAcumulado } from '@/lib/colors/aderencia'
import { formatNumber } from '@/lib/format'
import { acumuladoAte } from '@/features/acompanhamento/lib/acumulado-ate'
import { cn } from '@/lib/utils'

interface Props {
  itens: PrevistoRealizadoItem[]
  curvaS: CurvaSPonto[]
  /** Fim do período filtrado: limite do planejado e do realizado acumulados. */
  dataAte: string
  selectedId?: string | null
  onPick?: (item_orcamentario_id: string | null) => void
  altura?: number
}

interface Linha {
  id: string
  codigo: string
  descricao: string
  unidade: string
  total: number
  plan: number
  real: number
  cor: string
}

const qtd = (v: number): string => formatNumber(v, Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 2)
const pct = (v: number, de: number): number => (de > 0 ? Math.min(100, (v / de) * 100) : 0)

/** Quantidade total, planejada e realizada de cada serviço da linha de base, até o fim do período. */
export function PrevistoRealizadoServicos({
  itens,
  curvaS,
  dataAte,
  selectedId,
  onPick,
  altura = 300
}: Props): ReactNode {
  const linhas = useMemo<Linha[]>(() => {
    const ate = acumuladoAte(curvaS, dataAte)
    return (itens ?? [])
      .filter((i) => Number(i.qtd_plan ?? 0) > 0)
      .map((i) => {
        const a = ate.get(i.item_orcamentario_id)
        const plan = a?.plan ?? 0
        const real = a?.real ?? Number(i.qtd_real ?? 0)
        return {
          id: i.item_orcamentario_id,
          codigo: i.codigo,
          descricao: i.descricao,
          unidade: i.unidade ?? '',
          total: Number(i.qtd_plan),
          plan,
          real,
          cor: corAderenciaSobreAcumulado(plan > 0 ? real / plan : null)
        }
      })
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  }, [itens, curvaS, dataAte])

  return (
    <Secao
      titulo="Previsto e realizado por serviço"
      nota="quantidades acumuladas até o fim do período"
      semRecuo
      style={{ height: altura }}
    >
      {linhas.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 pb-4 text-sm text-text-muted">
          Nenhum serviço na linha de base.
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-label="Previsto e realizado por serviço"
          className="h-full overflow-auto"
        >
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-bg-panel text-xs text-text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-1.5 text-left font-medium">
                  Serviço
                </th>
                <th scope="col" className="w-14 px-2 py-1.5 text-left font-medium">
                  Un.
                </th>
                <th scope="col" className="w-28 px-2 py-1.5 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="w-28 px-2 py-1.5 text-right font-medium">
                  Planejado
                </th>
                <th scope="col" className="w-28 px-2 py-1.5 text-right font-medium">
                  Realizado
                </th>
                <th scope="col" className="w-48 py-1.5 pl-3 pr-4 text-left font-medium">
                  <span className="sr-only">Avanço sobre o total</span>
                  <span aria-hidden className="flex items-center gap-3 font-normal">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-3 rounded-sm bg-text-muted" /> realizado
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-0.5 bg-text" /> planejado
                    </span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const sel = selectedId === l.id
                const pReal = pct(l.real, l.total)
                const pPlan = pct(l.plan, l.total)
                return (
                  <tr
                    key={l.id}
                    className={cn(
                      'border-b border-border last:border-b-0',
                      sel ? 'bg-bg-active' : 'hover:bg-bg-hover'
                    )}
                  >
                    <td className="px-4 py-1.5">
                      <button
                        type="button"
                        onClick={() => onPick?.(sel ? null : l.id)}
                        aria-pressed={sel}
                        title={`${l.codigo} · ${l.descricao}`}
                        className="flex w-full min-w-0 items-baseline gap-2 rounded text-left"
                      >
                        <span className="shrink-0 text-text-muted tabular">{l.codigo}</span>
                        <span className="truncate text-text">{l.descricao}</span>
                      </button>
                    </td>
                    <td className="truncate px-2 py-1.5 text-text-muted">{l.unidade}</td>
                    <td className="px-2 py-1.5 text-right tabular text-text-muted">
                      {qtd(l.total)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-text">{qtd(l.plan)}</td>
                    <td className="px-2 py-1.5 text-right tabular font-semibold text-text">
                      {qtd(l.real)}
                    </td>
                    <td className="py-1.5 pl-3 pr-4">
                      <div
                        className="relative h-2 bg-bg-elevated"
                        title={`Realizado ${Math.round(pReal)}% e planejado ${Math.round(pPlan)}% do total`}
                      >
                        <div
                          className="absolute inset-y-0 left-0"
                          style={{ width: `${pReal}%`, background: l.cor }}
                        />
                        {l.plan > 0 ? (
                          <div
                            className="absolute -inset-y-0.5 w-0.5 bg-text"
                            style={{ left: `calc(${pPlan}% - 1px)` }}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  )
}
