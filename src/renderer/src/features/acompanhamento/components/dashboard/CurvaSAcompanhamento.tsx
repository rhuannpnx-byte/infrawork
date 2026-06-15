import { type ReactNode, useMemo } from 'react'
import {
  Area, ComposedChart, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts'
import { CHART_THEME, axisStyle } from '@/components/charts/theme'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'
import type { CurvaSPonto } from '@/types/acompanhamento'
import { formatNumber } from '@/lib/format'

interface TooltipItem { value?: number | string | null; dataKey?: string | number; name?: string; color?: string }
function CustomTooltip(props: { active?: boolean; payload?: TooltipItem[]; label?: string | number }): ReactNode {
  const { active, payload, label } = props
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-border-strong bg-bg-elevated px-2 py-1.5 shadow-lg text-xs font-mono">
      <div className="text-text-dim mb-1">
        {label ? new Date(String(label) + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
      </div>
      {payload.map((p) => {
        if (p.value == null) return null
        return (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-text-dim">{p.name}</span>
            <span className="text-text tabular-nums ml-auto">
              {formatNumber(Number(p.value), 0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  pontos: CurvaSPonto[]
  altura?: number
}

interface AggPonto {
  data: string
  planejado_acumulado: number
  realizado_acumulado: number
}

export function CurvaSAcompanhamento({ pontos, altura = 280 }: Props): ReactNode {
  const data = useMemo<AggPonto[]>(() => {
    if (!pontos || pontos.length === 0) return []
    // A view emite uma linha por item só nos dias com atividade — então em dias
    // sem atividade de um item (ex.: sábado) ele "some" da soma e o acumulado
    // agregado afunda. Acumulado é função-degrau: forward-fill o último valor
    // conhecido de cada item antes de somar, garantindo monotonia.
    const datas = Array.from(new Set(pontos.map((p) => p.data))).sort((a, b) => a.localeCompare(b))
    const porItem = new Map<string, Map<string, { plan: number; real: number }>>()
    for (const p of pontos) {
      const k = p.item_orcamentario_id ?? '∅'
      let m = porItem.get(k)
      if (!m) { m = new Map(); porItem.set(k, m) }
      m.set(p.data, { plan: Number(p.planejado_acumulado ?? 0), real: Number(p.realizado_acumulado ?? 0) })
    }
    const ultimo = new Map<string, { plan: number; real: number }>()
    return datas.map((d) => {
      let plan = 0
      let real = 0
      for (const [k, serie] of porItem) {
        const v = serie.get(d)
        if (v) ultimo.set(k, v)
        const lv = ultimo.get(k) // 0 antes do 1º registro do item (ainda não iniciado)
        if (lv) { plan += lv.plan; real += lv.real }
      }
      return { data: d, planejado_acumulado: plan, realizado_acumulado: real }
    })
  }, [pontos])

  const hojeIso = new Date().toISOString().slice(0, 10)

  if (data.length === 0) {
    return (
      <ChartEmptyState
        height={altura}
        message="Sem dados de curva-S no período"
        hint={
          <>
            Verifique: 1) baseline ativo no Planejamento · 2) tarefas com data início/fim · 3) item_orcamentário com quantidade de referência · 4) serviços SIGA vinculados em <span className="text-accent">Equipes</span>
          </>
        }
      />
    )
  }

  return (
    <div className="rounded border border-border bg-bg-panel p-3" style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 3" />
          <XAxis
            dataKey="data"
            tick={axisStyle}
            stroke={CHART_THEME.axisStroke}
            tickFormatter={(d) => {
              const dt = new Date(d + 'T00:00:00')
              return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
            }}
            minTickGap={32}
          />
          <YAxis
            tick={axisStyle}
            stroke={CHART_THEME.axisStroke}
            tickFormatter={(v: number) => formatNumber(v, 0)}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: 'oklch(82% 0.16 80)', strokeWidth: 1, strokeDasharray: '3 3', fillOpacity: 0 }}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconSize={8}
            wrapperStyle={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace' }}
          />
          <ReferenceLine x={hojeIso} stroke="oklch(82% 0.16 80)" strokeDasharray="3 3" label={{ value: 'Hoje', fontSize: 9, fill: 'oklch(82% 0.16 80)' }} />
          <defs>
            <linearGradient id="plan" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_THEME.series[0]} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_THEME.series[0]} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="real" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_THEME.series[2]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_THEME.series[2]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            name="Planejado acumulado"
            type="monotone"
            dataKey="planejado_acumulado"
            stroke={CHART_THEME.series[0]}
            strokeWidth={1.4}
            fill="url(#plan)"
            isAnimationActive={false}
          />
          <Area
            name="Realizado acumulado"
            type="monotone"
            dataKey="realizado_acumulado"
            stroke={CHART_THEME.series[2]}
            strokeWidth={1.8}
            fill="url(#real)"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
