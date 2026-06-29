import { type ReactNode, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Legend
} from 'recharts'
import { CHART_THEME, axisStyle, tooltipStyle } from '@/components/charts/theme'
import { formatNumber } from '@/lib/format'
import { regressaoLinear } from '../../lib/estatistica'
import { COR, type EntidadeSerie } from '../../lib/performance-calc'
import type { PerfHistorico } from '@/types/acompanhamento'

interface Props {
  serie: EntidadeSerie | null
  dias: string[]
  cpuMeta: number | null
  historico: PerfHistorico | null
  unidade: string | null
  altura?: number
}

const fmtDM = (iso: string): string => {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function ProdutividadeDiariaChart({
  serie, dias, cpuMeta, historico, unidade, altura = 300
}: Props): ReactNode {
  const { data, trendOk } = useMemo(() => {
    if (!serie) return { data: [] as Array<Record<string, number | string | null>>, trendOk: false }
    // tendência sobre os dias trabalhados (índice sequencial)
    const datasTrab = [...serie.porDia.keys()].sort()
    const reg = regressaoLinear(datasTrab.map((d, i) => ({ x: i, y: serie.porDia.get(d)! })))
    const idxTrab = new Map(datasTrab.map((d, i) => [d, i]))
    const rows = dias.map((d) => {
      const qtd = serie.porDia.get(d) ?? null
      const i = idxTrab.get(d)
      const trend = i != null ? Math.max(0, reg.intercept + reg.slope * i) : null
      return { data: d, qtd, trend }
    })
    return { data: rows, trendOk: datasTrab.length >= 2 }
  }, [serie, dias])

  if (!serie || data.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-xs text-text-dim font-mono border border-dashed border-border rounded">
        Sem produção no período para esta seleção.
      </div>
    )
  }

  const un = unidade ?? ''
  return (
    <div style={{ height: altura }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 3" />
          {/* faixa histórica p25–p75 (benchmark de outras obras, sem outliers) */}
          {historico?.p25 != null && historico?.p75 != null ? (
            <ReferenceArea
              y1={historico.p25}
              y2={historico.p75}
              fill={COR.historico}
              fillOpacity={0.1}
              ifOverflow="extendDomain"
            />
          ) : null}
          <XAxis
            dataKey="data"
            tick={axisStyle}
            stroke={CHART_THEME.axisStroke}
            tickFormatter={fmtDM}
            minTickGap={28}
          />
          <YAxis tick={axisStyle} stroke={CHART_THEME.axisStroke} tickFormatter={(v: number) => formatNumber(v, 0)} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(d) => new Date(String(d) + 'T00:00:00').toLocaleDateString('pt-BR')}
            formatter={(v, n) => [`${formatNumber(Number(v), 1)} ${un}`, n]}
          />
          <Legend verticalAlign="top" height={22} iconSize={8} wrapperStyle={{ fontSize: 10, fontFamily: '"IBM Plex Mono", monospace' }} />
          <Bar name="Produção/dia" dataKey="qtd" fill={COR.realizado} radius={[2, 2, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          {trendOk ? (
            <Line name="Tendência" dataKey="trend" stroke={COR.tendencia} strokeWidth={1.6} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />
          ) : null}
          {/* média da equipe */}
          <ReferenceLine y={serie.media} stroke={COR.realizado} strokeDasharray="4 4" strokeOpacity={0.7}
            label={{ value: `média ${formatNumber(serie.media, 0)}`, fontSize: 9, fill: COR.realizado, position: 'insideTopLeft' }} />
          {/* meta CPU */}
          {cpuMeta != null ? (
            <ReferenceLine y={cpuMeta} stroke={COR.meta} strokeWidth={1.4}
              label={{ value: `meta CPU ${formatNumber(cpuMeta, 0)}`, fontSize: 9, fill: COR.meta, position: 'insideBottomLeft' }} />
          ) : null}
          {/* mediana histórica */}
          {historico?.p50 != null ? (
            <ReferenceLine y={historico.p50} stroke={COR.historico} strokeDasharray="2 4"
              label={{ value: `hist. p50 ${formatNumber(historico.p50, 0)}`, fontSize: 9, fill: COR.historico, position: 'insideTopRight' }} />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
