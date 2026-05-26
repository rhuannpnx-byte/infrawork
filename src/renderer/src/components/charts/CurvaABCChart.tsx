import { type ReactNode } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { CHART_THEME, axisStyle, tooltipStyle } from './theme'
import { formatCurrency } from '@/lib/format'

export interface CurvaABCItem {
  composicaoCodigo: string
  total: number
  percentualAcumulado: number // 0-100
  classe: 'A' | 'B' | 'C'
}

const COLOR_BY_CLASSE: Record<CurvaABCItem['classe'], string> = {
  A: 'oklch(70% 0.18 25)',
  B: 'oklch(82% 0.16 80)',
  C: 'oklch(67% 0.18 255)'
}

export function CurvaABCChart({ data }: { data: CurvaABCItem[] }): ReactNode {
  const chartData = data.map((it) => ({
    codigo: it.composicaoCodigo,
    total: it.total,
    acumulado: it.percentualAcumulado,
    classe: it.classe
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 10, right: 18, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 4" />
        <XAxis dataKey="codigo" stroke={CHART_THEME.axisStroke} tick={axisStyle} tickMargin={6} />
        <YAxis
          yAxisId="left"
          stroke={CHART_THEME.axisStroke}
          tick={axisStyle}
          tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke={CHART_THEME.axisStroke}
          tick={axisStyle}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: CHART_THEME.tooltipText, fontWeight: 600 }}
          formatter={(value, name) => {
            const v = typeof value === 'number' ? value : 0
            return name === 'total'
              ? [formatCurrency(v), 'Total']
              : [`${v.toFixed(1)}%`, '% acumulado']
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          formatter={(v: string) => (v === 'total' ? 'Valor total' : '% acumulado')}
        />
        <Bar yAxisId="left" dataKey="total" radius={[2, 2, 0, 0]}>
          {chartData.map((d, i) => (
            <rect key={i} fill={COLOR_BY_CLASSE[d.classe]} />
          ))}
        </Bar>
        <Line
          yAxisId="right"
          dataKey="acumulado"
          stroke="oklch(85% 0.12 215)"
          strokeWidth={1.6}
          dot={{ fill: 'oklch(85% 0.12 215)', r: 2 }}
          type="monotone"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
