import { type ReactNode, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList
} from 'recharts'
import { CHART_THEME, axisStyle } from '@/components/charts/theme'
import type { PrevistoRealizadoItem } from '@/types/acompanhamento'
import { STATUS_COMP_COR, STATUS_COMP_LABEL } from '@/types/acompanhamento'

interface Props {
  itens: PrevistoRealizadoItem[]
  limit?: number
  altura?: number
  onPick?: (item_orcamentario_id: string | null) => void
  selectedId?: string | null
}

interface DataRow {
  id: string
  label: string
  descricao: string
  pct: number
  status: PrevistoRealizadoItem['status']
  cor: string
}

function CustomTooltip(props: { active?: boolean; payload?: Array<{ payload?: DataRow }> }): ReactNode {
  const { active, payload } = props
  if (!active || !payload?.length) return null
  const p = (payload[0]?.payload ?? {}) as DataRow
  return (
    <div className="rounded border border-border-strong bg-bg-elevated px-2 py-1.5 shadow-lg text-xs font-mono">
      <div className="text-text font-semibold">{p.label} — {p.descricao}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="size-2 rounded-sm" style={{ background: p.cor }} />
        <span style={{ color: p.cor }}>{p.pct}%</span>
        <span className="text-text-dim">·</span>
        <span className="text-text-dim">{STATUS_COMP_LABEL[p.status]}</span>
      </div>
    </div>
  )
}

export function TopServicosBar({ itens, limit = 5, altura = 200, onPick, selectedId }: Props): ReactNode {
  const data = useMemo<DataRow[]>(() => {
    return (itens ?? [])
      .filter((i) => i.qtd_plan && i.qtd_plan > 0)
      .map((i) => ({
        id: i.item_orcamentario_id,
        label: i.codigo,
        descricao: i.descricao,
        pct: Math.round(Math.min(1, Number(i.pct_avanco ?? 0)) * 100),
        status: i.status,
        cor: STATUS_COMP_COR[i.status]
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, limit)
  }, [itens, limit])

  if (data.length === 0) {
    return (
      <div className="rounded border border-border bg-bg-panel p-4 text-text-dim text-2xs font-mono flex items-center justify-center" style={{ height: altura }}>
        Sem serviços com plano associado
      </div>
    )
  }

  return (
    <div className="rounded border border-border bg-bg-panel" style={{ height: altura }}>
      <div className="px-3 pt-3 pb-1 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-text">Top serviços (% avanço)</h4>
        <span className="text-2xs font-mono text-text-dim">vs baseline</span>
      </div>
      <div style={{ height: altura - 36 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 32, left: 12, bottom: 8 }}
            onClick={(e) => {
              if (!onPick) return
              const idx = (e as { activeTooltipIndex?: number }).activeTooltipIndex
              if (idx == null) return
              const row = data[idx]
              if (!row) return
              onPick(selectedId === row.id ? null : row.id)
            }}
            style={onPick ? { cursor: 'pointer' } : undefined}
          >
            <CartesianGrid stroke={CHART_THEME.gridStroke} strokeDasharray="2 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={axisStyle} stroke={CHART_THEME.axisStroke} tickFormatter={(v) => `${v}%`} />
            <YAxis dataKey="label" type="category" tick={axisStyle} stroke={CHART_THEME.axisStroke} width={70} />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'rgba(120,150,200,.06)' }}
            />
            <Bar dataKey="pct" barSize={14} radius={[0, 2, 2, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.label}
                  fill={d.cor}
                  fillOpacity={selectedId == null || selectedId === d.id ? 1 : 0.35}
                  stroke={selectedId === d.id ? '#fff' : undefined}
                  strokeWidth={selectedId === d.id ? 1 : 0}
                />
              ))}
              <LabelList dataKey="pct" position="right" fill={CHART_THEME.tooltipText} fontSize={10} formatter={(v) => `${v}%`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
