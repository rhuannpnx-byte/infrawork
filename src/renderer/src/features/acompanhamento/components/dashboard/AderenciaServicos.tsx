import { type ReactNode, useMemo } from 'react'
import { Target } from 'lucide-react'
import type { CurvaSPonto, PrevistoRealizadoItem } from '@/types/acompanhamento'
import { STATUS_COMP_COR } from '@/types/acompanhamento'
import { corAderenciaSobreAcumulado } from '@/lib/colors/aderencia'
import { formatNumber } from '@/lib/format'

interface Props {
  itens: PrevistoRealizadoItem[]
  /** Curva-S para calcular planejado acumulado até fim do período. */
  curvaS: CurvaSPonto[]
  /** Data ISO máxima do período filtrado (ex: '2026-05-24') — limite do acumulado planejado. */
  dataAte: string
  selectedId?: string | null
  onPick?: (item_orcamentario_id: string | null) => void
  altura?: number
}

export function AderenciaServicos({ itens, curvaS, dataAte, selectedId, onPick, altura = 200 }: Props): ReactNode {
  const linhas = useMemo(() => {
    // Para cada item, pega o último ponto da curva-S com data <= dataAte → plan_acum_periodo & real_acum_periodo
    const ultimoAteFim = new Map<string, { plan: number; real: number }>()
    const arrPorItem = new Map<string, CurvaSPonto[]>()
    for (const p of curvaS) {
      const k = p.item_orcamentario_id ?? ''
      if (!k) continue
      const arr = arrPorItem.get(k) ?? []
      arr.push(p)
      arrPorItem.set(k, arr)
    }
    for (const [k, arr] of arrPorItem.entries()) {
      arr.sort((a, b) => a.data.localeCompare(b.data))
      let last: CurvaSPonto | null = null
      for (const p of arr) { if (p.data <= dataAte) last = p; else break }
      if (last) {
        ultimoAteFim.set(k, {
          plan: Number(last.planejado_acumulado ?? 0),
          real: Number(last.realizado_acumulado ?? 0)
        })
      }
    }

    return (itens ?? [])
      .filter((i) => i.qtd_plan && i.qtd_plan > 0)
      .map((i) => {
        const ate = ultimoAteFim.get(i.item_orcamentario_id) ?? null
        const planAcumAte = ate ? ate.plan : 0
        const realAcumAte = ate ? ate.real : Number(i.qtd_real ?? 0)
        const pctSobreAcum = planAcumAte > 0 ? realAcumAte / planAcumAte : null
        const corPct = corAderenciaSobreAcumulado(pctSobreAcum)
        // Mantém status (concluido/atrasado/em_risco) baseado no contexto geral, mas a cor da barra usa o pct sobre acumulado
        return {
          id: i.item_orcamentario_id,
          codigo: i.codigo,
          descricao: i.descricao,
          plan: planAcumAte || Number(i.qtd_plan ?? 0),
          real: realAcumAte,
          pct: pctSobreAcum ?? 0,
          pctTotal: Number(i.pct_avanco ?? 0),
          cor: pctSobreAcum != null ? corPct : STATUS_COMP_COR[i.status],
          unidade: i.unidade ?? ''
        }
      })
      .sort((a, b) => b.pct - a.pct)
  }, [itens, curvaS, dataAte])

  return (
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between shrink-0">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <Target size={11} /> Aderência por serviço
        </h4>
        <span className="text-2xs font-mono text-text-dim" title="Real acumulado / Planejado acumulado até o fim do período">
          real / plan acum. período
        </span>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5">
        {linhas.length === 0 && (
          <div className="text-text-dim text-2xs font-mono flex items-center justify-center h-full">
            Sem serviços com plano
          </div>
        )}
        {linhas.map((l) => {
          const pct = Math.round(Math.min(1, l.pct) * 100)
          const sel = selectedId === l.id
          return (
            <button
              key={l.id}
              onClick={() => onPick?.(sel ? null : l.id)}
              className={`w-full text-left rounded p-1.5 transition-colors ${
                sel ? 'bg-accent/10 border border-accent/40' : 'hover:bg-bg-hover border border-transparent'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono mb-1 gap-2">
                <span className="text-text truncate flex items-center gap-1.5 min-w-0">
                  <span className="size-2 rounded-sm shrink-0" style={{ background: l.cor }} />
                  <span className="text-text-dim shrink-0">{l.codigo}</span>
                  <span className="truncate" title={l.descricao}>{l.descricao}</span>
                </span>
                <span style={{ color: l.cor }} className="font-semibold tabular-nums shrink-0">
                  {pct}%
                </span>
              </div>
              <div className="h-1 rounded bg-bg overflow-hidden">
                <div className="h-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: l.cor }} />
              </div>
              <div className="flex items-center justify-between text-2xs font-mono text-text-dim mt-0.5">
                <span className="tabular-nums">{fmt(l.real)} / {fmt(l.plan)} {l.unidade}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function fmt(v: number): string {
  return formatNumber(v, 0)
}
