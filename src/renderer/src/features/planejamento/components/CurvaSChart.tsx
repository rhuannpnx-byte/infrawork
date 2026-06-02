import { type ReactNode } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
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
  custo_acumulado: number
  receita_acumulada: number
  /** Custo acumulado da baseline (linha cinza tracejada). */
  baseline_custo?: number
}

/**
 * Curva-S com 2 séries no mesmo gráfico:
 *   - Custo acumulado (linha sólida em cor de acento)
 *   - Receita acumulada (linha tracejada — receita esperada do faturamento
 *     direto + indireto)
 *
 * Eixo Y em R$ (não mais %). Diferença visual entre as duas linhas = margem
 * acumulada corrente. Comparação com baseline (opcional) entra como 3ª série
 * cinza tracejada fina.
 */
export function CurvaSChart({ planejada, baseline, height = 320 }: Props): ReactNode {
  const byPeriodo = new Map<string, MergedRow>()
  for (const p of planejada) {
    byPeriodo.set(p.periodo, {
      periodo: p.periodo,
      custo_acumulado: p.custo_acumulado,
      receita_acumulada: p.receita_acumulada
    })
  }
  if (baseline) {
    for (const b of baseline) {
      const cur = byPeriodo.get(b.periodo) ?? {
        periodo: b.periodo,
        custo_acumulado: 0,
        receita_acumulada: 0
      }
      cur.baseline_custo = b.custo_acumulado
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

  const fmtTickBRL = (v: number): string => {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`
    return fmtBRL(v)
  }

  return (
    <div className="rounded border border-border bg-bg-panel p-3" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: 20, bottom: 10, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="periodo"
            tickFormatter={(v) => fmtDataMonoBR(v)}
            tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
          />
          <YAxis
            tickFormatter={fmtTickBRL}
            tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
            width={60}
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
              if (name === 'custo_acumulado') return [fmtBRL(num), 'Custo']
              if (name === 'receita_acumulada') return [fmtBRL(num), 'Receita']
              if (name === 'baseline_custo') return [fmtBRL(num), 'Baseline (custo)']
              return [String(value), String(name)]
            }}
          />
          <Line
            type="monotone"
            dataKey="custo_acumulado"
            stroke="var(--accent)"
            strokeWidth={2.5}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="receita_acumulada"
            stroke="var(--success, #10b981)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
          />
          {baseline ? (
            <Line
              type="monotone"
              dataKey="baseline_custo"
              stroke="var(--text-dim)"
              strokeDasharray="3 3"
              strokeWidth={1.2}
              dot={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
