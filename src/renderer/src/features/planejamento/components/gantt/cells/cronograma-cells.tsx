// Cells do grupo "Cronograma": DuracaoCell, InicioCell, FimCell.
//
// Duração é read-only (vem de duracao_dias_uteis_calc da view, populada pela
// edge function calcular-cronograma). Início e Fim editáveis via InlineDateCell;
// editar set data_inicio_manual=true pra que o motor CPM respeite a data.

import { type ReactNode } from 'react'
import { InlineDateCell } from '@/components/InlineDateCell'
import type { CellProps } from './types'

// ─── DuracaoCell ───────────────────────────────────────────────────────────
export function DuracaoCell({ node }: CellProps): ReactNode {
  // Marcos têm duração 0; mostra "—"
  if (node.tipo_no === 'marco') {
    return <Dash />
  }
  const dur = node.duracao_dias_uteis_calc
  return (
    <div className="flex items-center justify-end h-full px-1 text-2xs font-mono tabular-nums text-text-muted">
      {dur != null ? `${dur}d` : '—'}
    </div>
  )
}

// ─── InicioCell ────────────────────────────────────────────────────────────
export function InicioCell({ node, ctx }: CellProps): ReactNode {
  // Grupo: roll-up de min(filhos); read-only
  if (node.tipo_no === 'grupo') {
    return (
      <div className="flex items-center h-full px-1 text-2xs font-mono text-text-dim italic">
        {node.data_inicio ? formatDataBR(node.data_inicio) : '—'}
      </div>
    )
  }
  if (ctx.readOnly) {
    return (
      <div className="flex items-center h-full px-1 text-2xs font-mono text-text-muted tabular-nums">
        {node.data_inicio ? formatDataBR(node.data_inicio) : '—'}
      </div>
    )
  }
  return (
    <InlineDateCell
      value={node.data_inicio}
      onCommit={async (v) => {
        await ctx.commitDataInicio(node.id, v)
      }}
    />
  )
}

// ─── FimCell ───────────────────────────────────────────────────────────────
export function FimCell({ node, ctx }: CellProps): ReactNode {
  if (node.tipo_no === 'grupo') {
    return (
      <div className="flex items-center h-full px-1 text-2xs font-mono text-text-dim italic">
        {node.data_fim ? formatDataBR(node.data_fim) : '—'}
      </div>
    )
  }
  // Marcos: data_fim = data_inicio sempre; mostra readonly
  if (node.tipo_no === 'marco') {
    return (
      <div className="flex items-center h-full px-1 text-2xs font-mono text-text-muted tabular-nums">
        {node.data_fim ? formatDataBR(node.data_fim) : '—'}
      </div>
    )
  }
  if (ctx.readOnly) {
    return (
      <div className="flex items-center h-full px-1 text-2xs font-mono text-text-muted tabular-nums">
        {node.data_fim ? formatDataBR(node.data_fim) : '—'}
      </div>
    )
  }
  return (
    <InlineDateCell
      value={node.data_fim}
      onCommit={async (v) => {
        await ctx.commitDataFim(node.id, v)
      }}
    />
  )
}

function formatDataBR(iso: string): string {
  // iso = 'YYYY-MM-DD'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y.slice(2)}`
}

function Dash(): ReactNode {
  return (
    <div className="flex items-center justify-center h-full text-text-faint text-xs">—</div>
  )
}
