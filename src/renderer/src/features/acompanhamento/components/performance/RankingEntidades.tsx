import { type ReactNode, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, ReferenceLine, ResponsiveContainer
} from 'recharts'
import { CHART_THEME, axisStyle, tooltipStyle } from '@/components/charts/theme'
import { formatNumber } from '@/lib/format'
import { COR, type EntidadeSerie } from '../../lib/performance-calc'

interface Props {
  series: EntidadeSerie[]
  cpuMeta: number | null
  unidade: string | null
  selectedKey: string | null
  onSelect: (key: string) => void
}

/** Ranking horizontal (barras com rótulo) por equipe/encarregado — média/dia. */
export function RankingEntidades({ series, cpuMeta, unidade, selectedKey, onSelect }: Props): ReactNode {
  const data = useMemo(
    () => series.map((s) => ({ entKey: s.key, nome: s.nome, media: Number(s.media.toFixed(1)) })),
    [series]
  )
  if (data.length === 0) {
    return <div className="h-32 flex items-center justify-center text-2xs font-mono text-text-dim">Sem dados.</div>
  }
  const un = unidade ?? ''
  const altura = Math.max(120, data.length * 30 + 28)

  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
          <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 3" horizontal={false} />
          <XAxis type="number" tick={axisStyle} stroke={CHART_THEME.axisStroke} tickFormatter={(v: number) => formatNumber(v, 0)} />
          <YAxis
            type="category"
            dataKey="nome"
            tick={axisStyle}
            stroke={CHART_THEME.axisStroke}
            width={150}
            interval={0}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: 'oklch(50% 0.01 255 / 0.12)' }}
            formatter={(v) => [`${formatNumber(Number(v), 1)} ${un}/dia`, 'Média']}
          />
          {cpuMeta != null ? (
            <ReferenceLine x={cpuMeta} stroke={COR.meta} strokeWidth={1.2} strokeDasharray="4 3"
              label={{ value: `CPU ${formatNumber(cpuMeta, 0)}`, fontSize: 9, fill: COR.meta, position: 'top' }} />
          ) : null}
          <Bar dataKey="media" radius={[0, 3, 3, 0]} maxBarSize={22} isAnimationActive={false}
            onClick={(e) => {
              const k = (e as unknown as { payload?: { entKey?: string } }).payload?.entKey
              if (k) onSelect(k)
            }}
            className="cursor-pointer">
            {data.map((d) => (
              <Cell key={d.entKey} fill={COR.realizado} fillOpacity={!selectedKey || selectedKey === d.entKey ? 1 : 0.35} />
            ))}
            <LabelList
              dataKey="media"
              position="right"
              formatter={(v) => formatNumber(Number(v), 1)}
              style={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace', fill: CHART_THEME.axisLabel }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
