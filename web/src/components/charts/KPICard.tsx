import { type ReactNode } from 'react'
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KPICardProps {
  label: string
  value: string
  delta?: number // ratio, e.g. 0.043 = +4.3%
  unit?: string
  spark?: number[]
  hint?: string
  icon?: ReactNode
}

export function KPICard({ label, value, delta, unit, spark, hint, icon }: KPICardProps): ReactNode {
  const positive = (delta ?? 0) >= 0
  const sparkData = spark?.map((v, i) => ({ i, v })) ?? []

  return (
    <div className="rounded border border-border bg-bg-panel px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
          {icon}
          {label}
        </div>
        {delta !== undefined ? (
          <div
            className={cn(
              'flex items-center gap-0.5 text-xs font-semibold tabular px-1 py-0.5 rounded',
              positive ? 'text-success bg-success/10' : 'text-danger bg-danger/10'
            )}
          >
            {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(delta * 100).toFixed(1)}%
          </div>
        ) : null}
      </div>
      <div className="flex items-baseline gap-1">
        <div className="text-2xl font-semibold text-text tabular leading-tight">{value}</div>
        {unit ? <span className="text-sm text-text-muted">{unit}</span> : null}
      </div>
      {hint ? <div className="text-sm text-text-muted mt-0.5">{hint}</div> : null}
      {spark && spark.length > 0 ? (
        <div className="h-7 mt-2 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <YAxis domain={['dataMin', 'dataMax']} hide />
              <Line
                dataKey="v"
                stroke={positive ? 'var(--success)' : 'var(--danger)'}
                strokeWidth={1.4}
                dot={false}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  )
}
