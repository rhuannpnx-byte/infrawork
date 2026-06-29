import { type ReactNode, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts'
import { CHART_THEME, axisStyle, tooltipStyle } from '@/components/charts/theme'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { EntidadeSerie, Dimensao } from '../../lib/performance-calc'
import type { PerfHistoricoServico } from '@/types/acompanhamento'

interface Props {
  series: EntidadeSerie[]
  dias: string[]
  dimensao: Dimensao
  cpuMeta: number | null
  historico: PerfHistoricoServico | null
  mediaObra: number
  unidade: string | null
  selectedKey: string | null
  onSelect: (key: string) => void
}

const fmtDM = (iso: string): string => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
const MAX_LINHAS = 6

export function ComparativoEntidades({
  series, dias, dimensao, cpuMeta, historico, mediaObra, unidade, selectedKey, onSelect
}: Props): ReactNode {
  const topSeries = useMemo(() => series.slice(0, MAX_LINHAS), [series])
  const chartData = useMemo(() => {
    return dias.map((d) => {
      const row: Record<string, number | string | null> = { data: d }
      for (const s of topSeries) row[s.key] = s.porDia.get(d) ?? null
      return row
    })
  }, [dias, topSeries])

  const un = unidade ?? ''
  const labelDim = dimensao === 'equipe' ? 'Equipe' : 'Encarregado'

  if (series.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-text-dim font-mono border border-dashed border-border rounded">
        Sem dados para comparar no período.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 3" />
            <XAxis dataKey="data" tick={axisStyle} stroke={CHART_THEME.axisStroke} tickFormatter={fmtDM} minTickGap={28} />
            <YAxis tick={axisStyle} stroke={CHART_THEME.axisStroke} tickFormatter={(v: number) => formatNumber(v, 0)} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(d) => new Date(String(d) + 'T00:00:00').toLocaleDateString('pt-BR')}
              formatter={(v, key) => {
                const s = topSeries.find((x) => x.key === String(key))
                return [`${formatNumber(Number(v), 1)} ${un}`, s?.nome ?? String(key)]
              }}
            />
            <ReferenceLine y={mediaObra} stroke={CHART_THEME.axisLabel} strokeDasharray="4 4"
              label={{ value: `média obra ${formatNumber(mediaObra, 0)}`, fontSize: 9, fill: CHART_THEME.axisLabel, position: 'insideTopLeft' }} />
            {cpuMeta != null ? (
              <ReferenceLine y={cpuMeta} stroke={CHART_THEME.series[2]} strokeWidth={1.2}
                label={{ value: `CPU ${formatNumber(cpuMeta, 0)}`, fontSize: 9, fill: CHART_THEME.series[2], position: 'insideBottomLeft' }} />
            ) : null}
            {topSeries.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.cor}
                strokeWidth={selectedKey === s.key ? 2.6 : 1.4}
                strokeOpacity={selectedKey && selectedKey !== s.key ? 0.35 : 1}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-bg text-text-dim font-mono uppercase text-2xs">
            <tr className="border-b border-border">
              <th className="text-left px-2 py-1.5">{labelDim}</th>
              <th className="text-right px-2 py-1.5">Dias</th>
              <th className="text-right px-2 py-1.5">Total</th>
              <th className="text-right px-2 py-1.5">Média/dia</th>
              <th className="text-right px-2 py-1.5">Mediana</th>
              <th className="text-right px-2 py-1.5">Melhor dia</th>
              <th className="text-right px-2 py-1.5">vs CPU</th>
              <th className="text-right px-2 py-1.5">vs hist.</th>
              <th className="text-center px-2 py-1.5">Tend.</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => {
              const adCpu = cpuMeta && cpuMeta > 0 ? s.media / cpuMeta : null
              const adHist = historico?.p50 ? s.media / historico.p50 - 1 : null
              const tendCor = s.tendencia.rotulo === 'subindo' ? 'text-success'
                : s.tendencia.rotulo === 'caindo' ? 'text-danger' : 'text-text-dim'
              const tendSym = s.tendencia.rotulo === 'subindo' ? '▲'
                : s.tendencia.rotulo === 'caindo' ? '▼' : '▬'
              return (
                <tr
                  key={s.key}
                  onClick={() => onSelect(s.key)}
                  className={cn(
                    'border-b border-border/40 cursor-pointer hover:bg-bg-hover transition-colors',
                    selectedKey === s.key && 'bg-accent-glow'
                  )}
                >
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: s.cor }} />
                      <span className="text-text truncate max-w-[180px]">{s.nome}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-muted">{s.dias}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-muted">{formatNumber(s.total, 0)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text">{formatNumber(s.media, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-muted">{formatNumber(s.mediana, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-muted">{formatNumber(s.melhorDia, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {adCpu == null ? <span className="text-text-dim">—</span> : (
                      <span className={adCpu >= 1 ? 'text-success' : adCpu >= 0.8 ? 'text-warn' : 'text-danger'}>
                        {formatNumber(adCpu * 100, 0)}%
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {adHist == null ? <span className="text-text-dim">—</span> : (
                      <span className={adHist >= 0 ? 'text-success' : 'text-danger'}>
                        {adHist >= 0 ? '+' : ''}{formatNumber(adHist * 100, 0)}%
                      </span>
                    )}
                  </td>
                  <td className={cn('px-2 py-1.5 text-center font-mono', tendCor)} title={`R²=${s.tendencia.r2.toFixed(2)}`}>{tendSym}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
