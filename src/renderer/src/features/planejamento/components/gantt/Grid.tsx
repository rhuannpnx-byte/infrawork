// Grid — painel esquerdo do redesign Gantt (Fase 2).
//
// Estrutura:
//   ┌─ header 2 tiers (sticky-top) ──────────────────────────────────────┐
//   │  tier 1 (22px): grupos semânticos (Identificação · Cronograma…)   │
//   │  tier 2 (34px): nomes das colunas individuais                     │
//   ├─ body virtualizado (TanStack Virtual) ─────────────────────────────┤
//   │  rows = flat[] de buildTaskTree + flattenVisible                  │
//   └────────────────────────────────────────────────────────────────────┘
//
// Frozen: 3 primeiras colunas (NÂº + EAP + Descrição) ficam sticky-left
// durante scroll horizontal. Implementado via `position: sticky; left: X`
// no header e em cada cell row.

import { useEffect, useMemo, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { useTabVisible } from '@/app/tab-visible'
import {
  type GridColumnConfig,
  type GridColumnGroup,
  GROUP_LABEL,
  totalVisibleWidth
} from '../../lib/grid-columns'
import { GridRow } from './GridRow'
import type { CellContext, VisibleNode } from './cells/types'

interface GridProps {
  flat: VisibleNode[]
  cols: GridColumnConfig[]
  ctx: CellContext
  rowHeight: number
  selectedIds: Set<string>
  hoverId: string | null
  expandedIds: Set<string>
  /** Mapa id → valor calculado de qtd_link (NULL se sem vínculo ou sem dados). */
  qtdLinkValueById: Map<string, number | null>
  /** ID da linha que está como drop target durante o drag de reorder. */
  dragOverId?: string | null
  /** Em qual metade do alvo o cursor está (top = inserir antes, bottom = depois). */
  dragOverSide?: 'top' | 'bottom' | null
  onSelect: (id: string, opts?: { add?: boolean }) => void
  onHover: (id: string | null) => void
  onToggleExpand: (id: string) => void
  onDragRowStart: (id: string, e: React.MouseEvent) => void
  onContextMenu: (id: string, x: number, y: number) => void
  /** Ref do scroll container (compartilhado com sync vertical do GanttPane). */
  scrollRef: React.RefObject<HTMLDivElement | null>
}

/** Computa spans de grupos consecutivos no header tier 1. */
interface HeaderSpan {
  group: GridColumnGroup
  width: number
  startLeft: number
  /** Posição sticky-left cumulativa se TODOS os cols desse span são frozen. */
  frozenLeft: number | null
}

function computeSpans(cols: GridColumnConfig[]): HeaderSpan[] {
  const spans: HeaderSpan[] = []
  let cursor = 0
  let frozenCursor = 0
  for (const c of cols) {
    if (!c.visible) continue
    const last = spans[spans.length - 1]
    if (last && last.group === c.group) {
      last.width += c.width
    } else {
      spans.push({
        group: c.group,
        width: c.width,
        startLeft: cursor,
        frozenLeft: c.frozen ? frozenCursor : null
      })
    }
    if (c.frozen) frozenCursor += c.width
    cursor += c.width
  }
  return spans
}

export function Grid({
  flat,
  cols,
  ctx,
  rowHeight,
  selectedIds,
  hoverId,
  expandedIds,
  qtdLinkValueById,
  dragOverId,
  dragOverSide,
  onSelect,
  onHover,
  onToggleExpand,
  onDragRowStart,
  onContextMenu,
  scrollRef
}: GridProps): ReactNode {
  const totalWidth = totalVisibleWidth(cols)
  const spans = useMemo(() => computeSpans(cols), [cols])

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12
  })

  // Keep-alive: ao reaparecer (vinha de display:none), o scroll element media 0
  // → força o virtualizador a remedir, evitando um frame de grade vazia.
  const tabVisible = useTabVisible()
  useEffect(() => {
    if (tabVisible) virtualizer.measure()
  }, [tabVisible, virtualizer])

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto bg-bg-panel relative"
      style={{ contain: 'strict' }}
    >
      {/* Conteúdo total */}
      <div
        className="relative"
        style={{
          width: totalWidth,
          height: virtualizer.getTotalSize() + 56 /* header */
        }}
      >
        {/* Header — 2 tiers, sticky-top */}
        <div
          className="sticky top-0 z-30 bg-bg-panel border-b border-border"
          style={{ width: totalWidth, height: 56 }}
        >
          {/* Tier 1: grupos */}
          <div className="h-[22px] flex border-b border-border">
            {(() => {
              // Último span frozen ganha sombra divisória.
              let lastFrozenSpanIdx = -1
              spans.forEach((s, i) => {
                if (s.frozenLeft != null) lastFrozenSpanIdx = i
              })
              return spans.map((s, i) => {
                const isLastFrozen = i === lastFrozenSpanIdx
                return (
                  <div
                    key={i}
                    className={cn(
                      'shrink-0 flex items-center px-2',
                      s.frozenLeft == null && 'border-r border-border',
                      'text-2xs font-mono uppercase tracking-wider text-text-dim',
                      'bg-bg-panel'
                    )}
                    style={{
                      width: s.width,
                      ...(s.frozenLeft != null
                        ? {
                            position: 'sticky',
                            left: s.frozenLeft,
                            zIndex: 2,
                            boxShadow: isLastFrozen ? '1px 0 0 var(--border-strong)' : undefined
                          }
                        : {})
                    }}
                  >
                    {GROUP_LABEL[s.group]}
                  </div>
                )
              })
            })()}
          </div>
          {/* Tier 2: col names */}
          <div className="h-[34px] flex">
            {(() => {
              // Pré-computa offsets das frozen + índice da última (evita mutação no map).
              const frozenOffsets: number[] = []
              let lastFrozenIdx = -1
              let cumulative = 0
              for (let i = 0; i < cols.length; i++) {
                const c = cols[i]
                frozenOffsets.push(cumulative)
                if (c.visible && c.frozen) {
                  lastFrozenIdx = i
                  cumulative += c.width
                }
              }
              return cols.map((c, idx) => {
                if (!c.visible) return null
                const isLastFrozen = c.frozen && idx === lastFrozenIdx
                const sticky = c.frozen
                  ? {
                      position: 'sticky' as const,
                      left: frozenOffsets[idx],
                      zIndex: 2,
                      boxShadow: isLastFrozen ? '1px 0 0 var(--border-strong)' : undefined
                    }
                  : {}
                return (
                  <div
                    key={c.key}
                    className={cn(
                      'shrink-0 flex items-end pb-1 px-2',
                      !c.frozen && 'border-r border-border',
                      'text-2xs font-mono uppercase tracking-wider text-text-muted',
                      'bg-bg-panel',
                      c.align === 'right' && 'justify-end',
                      c.align === 'center' && 'justify-center'
                    )}
                    style={{ width: c.width, ...sticky }}
                  >
                    {c.label}
                  </div>
                )
              })
            })()}
          </div>
        </div>

        {/* Body — virtualized rows. Offset pelo header (56px). */}
        <div style={{ position: 'relative', width: totalWidth }}>
          {flat.length === 0 ? (
            <div className="absolute top-4 left-4 text-text-dim text-xs italic">
              Sem tarefas. Use "Adicionar" no header.
            </div>
          ) : (
            virtualizer.getVirtualItems().map((v) => {
              const node = flat[v.index]
              const qtdVal = qtdLinkValueById.get(node.id) ?? null
              return (
                <GridRow
                  key={node.id}
                  node={node}
                  cols={cols}
                  ctx={ctx}
                  rowHeight={rowHeight}
                  top={v.start}
                  selected={selectedIds.has(node.id)}
                  hover={hoverId === node.id}
                  expanded={expandedIds.has(node.id)}
                  qtdLinkValue={qtdVal}
                  dragOverSide={dragOverId === node.id ? (dragOverSide ?? null) : null}
                  onSelect={onSelect}
                  onHover={onHover}
                  onToggleExpand={onToggleExpand}
                  onDragStart={onDragRowStart}
                  onContextMenu={onContextMenu}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
