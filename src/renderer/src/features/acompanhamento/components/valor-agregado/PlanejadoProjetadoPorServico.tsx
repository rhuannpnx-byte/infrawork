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

interface Props {
  dados: ComparativoServico[]
  /** Máximo de serviços exibidos (por valor planejado). */
  limite?: number
}

function fmtCompactBRL(v: number): string {
  if (!v) return ''
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`
  return `R$ ${v.toFixed(0)}`
}

function truncar(s: string, n = 26): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Planejado × Projetado (R$) por serviço no período filtrado (barras horizontais). */
export function PlanejadoProjetadoPorServico({ dados, limite = 25 }: Props): ReactNode {
  if (dados.length === 0) {
    return (
      <ChartEmptyState height={260} message="Sem serviços com planejado ou produção no período." />
    )
  }

  const top = dados.slice(0, limite)
  const height = Math.max(240, top.length * 46 + 48)

  const fmtTickBRL = (v: number): string => {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`
    return fmtBRL(v)
  }

  const labels: Record<string, string> = { planejado: 'Planejado', projetado: 'Projetado' }

  return (
    <div className="rounded border border-border bg-bg-panel p-3" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={top}
          margin={{ top: 8, right: 64, bottom: 8, left: 8 }}
          barGap={2}
          barCategoryGap="22%"
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, (max: number) => Math.ceil(max * 1.18)]}
            tickFormatter={fmtTickBRL}
            tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
          />
          <YAxis
            type="category"
            dataKey="item_orcamentario_id"
            width={184}
            interval={0}
            tickFormatter={(v) => {
              const s = top.find((t) => t.item_orcamentario_id === v)
              return truncar(s?.descricao ?? String(v))
            }}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
          />
          <Tooltip
            cursor={{ fill: 'var(--bg-hover)', opacity: 0.35 }}
            contentStyle={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 11
            }}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text)', marginBottom: 2 }}
            formatter={(value, name) => {
              const num = typeof value === 'number' ? value : Number(value)
              return [fmtBRL(num), labels[String(name)] ?? String(name)]
            }}
            labelFormatter={(_label, payload) => {
              const s = payload?.[0]?.payload as ComparativoServico | undefined
              return s ? `${s.codigo} — ${s.descricao}` : ''
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(v) => labels[String(v)] ?? String(v)}
          />
          <Bar dataKey="planejado" fill="var(--text-dim)" radius={[0, 2, 2, 0]}>
            <LabelList
              dataKey="planejado"
              position="right"
              formatter={(v) => fmtCompactBRL(Number(v ?? 0))}
              style={{ fontSize: 9, fill: 'var(--text-dim)' }}
            />
          </Bar>
          <Bar dataKey="projetado" radius={[0, 2, 2, 0]}>
            {top.map((s) => (
              <Cell
                key={s.item_orcamentario_id}
                fill={
                  s.projetado >= s.planejado ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'
                }
              />
            ))}
            <LabelList
              dataKey="projetado"
              position="right"
              formatter={(v) => fmtCompactBRL(Number(v ?? 0))}
              style={{ fontSize: 9, fill: 'var(--text)' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
