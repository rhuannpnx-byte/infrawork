import { type ReactNode } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Customized,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { ValorAgregadoBucket } from '../../lib/valor-agregado-calc'
import { fmtBRL } from '@/lib/money'
import { fmtDataMonoBR } from '@/features/planejamento/lib/dates'
import { ChartEmptyState } from '@/components/charts/ChartEmptyState'

interface Props {
  dados: ValorAgregadoBucket[]
  height?: number
}

const COR_RECEITA = 'var(--success, #10b981)'
const COR_CUSTO = 'var(--danger, #ef4444)'

const labels: Record<string, string> = {
  receita_planejada_acum: 'Receita planejada',
  receita_projetada_acum: 'Receita projetada',
  custo_projetado_acum: 'Custo projetado',
  custo_planejado_acum: 'Custo planejado'
}

function fmtCompactBRL(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`
  return `R$ ${v.toFixed(0)}`
}

interface LabelSpec {
  periodo: string
  value: number
  color: string
}

/**
 * Rótulos do "acumulado atual": no bucket de hoje (último com projetada),
 * mostra o acumulado das 3 linhas. Posiciona via escalas internas do recharts
 * e resolve colisão vertical (empilha com gap mínimo).
 */
function RotulosAcumulado(specs: LabelSpec[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function Render(props: any): ReactNode {
    const { xAxisMap, yAxisMap, offset } = props
    if (!xAxisMap || !yAxisMap || specs.length === 0) return null
    const xa = xAxisMap[Object.keys(xAxisMap)[0]]
    const ya = yAxisMap[Object.keys(yAxisMap)[0]]
    const xScale = xa?.scale
    const yScale = ya?.scale
    if (!xScale || !yScale) return null

    const topo = (offset?.top ?? 0) + 8
    const base = (offset?.top ?? 0) + (offset?.height ?? 0) - 4

    const pts = specs
      .map((s) => {
        let px = xScale(s.periodo)
        if (typeof xScale.bandwidth === 'function') px += xScale.bandwidth() / 2
        const py = yScale(s.value)
        return { ...s, px, py }
      })
      .filter((p) => Number.isFinite(p.px) && Number.isFinite(p.py))
      .sort((a, b) => a.py - b.py)

    // Colisão: garante gap vertical mínimo (todos no mesmo x = hoje).
    const GAP = 15
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].py < pts[i - 1].py + GAP) pts[i].py = pts[i - 1].py + GAP
    }
    // Clamp no topo/base do plot.
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i].py > base) pts[i].py = base - (pts.length - 1 - i) * GAP
    }
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].py < pts[i - 1].py + GAP) pts[i].py = pts[i - 1].py + GAP
    }
    pts.forEach((p) => {
      if (p.py < topo) p.py = topo
    })

    return (
      <g>
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.px} cy={yScale(p.value)} r={3} fill={p.color} />
            <text
              x={p.px - 7}
              y={p.py}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={600}
              fill={p.color}
            >
              {fmtCompactBRL(p.value)}
            </text>
          </g>
        ))}
      </g>
    )
  }
}

/**
 * Curva-S de Valor Agregado:
 *   - Receita planejada (verde tracejada) — Curva-S do planejamento
 *   - Receita projetada (verde sólida) — valor agregado do que foi produzido
 *   - Custo projetado (vermelho sólido) — produzido + indireto + impostos
 *   - Custo planejado (cinza tracejado fino) — referência
 * Séries projetadas vão só até hoje. Rótulos mostram o acumulado atual.
 */
export function CurvaSValorAgregado({ dados, height = 400 }: Props): ReactNode {
  if (dados.length === 0) {
    return (
      <ChartEmptyState
        height={height}
        message="Sem dados. É necessário um baseline e produção sincronizada para o valor agregado."
      />
    )
  }

  // Bucket "atual" = último com projetada; fallback = último bucket.
  const alvo =
    [...dados].reverse().find((b) => b.receita_projetada_acum != null) ?? dados[dados.length - 1]
  const specs: LabelSpec[] = []
  if (alvo) {
    specs.push({
      periodo: alvo.periodo,
      value: alvo.receita_planejada_acum,
      color: COR_RECEITA
    })
    if (alvo.receita_projetada_acum != null) {
      specs.push({ periodo: alvo.periodo, value: alvo.receita_projetada_acum, color: COR_RECEITA })
    }
    if (alvo.custo_projetado_acum != null) {
      specs.push({ periodo: alvo.periodo, value: alvo.custo_projetado_acum, color: COR_CUSTO })
    }
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
        <ComposedChart data={dados} margin={{ top: 12, right: 24, bottom: 10, left: 8 }}>
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
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
            contentStyle={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontSize: 11
            }}
            itemStyle={{ color: 'var(--text)' }}
            labelStyle={{ color: 'var(--text)', marginBottom: 2 }}
            labelFormatter={(v) => fmtDataMonoBR(v as string)}
            formatter={(value, name) => {
              if (value == null) return ['—', labels[String(name)] ?? String(name)]
              const num = typeof value === 'number' ? value : Number(value)
              return [fmtBRL(num), labels[String(name)] ?? String(name)]
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(v) => labels[String(v)] ?? String(v)}
          />
          <Line
            type="monotone"
            dataKey="receita_planejada_acum"
            stroke={COR_RECEITA}
            strokeWidth={1.8}
            strokeDasharray="6 4"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="receita_projetada_acum"
            stroke={COR_RECEITA}
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="custo_projetado_acum"
            stroke={COR_CUSTO}
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="custo_planejado_acum"
            stroke="var(--text-dim)"
            strokeWidth={1.2}
            strokeDasharray="3 3"
            dot={false}
          />
          <Customized component={RotulosAcumulado(specs)} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
