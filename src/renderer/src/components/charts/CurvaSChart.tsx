import { type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine
} from 'recharts'
import { CHART_THEME, axisStyle, tooltipStyle } from './theme'

export interface CurvaSDataPoint {
  data: string // ISO date
  previstoAcumulado: number // 0-100
  realizadoAcumulado: number // 0-100; use NaN para "ainda não medido"
}

interface CurvaSChartProps {
  data: CurvaSDataPoint[]
  hojeIndex?: number
}

export function CurvaSChart({ data, hojeIndex }: CurvaSChartProps): ReactNode {
  const indexHoje = hojeIndex ?? data.findIndex((p) => Number.isNaN(p.realizadoAcumulado))
  const labelHoje = indexHoje > 0 ? new Date(data[indexHoje - 1].data).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) : null

  const chartData = data.map((p) => ({
    mes: new Date(p.data).toLocaleDateString('pt-BR', { month: 'short' }),
    previsto: p.previstoAcumulado,
    realizado: Number.isFinite(p.realizadoAcumulado) ? p.realizadoAcumulado : null
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-previsto" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_THEME.series[0]} stopOpacity={0.32} />
            <stop offset="100%" stopColor={CHART_THEME.series[0]} stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="grad-realizado" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_THEME.series[2]} stopOpacity={0.34} />
            <stop offset="100%" stopColor={CHART_THEME.series[2]} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 4" />
        <XAxis dataKey="mes" stroke={CHART_THEME.axisStroke} tick={axisStyle} tickMargin={6} />
        <YAxis stroke={CHART_THEME.axisStroke} tick={axisStyle} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: CHART_THEME.tooltipText, fontWeight: 600 }}
          formatter={(value, name) => {
            const v = typeof value === 'number' ? `${value.toFixed(1)}%` : String(value ?? '')
            return [v, name === 'previsto' ? 'Previsto' : 'Realizado']
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', textTransform: 'uppercase', letterSpacing: '0.05em' }}
          iconType="line"
          formatter={(v: string) => (v === 'previsto' ? 'Previsto' : 'Realizado')}
        />
        <Area
          type="monotone"
          dataKey="previsto"
          stroke={CHART_THEME.series[0]}
          strokeWidth={1.6}
          fill="url(#grad-previsto)"
        />
        <Area
          type="monotone"
          dataKey="realizado"
          stroke={CHART_THEME.series[2]}
          strokeWidth={1.6}
          fill="url(#grad-realizado)"
          connectNulls={false}
        />
        {labelHoje ? (
          <ReferenceLine
            x={labelHoje}
            stroke={CHART_THEME.series[3]}
            strokeDasharray="3 3"
            label={{ value: 'hoje', position: 'top', fill: CHART_THEME.series[3], fontSize: 9, fontFamily: '"IBM Plex Mono", monospace' }}
          />
        ) : null}
      </AreaChart>
    </ResponsiveContainer>
  )
}
