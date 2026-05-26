import { type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart
} from 'recharts'
import type { CurvaSBucket } from '../hooks/cronograma'
import { fmtBRL } from '@/lib/money'
import { fmtDataMonoBR } from '../lib/dates'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'

interface Props {
  planejada: CurvaSBucket[]
  baseline?: CurvaSBucket[]
  height?: number
}

interface MergedRow {
  periodo: string
  perc_planejada: number
  perc_baseline?: number
  custo_acumulado: number
}

export function CurvaSChart({ planejada, baseline, height = 320 }: Props): ReactNode {
  // Merge por período (chave semana)
  const byPeriodo = new Map<string, MergedRow>()
  for (const p of planejada) {
    byPeriodo.set(p.periodo, {
      periodo: p.periodo,
      perc_planejada: Math.round(p.perc_acumulado * 10000) / 100,
      custo_acumulado: p.custo_acumulado
    })
  }
  if (baseline) {
    for (const b of baseline) {
      const cur = byPeriodo.get(b.periodo) ?? {
        periodo: b.periodo,
        perc_planejada: 0,
        custo_acumulado: 0
      }
      cur.perc_baseline = Math.round(b.perc_acumulado * 10000) / 100
      byPeriodo.set(b.periodo, cur)
    }
  }
  const rows = Array.from(byPeriodo.values()).sort((a, b) => a.periodo.localeCompare(b.periodo))

  if (rows.length === 0) {
    return (
      <ChartEmptyState
        height={height}
        message="Sem dados para a curva-S, alocar equipes e calcular cronograma primeiro."
      />
    )
  }

  const ChartType = baseline ? ComposedChart : AreaChart

  return (
    <div className="rounded border border-border bg-bg-panel p-3" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ChartType data={rows} margin={{ top: 10, right: 20, bottom: 10, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="periodo"
            tickFormatter={(v) => fmtDataMonoBR(v)}
            tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              fontSize: 11
            }}
            labelFormatter={(v) => fmtDataMonoBR(v as string)}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : Number(value)
              if (name === 'perc_planejada' || name === 'perc_baseline') {
                const label = name === 'perc_planejada' ? 'Planejado %' : 'Baseline %'
                return [`${num.toFixed(1)}%`, label]
              }
              if (name === 'custo_acumulado') {
                return [fmtBRL(num), 'Acumulado R$']
              }
              return [String(value), String(name)]
            }}
          />
          <Area
            type="monotone"
            dataKey="perc_planejada"
            stroke="var(--accent)"
            fill="var(--accent)"
            fillOpacity={0.18}
            strokeWidth={2}
          />
          {baseline ? (
            <Line
              type="monotone"
              dataKey="perc_baseline"
              stroke="var(--text-dim)"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              dot={false}
            />
          ) : null}
        </ChartType>
      </ResponsiveContainer>
    </div>
  )
}
