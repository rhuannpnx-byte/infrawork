import { type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_THEME, axisStyle, tooltipStyle } from './theme'

export interface HistogramaData {
  mes: string
  [serie: string]: number | string
}

interface HistogramaProps {
  data: HistogramaData[]
  series: Array<{ key: string; label: string; color?: string }>
}

export function HistogramaRecursos({ data, series }: HistogramaProps): ReactNode {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 4" />
        <XAxis dataKey="mes" stroke={CHART_THEME.axisStroke} tick={axisStyle} />
        <YAxis stroke={CHART_THEME.axisStroke} tick={axisStyle} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: CHART_THEME.tooltipText, fontWeight: 600 }} />
        <Legend wrapperStyle={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', textTransform: 'uppercase' }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color ?? CHART_THEME.series[i % CHART_THEME.series.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
