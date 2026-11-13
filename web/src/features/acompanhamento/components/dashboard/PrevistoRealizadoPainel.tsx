import { type ReactNode, useMemo } from 'react'
import type { CurvaSPonto, PrevistoRealizadoItem } from '@/types/acompanhamento'
import { reaisCurto, type PontoCurvaS } from '@/components/charts/CurvaS'
import { BarraAvanco } from '@/components/ui/indicador'
import { formatNumber } from '@/lib/format'

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
  /** Curva em valor (R$) da obra: usada quando não há serviço escolhido, para não somar unidades diferentes. */
  valor?: PontoCurvaS[]
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
  // "Acumulado ate hoje": vem de vw_acompanhamento_previsto_x_realizado (qtd_plan_periodo = previsto ate hoje
  //   pelo perfil diario da linha de base de referencia; qtd_plan e o total do servico).
  //   Esta view soma toda producao sem janela de tarefa, batendo com a subpage
  //   "Previsto x Realizado". Antes usavamos curva_s para esse calculo, mas a
  //   curva_s gera dias apenas dentro de [data_inicio, max(data_fim,hoje)] —
  //   produção lançada antes de data_inicio caia fora do LEFT JOIN.
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
    planAcumHoje += Number(p.qtd_plan_periodo ?? 0)
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
    aderencia_periodo:
      planAcumFim - planAcumIni > 0
        ? (realAcumFim - realAcumIni) / (planAcumFim - planAcumIni)
        : null
  }
}

function lastLE(arr: CurvaSPonto[], iso: string): CurvaSPonto | undefined {
  let r: CurvaSPonto | undefined
  for (const p of arr) {
    if (p.data <= iso) r = p
    else break
  }
  return r
}
function lastLT(arr: CurvaSPonto[], iso: string): CurvaSPonto | undefined {
  let r: CurvaSPonto | undefined
  for (const p of arr) {
    if (p.data < iso) r = p
    else break
  }
  return r
}

/** Mesmo resumo, em valor: acumulados semanais da curva S em R$. */
function calcularEmValor(pontos: PontoCurvaS[], janelaIni: Date, janelaFim: Date): Resumo {
  const iso = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const ate = (limite: string, inclusive: boolean): { plan: number; real: number } => {
    let plan = 0
    let real = 0
    for (const p of pontos) {
      if (inclusive ? p.data > limite : p.data >= limite) break
      if (p.realizado == null) break
      plan = p.previsto ?? plan
      real = p.realizado
    }
    return { plan, real }
  }
  const hoje = ate(iso(new Date()), true)
  const fim = ate(iso(janelaFim), true)
  const ini = ate(iso(janelaIni), false)
  const planPeriodo = Math.max(0, fim.plan - ini.plan)
  const realPeriodo = Math.max(0, fim.real - ini.real)
  return {
    plan_acum_ate_hoje: hoje.plan,
    real_acum_ate_hoje: hoje.real,
    plan_periodo: planPeriodo,
    real_periodo: realPeriodo,
    aderencia_acum: hoje.plan > 0 ? hoje.real / hoje.plan : null,
    aderencia_periodo: planPeriodo > 0 ? realPeriodo / planPeriodo : null
  }
}

function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

export function PrevistoRealizadoPainel({
  curvaS,
  prevReal,
  filtroItemId,
  periodoDias,
  dataDeCustom,
  dataAteCustom,
  valor,
  altura = 200
}: Props): ReactNode {
  const janela = useMemo(() => {
    if (dataDeCustom && dataAteCustom) {
      return {
        ini: new Date(dataDeCustom + 'T00:00:00'),
        fim: new Date(dataAteCustom + 'T00:00:00')
      }
    }
    const fim = new Date()
    fim.setHours(0, 0, 0, 0)
    const ini = new Date(fim)
    ini.setDate(ini.getDate() - periodoDias + 1)
    return { ini, fim }
  }, [dataDeCustom, dataAteCustom, periodoDias])

  const emValor = !filtroItemId
  const r = useMemo(
    () =>
      emValor
        ? calcularEmValor(valor ?? [], janela.ini, janela.fim)
        : calcular(curvaS, prevReal, filtroItemId ?? null, janela.ini, janela.fim),
    [emValor, valor, curvaS, prevReal, filtroItemId, janela]
  )

  const labelFiltro = filtroItemId
    ? prevReal.find((p) => p.item_orcamentario_id === filtroItemId)
    : null

  const unidade = labelFiltro?.unidade ? ` ${labelFiltro.unidade}` : ''
  const fmt = (v: number): string => (emValor ? reaisCurto(v) : `${formatNumber(v, 0)}${unidade}`)

  return (
    <div
      className="rounded border border-border bg-bg-panel flex flex-col"
      style={{ minHeight: altura }}
    >
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-md font-semibold text-text">Previsto e realizado</h3>
        <span className="text-xs text-text-muted truncate" title={labelFiltro?.descricao}>
          {labelFiltro ? labelFiltro.codigo : 'em valor, todos os serviços'}
        </span>
      </div>
      <div className="flex-1 grid grid-cols-2 border-t border-border">
        <Bloco
          titulo="Até hoje"
          plan={fmt(r.plan_acum_ate_hoje)}
          real={fmt(r.real_acum_ate_hoje)}
          aderencia={r.aderencia_acum}
        />
        <Bloco
          titulo="No período"
          plan={fmt(r.plan_periodo)}
          real={fmt(r.real_periodo)}
          aderencia={r.aderencia_periodo}
          divisa
        />
      </div>
    </div>
  )
}

function Bloco({
  titulo,
  plan,
  real,
  aderencia,
  divisa
}: {
  titulo: string
  plan: string
  real: string
  aderencia: number | null
  divisa?: boolean
}): ReactNode {
  const ratio = aderencia ?? 0
  const tom = ratio >= 0.95 ? 'success' : ratio >= 0.7 ? 'warn' : 'danger'
  const corTexto =
    aderencia == null
      ? 'text-text-muted'
      : tom === 'success'
        ? 'text-success'
        : tom === 'warn'
          ? 'text-warn'
          : 'text-danger'
  return (
    <div
      className={`px-4 py-3 flex flex-col gap-1 text-sm ${divisa ? 'border-l border-border' : ''}`}
    >
      <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
        {titulo}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-text-muted">Previsto</span>
        <span className="tabular text-text">{plan}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-text-muted">Realizado</span>
        <span className="tabular font-semibold text-text">{real}</span>
      </div>
      <div className="mt-auto pt-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-text-muted">Aderência</span>
          <span className={`tabular font-semibold ${corTexto}`}>{fmtPct(aderencia)}</span>
        </div>
        <BarraAvanco valor={ratio} tom={tom} className="h-1.5" />
      </div>
    </div>
  )
}
