import { type ReactNode, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer
} from 'recharts'
import { CHART_THEME, axisStyle, tooltipStyle } from '@/components/charts/theme'
import { Vazio } from '@/components/ui/estado'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { COR, type EntidadeSerie, type Dimensao } from '../../lib/performance-calc'
import type { PerfHistorico } from '@/types/acompanhamento'

interface Props {
  series: EntidadeSerie[]
  dias: string[]
  dimensao: Dimensao
  cpuMeta: number | null
  historico: PerfHistorico | null
  mediaObra: number
  unidade: string | null
  selectedKey: string | null
  onSelect: (key: string) => void
}

const fmtDM = (iso: string): string => {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}
const MAX_LINHAS = 6
const eixo = { ...axisStyle, fontSize: 11 }
// Uma cor por linha, fora o azul da meta (--chart-1).
const CORES_LINHA = [
  'var(--chart-3)',
  'var(--chart-5)',
  'var(--chart-4)',
  'var(--chart-6)',
  'var(--chart-2)',
  'var(--chart-laranja)'
]
const TH = 'px-3 py-2 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim'
const TENDENCIA: Record<string, { simbolo: string; rotulo: string; cor: string }> = {
  subindo: { simbolo: '▲', rotulo: 'Subindo', cor: 'text-success' },
  caindo: { simbolo: '▼', rotulo: 'Caindo', cor: 'text-danger' }
}

export function ComparativoEntidades({
  series,
  dias,
  dimensao,
  cpuMeta,
  historico,
  mediaObra,
  unidade,
  selectedKey,
  onSelect
}: Props): ReactNode {
  const topSeries = useMemo(() => series.slice(0, MAX_LINHAS), [series])
  const corPorKey = useMemo(() => {
    const m = new Map<string, string>()
    topSeries.forEach((s, i) => m.set(s.key, CORES_LINHA[i]))
    return m
  }, [topSeries])
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
    return <Vazio>Sem produção no período para comparar.</Vazio>
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        {series.length > MAX_LINHAS
          ? `O gráfico mostra as ${MAX_LINHAS} maiores médias por dia; a tabela traz todas.`
          : 'Uma linha para cada nome da tabela.'}{' '}
        Clique numa linha da tabela para focar.
      </p>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 3" />
            <XAxis
              dataKey="data"
              tick={eixo}
              stroke={CHART_THEME.axisStroke}
              tickFormatter={fmtDM}
              minTickGap={28}
            />
            <YAxis
              tick={eixo}
              stroke={CHART_THEME.axisStroke}
              tickFormatter={(v: number) => formatNumber(v, 0)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(d) => new Date(String(d) + 'T00:00:00').toLocaleDateString('pt-BR')}
              formatter={(v, key) => {
                const s = topSeries.find((x) => x.key === String(key))
                return [`${formatNumber(Number(v), 1)} ${un}`, s?.nome ?? String(key)]
              }}
            />
            <ReferenceLine
              y={mediaObra}
              stroke={COR.mediaObra}
              strokeDasharray="4 4"
              label={{
                value: `média da obra ${formatNumber(mediaObra, 0)}`,
                fontSize: 11,
                fill: COR.mediaObra,
                position: 'insideTopLeft'
              }}
            />
            {cpuMeta != null ? (
              <ReferenceLine
                y={cpuMeta}
                stroke={COR.meta}
                strokeWidth={1.2}
                label={{
                  value: `meta da composição ${formatNumber(cpuMeta, 0)}`,
                  fontSize: 11,
                  fill: COR.meta,
                  position: 'insideBottomLeft'
                }}
              />
            ) : null}
            {topSeries.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={corPorKey.get(s.key) ?? COR.realizado}
                strokeWidth={selectedKey === s.key ? 2.8 : 1.6}
                strokeOpacity={selectedKey && selectedKey !== s.key ? 0.3 : 1}
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated">
            <tr className="border-b border-border">
              <th className={cn(TH, 'text-left')}>{labelDim}</th>
              <th className={cn(TH, 'text-right')}>Dias</th>
              <th className={cn(TH, 'text-right')}>Total{un ? ` (${un})` : ''}</th>
              <th className={cn(TH, 'text-right')}>Média por dia</th>
              <th className={cn(TH, 'text-right')}>Mediana</th>
              <th className={cn(TH, 'text-right')}>Melhor dia</th>
              <th
                className={cn(TH, 'text-right')}
                title="Média por dia dividida pela meta da composição"
              >
                % da meta
              </th>
              <th
                className={cn(TH, 'text-right')}
                title="Média por dia comparada com a mediana histórica do serviço"
              >
                Sobre o histórico
              </th>
              <th className={cn(TH, 'text-center')}>Tendência</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s) => {
              const adCpu = cpuMeta && cpuMeta > 0 ? s.media / cpuMeta : null
              const adHist = historico?.p50 ? s.media / historico.p50 - 1 : null
              const tend = TENDENCIA[s.tendencia.rotulo] ?? {
                simbolo: '▬',
                rotulo: 'Estável',
                cor: 'text-text-muted'
              }
              const focada = selectedKey === s.key
              return (
                <tr
                  key={s.key}
                  onClick={() => onSelect(s.key)}
                  className={cn(
                    'border-b border-border last:border-b-0 cursor-pointer hover:bg-bg-hover transition-colors',
                    focada && 'bg-accent-glow'
                  )}
                >
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      aria-pressed={focada}
                      title={focada ? 'Tirar o foco' : `Focar em ${s.nome}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(s.key)
                      }}
                      className="inline-flex items-center gap-2 min-h-7 max-w-full rounded text-left text-text hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span
                        aria-hidden
                        className="size-2.5 rounded-sm shrink-0"
                        style={{
                          background: corPorKey.get(s.key) ?? COR.mediaObra,
                          opacity: selectedKey && !focada ? 0.4 : 1
                        }}
                      />
                      <span className={cn('truncate max-w-[220px]', focada && 'font-semibold')}>
                        {s.nome}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-text-muted">{s.dias}</td>
                  <td className="px-3 py-1.5 text-right tabular text-text-muted">
                    {formatNumber(s.total, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-text">
                    {formatNumber(s.media, 1)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-text-muted">
                    {formatNumber(s.mediana, 1)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-text-muted">
                    {formatNumber(s.melhorDia, 1)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">
                    {adCpu == null ? (
                      <span className="text-text-dim">—</span>
                    ) : (
                      <span
                        className={
                          adCpu >= 1 ? 'text-success' : adCpu >= 0.8 ? 'text-warn' : 'text-danger'
                        }
                      >
                        {formatNumber(adCpu * 100, 0)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular">
                    {adHist == null ? (
                      <span className="text-text-dim">—</span>
                    ) : (
                      <span className={adHist >= 0 ? 'text-success' : 'text-danger'}>
                        {adHist >= 0 ? '+' : '−'}
                        {formatNumber(Math.abs(adHist) * 100, 0)}%
                      </span>
                    )}
                  </td>
                  <td
                    className={cn('px-3 py-1.5 text-center whitespace-nowrap', tend.cor)}
                    title={`R² ${formatNumber(s.tendencia.r2, 2)}`}
                  >
                    <span aria-hidden>{tend.simbolo}</span> {tend.rotulo}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
