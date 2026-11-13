import { type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { ComparativoServico } from '../../lib/valor-agregado-calc'
import { fmtBRL } from '@/lib/money'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'
import { reaisCurto } from '@/components/charts/CurvaS'
import { axisStyle, tooltipStyle } from '@/components/charts/theme'

interface Props {
  dados: ComparativoServico[]
  /** Máximo de serviços exibidos (por valor planejado). */
  limite?: number
}

const fmtCompactBRL = (v: number): string => (v ? reaisCurto(v) : '')
const eixo = { ...axisStyle, fontSize: 11 }

function truncar(s: string, n = 26): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Previsto e executado (R$) por serviço no período filtrado, em barras horizontais. */
export function PlanejadoProjetadoPorServico({ dados, limite = 25 }: Props): ReactNode {
  if (dados.length === 0) {
    return (
      <ChartEmptyState
        height={260}
        message="Nenhum serviço tem previsto ou produção neste período."
        hint="Escolha outro período ou lance a produção."
      />
    )
  }

  const top = dados.slice(0, limite)
  const height = Math.max(240, top.length * 46 + 48)

  const labels: Record<string, string> = { planejado: 'Previsto', projetado: 'Executado' }

  return (
    <div className="rounded border border-border bg-bg-panel p-3" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={top}
          margin={{ top: 8, right: 76, bottom: 8, left: 8 }}
          barGap={2}
          barCategoryGap="22%"
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, (max: number) => Math.ceil(max * 1.18)]}
            tickFormatter={reaisCurto}
            tick={eixo}
          />
          <YAxis
            type="category"
            dataKey="item_orcamentario_id"
            width={196}
            interval={0}
            tickFormatter={(v) => {
              const s = top.find((t) => t.item_orcamentario_id === v)
              return truncar(s?.descricao ?? String(v))
            }}
            tick={eixo}
          />
          <Tooltip
            cursor={{ fill: 'var(--bg-hover)', opacity: 0.35 }}
            contentStyle={{ ...tooltipStyle, fontSize: '12px' }}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text)', marginBottom: 2 }}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : Number(value)
              return [fmtBRL(num), labels[String(name)] ?? String(name)]
            }}
            labelFormatter={(_label, payload) => {
              const s = payload?.[0]?.payload as ComparativoServico | undefined
              return s ? `${s.codigo} ${s.descricao}` : ''
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
            formatter={(v) => (
              <span style={{ color: 'var(--text-muted)' }}>{labels[String(v)] ?? String(v)}</span>
            )}
          />
          <Bar
            dataKey="planejado"
            fill="var(--text-dim)"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="planejado"
              position="right"
              formatter={(v) => fmtCompactBRL(Number(v ?? 0))}
              style={{ fontSize: 11, fill: 'var(--text-muted)' }}
            />
          </Bar>
          <Bar
            dataKey="projetado"
            fill="var(--success)"
            radius={[0, 2, 2, 0]}
            isAnimationActive={false}
          >
            {top.map((s) => (
              <Cell
                key={s.item_orcamentario_id}
                fill={s.projetado >= s.planejado ? 'var(--success)' : 'var(--danger)'}
              />
            ))}
            <LabelList
              dataKey="projetado"
              position="right"
              formatter={(v) => fmtCompactBRL(Number(v ?? 0))}
              style={{ fontSize: 11, fill: 'var(--text)' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
