import { type ReactNode, useMemo } from 'react'
import { Scale } from 'lucide-react'
import type { CurvaSPonto, PrevistoRealizadoItem } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'

interface Props {
  curvaS: CurvaSPonto[]
  prevReal: PrevistoRealizadoItem[]
  /** Filtra para 1 servico_grupo (item_orcamentario_id) se informado */
  filtroItemId?: string | null
  /** Janela do período (dias) para "do período" */
  periodoDias: number
  /** Data início custom — se nulo, usa today-periodoDias */
  dataDeCustom?: string | null
  dataAteCustom?: string | null
  altura?: number
}

interface Resumo {
  plan_acum_ate_hoje: number
  real_acum_ate_hoje: number
  plan_periodo: number
  real_periodo: number
  aderencia_acum: number | null
  aderencia_periodo: number | null
}

function calcular(
  curvaS: CurvaSPonto[],
  prevReal: PrevistoRealizadoItem[],
  filtroItemId: string | null | undefined,
  janelaIni: Date,
  janelaFim: Date
): Resumo {
  // "Acumulado ate hoje": vem de vw_acompanhamento_previsto_x_realizado.
  //   Esta view soma toda producao sem janela de tarefa, batendo com a subpage
  //   "Previsto x Realizado". Antes usavamos curva_s para esse calculo, mas a
  //   curva_s gera dias apenas dentro de [data_inicio, max(data_fim,hoje)] —
  //   producao SIGA apontada antes de data_inicio caia fora do LEFT JOIN.
  //
  // "No periodo": vem de curva_s (acumulado_fim - acumulado_ini-1). Mesmo
  //   limite — se a janela inclui dias anteriores a data_inicio da tarefa,
  //   esses dias contam 0. Ok para janelas dentro da execucao planejada.
  const prevFiltered = filtroItemId
    ? prevReal.filter((p) => p.item_orcamentario_id === filtroItemId)
    : prevReal

  let planAcumHoje = 0
  let realAcumHoje = 0
  for (const p of prevFiltered) {
    planAcumHoje += Number(p.qtd_plan ?? 0)
    realAcumHoje += Number(p.qtd_real ?? 0)
  }

  // No periodo via curva_s (acumulado_fim - acumulado_ini-1)
  const curvaFiltered = filtroItemId
    ? curvaS.filter((c) => c.item_orcamentario_id === filtroItemId)
    : curvaS
  const byItem = new Map<string, CurvaSPonto[]>()
  for (const p of curvaFiltered) {
    const k = p.item_orcamentario_id ?? '_'
    const arr = byItem.get(k) ?? []
    arr.push(p)
    byItem.set(k, arr)
  }
  let planAcumIni = 0
  let realAcumIni = 0
  let planAcumFim = 0
  let realAcumFim = 0
  for (const arr of byItem.values()) {
    arr.sort((a, b) => a.data.localeCompare(b.data))
    const iniIso = janelaIni.toISOString().slice(0, 10)
    const fimIso = janelaFim.toISOString().slice(0, 10)
    const atFim = lastLE(arr, fimIso)
    const beforeIni = lastLT(arr, iniIso)
    if (atFim) {
      planAcumFim += Number(atFim.planejado_acumulado ?? 0)
      realAcumFim += Number(atFim.realizado_acumulado ?? 0)
    }
    if (beforeIni) {
      planAcumIni += Number(beforeIni.planejado_acumulado ?? 0)
      realAcumIni += Number(beforeIni.realizado_acumulado ?? 0)
    }
  }

  return {
    plan_acum_ate_hoje: planAcumHoje,
    real_acum_ate_hoje: realAcumHoje,
    plan_periodo: Math.max(0, planAcumFim - planAcumIni),
    real_periodo: Math.max(0, realAcumFim - realAcumIni),
    aderencia_acum: planAcumHoje > 0 ? realAcumHoje / planAcumHoje : null,
    aderencia_periodo: (planAcumFim - planAcumIni) > 0
      ? (realAcumFim - realAcumIni) / (planAcumFim - planAcumIni)
      : null
  }
}

function lastLE(arr: CurvaSPonto[], iso: string): CurvaSPonto | undefined {
  let r: CurvaSPonto | undefined
  for (const p of arr) { if (p.data <= iso) r = p; else break }
  return r
}
function lastLT(arr: CurvaSPonto[], iso: string): CurvaSPonto | undefined {
  let r: CurvaSPonto | undefined
  for (const p of arr) { if (p.data < iso) r = p; else break }
  return r
}

function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}
function fmtNum(v: number): string {
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

export function PrevistoRealizadoPainel({
  curvaS,
  prevReal,
  filtroItemId,
  periodoDias,
  dataDeCustom,
  dataAteCustom,
  altura = 200
}: Props): ReactNode {
  const janela = useMemo(() => {
    if (dataDeCustom && dataAteCustom) {
      return { ini: new Date(dataDeCustom + 'T00:00:00'), fim: new Date(dataAteCustom + 'T00:00:00') }
    }
    const fim = new Date(); fim.setHours(0, 0, 0, 0)
    const ini = new Date(fim); ini.setDate(ini.getDate() - periodoDias + 1)
    return { ini, fim }
  }, [dataDeCustom, dataAteCustom, periodoDias])

  const r = useMemo(
    () => calcular(curvaS, prevReal, filtroItemId ?? null, janela.ini, janela.fim),
    [curvaS, prevReal, filtroItemId, janela]
  )

  const labelFiltro = filtroItemId
    ? prevReal.find((p) => p.item_orcamentario_id === filtroItemId)
    : null

  return (
    <div className="rounded border border-border bg-bg-panel flex flex-col" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text flex items-center gap-1.5">
          <Scale size={11} /> Previsto × Realizado
        </h4>
        {labelFiltro && (
          <span className="text-2xs font-mono text-accent truncate max-w-[140px]" title={labelFiltro.descricao}>
            {labelFiltro.codigo}
          </span>
        )}
      </div>
      <div className="flex-1 px-3 pb-3 grid grid-cols-2 gap-2 text-xs">
        <Bloco
          titulo="Acumulado até hoje"
          plan={r.plan_acum_ate_hoje}
          real={r.real_acum_ate_hoje}
          aderencia={r.aderencia_acum}
        />
        <Bloco
          titulo="No período"
          plan={r.plan_periodo}
          real={r.real_periodo}
          aderencia={r.aderencia_periodo}
        />
      </div>
    </div>
  )

  function Bloco({ titulo, plan, real, aderencia }: { titulo: string; plan: number; real: number; aderencia: number | null }): ReactNode {
    const ratio = aderencia ?? 0
    const cor = ratio >= 0.95 ? '#10b981' : ratio >= 0.7 ? '#f59e0b' : '#ef4444'
    return (
      <div className="rounded border border-border bg-bg p-2 flex flex-col">
        <div className="text-2xs font-mono uppercase text-text-dim mb-1">{titulo}</div>
        <div className="flex items-baseline justify-between">
          <span className="text-text-dim text-2xs">Plan</span>
          <span className="font-mono tabular-nums text-text">{fmtNum(plan)}</span>
        </div>
        <div className="flex items-baseline justify-between mt-0.5">
          <span className="text-text-dim text-2xs">Real</span>
          <span className="font-mono tabular-nums text-text">{fmtNum(real)}</span>
        </div>
        <div className="mt-auto pt-2">
          <div className="flex items-center justify-between text-2xs font-mono mb-1">
            <span className="text-text-dim">Aderência</span>
            <span style={{ color: cor }} className="font-semibold">{fmtPct(aderencia)}</span>
          </div>
          <div className="h-1 rounded bg-bg-elevated overflow-hidden">
            <div className={cn('h-full transition-all')}
                 style={{ width: `${Math.min(100, ratio * 100)}%`, background: cor }} />
          </div>
        </div>
      </div>
    )
  }
}
