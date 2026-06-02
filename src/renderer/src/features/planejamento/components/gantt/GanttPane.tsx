// GanttPane — painel direito do redesign Gantt (Fase 3).
//
// Estrutura:
//   ┌─ TimeScale (sticky-top) ────────────────────────────────────────────┐
//   │   2 tiers adaptativas (year/month/week/day)                         │
//   ├─ Canvas absoluto (width = totalDias × pxPerDay) ────────────────────┤
//   │   Layers em z-index:                                                │
//   │     1. BackgroundLayer: weekend shade + feriados + linha hoje      │
//   │     2. GridLines: linhas verticais sutis no minor tier             │
//   │     3. RowBackgrounds: alternância + selected/hover                │
//   │     5. BarsLayer: TaskBar/SummaryBar/MilestoneMark por row         │
//   │     12. DependencyArrows: SVG overlay com setas FS/SS/FF/SF        │
//   └─────────────────────────────────────────────────────────────────────┘
//
// Sync vertical com Grid via scrollRef imperativo (sem state). Auto-scroll
// horizontal pro `todayDate` na primeira renderização válida.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Equipe } from '@/types/planejamento'
import { addDaysLocal, diffDaysLocal, isWeekend, MS_DAY, pickScaleTiers, iterateTier } from '../../lib/time-scale'
import { parseISO as parseISOLocal } from '../../lib/dates'
import { TimeScale } from './TimeScale'
import {
  DependencyArrow,
  MilestoneMark,
  SummaryBar,
  TaskBar
} from './bars'
import { GanttTooltip } from './GanttTooltip'
import {
  type BarStyle,
  type ColorMode,
  type DepMode
} from '../../hooks/useCronogramaTweaks'
import type { VisibleNode } from './cells/types'
import type { DragZone, UseGanttDragReturn } from '../../hooks/useGanttDrag'
import type { UseGanttLassoReturn } from '../../hooks/useGanttLasso'

interface GanttPaneProps {
  flat: VisibleNode[]
  /** Origem da timeline (data mínima paddada). */
  origin: Date
  /** Fim da timeline (data máxima paddada). */
  end: Date
  pxPerDay: number
  rowHeight: number
  todayDate: Date
  /** Datas de exceções (feriados/paralisações). */
  feriados: string[]
  selectedIds: Set<string>
  hoverId: string | null
  showWeekends: boolean
  showLabels: boolean
  barStyle: BarStyle
  depMode: DepMode
  colorMode: ColorMode
  equipesById: Map<string, Equipe>
  onHover: (id: string | null) => void
  onSelect: (id: string, opts?: { add?: boolean }) => void
  onContextMenu: (id: string, x: number, y: number) => void
  /** Clique na seta SVG de dependência — abre o DepContextMenu. */
  onDepClick?: (depInfo: {
    depId: string
    predId: string
    sucId: string
    tipo: 'FS' | 'SS' | 'FF' | 'SF'
    lag: number
    x: number
    y: number
  }) => void
  /** Ref do scroll container — usada pra sync vertical com o Grid. */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** API do hook useGanttDrag (move/resize/link). */
  dragApi: UseGanttDragReturn
  /** API do hook useGanttLasso (rect select). */
  lassoApi: UseGanttLassoReturn
  /** Ref compartilhado: GanttPane popula durante render; useGanttLasso usa pra
   *  hit-test. Owner é o Shell (passa o mesmo ref pros 2 hooks/componentes). */
  barRectsRef: React.MutableRefObject<Map<string, { x: number; y: number; w: number; h: number }>>
}

export function GanttPane({
  flat,
  origin,
  end,
  pxPerDay,
  rowHeight,
  todayDate,
  feriados,
  selectedIds,
  hoverId,
  showWeekends,
  showLabels,
  barStyle,
  depMode,
  colorMode,
  equipesById,
  onHover,
  onSelect,
  onContextMenu,
  onDepClick,
  scrollRef,
  dragApi,
  lassoApi,
  barRectsRef
}: GanttPaneProps): ReactNode {
  const totalDays = diffDaysLocal(origin, end) + 1
  const totalWidth = totalDays * pxPerDay
  const totalHeight = flat.length * rowHeight

  const [mouseXY, setMouseXY] = useState<{ x: number; y: number } | null>(null)

  // Mapa id → index visual (pra desenhar setas)
  const indexById = useMemo(() => {
    const m = new Map<string, number>()
    flat.forEach((n, i) => m.set(n.id, i))
    return m
  }, [flat])

  // Conversões data ↔ x
  const dateToX = useCallback(
    (iso: string | null): number | null => {
      if (!iso) return null
      const d = parseISOLocal(iso)
      const days = Math.round((d.getTime() - origin.getTime()) / MS_DAY)
      return days * pxPerDay
    },
    [origin, pxPerDay]
  )

  // ─── Auto-scroll pra hoje na primeira renderização válida ────────────────
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (didInitialScroll.current) return
    const el = scrollRef.current
    if (!el) return
    // Espera próximo paint pra clientWidth estar populado
    const id = requestAnimationFrame(() => {
      const x = (diffDaysLocal(origin, todayDate) || 0) * pxPerDay
      const target = Math.max(0, x - el.clientWidth / 3)
      el.scrollLeft = target
      didInitialScroll.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [origin, pxPerDay, todayDate, scrollRef])

  // ─── Hoje X offset ──────────────────────────────────────────────────────
  const todayX = useMemo(() => {
    const x = diffDaysLocal(origin, todayDate) * pxPerDay
    if (x < 0 || x > totalWidth) return null
    return x
  }, [origin, todayDate, pxPerDay, totalWidth])

  // ─── Set de feriados ────────────────────────────────────────────────────
  const feriadosSet = useMemo(() => new Set(feriados), [feriados])

  // ─── GridLines (verticais) baseadas em minor tier ───────────────────────
  const tiers = pickScaleTiers(pxPerDay)
  const minorSpans = useMemo(
    () => iterateTier(origin, end, tiers.minor),
    [origin, end, tiers.minor]
  )

  // ─── Canvas ref pra mapear coords absolutas → coords do canvas ──────────
  const canvasRef = useRef<HTMLDivElement>(null)

  // Helper pra obter canvasRect (DOMRect) atual — usado em mousedown handlers
  const getCanvasRect = useCallback((): DOMRect | null => {
    return canvasRef.current?.getBoundingClientRect() ?? null
  }, [])

  // Limpa o mapa de bar rects a cada render — entradas são repopuladas em renderRow
  barRectsRef.current.clear()

  // ─── Render por linha: TaskBar/SummaryBar/MilestoneMark ─────────────────
  const renderRow = (n: VisibleNode, rowIdx: number): ReactNode => {
    const cy = rowIdx * rowHeight + rowHeight / 2

    if (n.tipo_no === 'grupo') {
      // Datas do grupo vêm do rollup do EAP (min/max dos descendentes) — o CPM
      // não calcula data_inicio/data_fim pra grupos.
      const ini = n.data_inicio_rollup ?? n.data_inicio
      const fim = n.data_fim_rollup ?? n.data_fim
      if (!ini || !fim) return null
      const x = dateToX(ini)
      const x2 = dateToX(fim)
      if (x == null || x2 == null) return null
      return <SummaryBar key={n.id} x={x} width={x2 - x + pxPerDay} cy={cy} />
    }

    // Preview de drag sobrescreve datas se ativo
    const preview = dragApi.previewById.get(n.id)
    const effIni = preview?.data_inicio ?? n.data_inicio
    const effFim = preview?.data_fim ?? n.data_fim

    if (n.tipo_no === 'marco') {
      if (!effIni) return null
      const x = dateToX(effIni)
      if (x == null) return null
      const label = n.nome_custom ?? n.servico_grupo_descricao ?? ''
      // Registra rect aproximado pro lasso
      barRectsRef.current.set(n.id, { x: x - 8, y: cy - 8, w: 16, h: 16 })
      return (
        <MilestoneMark
          key={n.id}
          id={n.id}
          x={x}
          cy={cy}
          label={label}
          showLabel={showLabels}
          selected={selectedIds.has(n.id)}
          hover={hoverId === n.id}
          onMouseEnter={() => onHover(n.id)}
          onMouseLeave={() => onHover(null)}
          onClick={(e) => onSelect(n.id, { add: e.shiftKey || e.ctrlKey || e.metaKey })}
          onMouseDown={(e, side) => {
            const rect = getCanvasRect()
            if (!rect) return
            dragApi.beginDrag(e, n.id, side as DragZone, rect)
          }}
          onContextMenu={(e) => onContextMenu(n.id, e.clientX, e.clientY)}
        />
      )
    }
    // tarefa
    if (!effIni || !effFim) return null
    const x = dateToX(effIni)
    const xEnd = dateToX(effFim)
    if (x == null || xEnd == null) return null
    const width = xEnd - x + pxPerDay
    barRectsRef.current.set(n.id, { x, y: cy - 9, w: width, h: 18 })
    // Cria uma cópia da node com datas previstas pra cor crítica continuar OK
    const effNode = preview ? { ...n, data_inicio: effIni, data_fim: effFim } : n
    // Float (folga) em pixels: total_float (dias úteis) × pxPerDay. 0 se nula/crítica.
    const floatWidth =
      typeof n.total_float === 'number' && n.total_float > 0 && !n.is_critico
        ? n.total_float * pxPerDay
        : 0
    return (
      <TaskBar
        key={n.id}
        node={effNode}
        x={x}
        width={width}
        cy={cy}
        selected={selectedIds.has(n.id)}
        hover={hoverId === n.id}
        showLabels={showLabels}
        barStyle={barStyle}
        colorMode={colorMode}
        equipesById={equipesById}
        floatWidth={floatWidth}
        onMouseEnter={() => onHover(n.id)}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => onSelect(n.id, { add: e.shiftKey || e.ctrlKey || e.metaKey })}
        onMouseDown={(e, side) => {
          if (e.button !== 0) return
          const rect = getCanvasRect()
          if (!rect) return
          dragApi.beginDrag(e, n.id, side as DragZone, rect)
        }}
        onContextMenu={(e) => onContextMenu(n.id, e.clientX, e.clientY)}
      />
    )
  }

  // ─── DependencyArrows ──────────────────────────────────────────────────
  // Para cada tarefa-folha com predecessoras conhecidas no flat[].
  interface ArrowData {
    key: string
    depId: string
    predId: string
    sucId: string
    tipo: 'FS' | 'SS' | 'FF' | 'SF'
    lag: number
    fromX: number
    fromY: number
    toX: number
    toY: number
    side: 'fs' | 'ss' | 'ff' | 'sf'
    critical: boolean
  }
  const arrows = useMemo<ArrowData[]>(() => {
    const out: ArrowData[] = []
    for (const n of flat) {
      if (n.tipo_no === 'grupo') continue
      const preds = n.predecessoras ?? []
      const sucIdx = indexById.get(n.id)
      if (sucIdx == null) continue
      for (const p of preds) {
        const pred = flat.find((x) => x.id === p.predecessora_id)
        if (!pred) continue
        const predIdx = indexById.get(pred.id)
        if (predIdx == null) continue

        // Calcula coordenadas baseadas no tipo
        const predX1 = dateToX(pred.data_inicio)
        const predX2 = dateToX(pred.data_fim)
        const sucX1 = dateToX(n.data_inicio)
        const sucX2 = dateToX(n.data_fim)
        if (predX1 == null || predX2 == null || sucX1 == null || sucX2 == null) continue
        const predEdgeRight = predX2 + pxPerDay
        const sucEdgeRight = sucX2 + pxPerDay

        let fromX: number
        let toX: number
        let side: ArrowData['side']
        switch (p.tipo) {
          case 'FS':
            fromX = predEdgeRight
            toX = sucX1
            side = 'fs'
            break
          case 'SS':
            fromX = predX1
            toX = sucX1
            side = 'ss'
            break
          case 'FF':
            fromX = predEdgeRight
            toX = sucEdgeRight
            side = 'ff'
            break
          case 'SF':
            fromX = predX1
            toX = sucEdgeRight
            side = 'sf'
            break
        }
        const fromY = predIdx * rowHeight + rowHeight / 2
        const toY = sucIdx * rowHeight + rowHeight / 2
        const critical = pred.is_critico && n.is_critico
        out.push({
          key: `${pred.id}-${n.id}-${p.tipo}`,
          depId: p.id,
          predId: pred.id,
          sucId: n.id,
          tipo: p.tipo,
          lag: p.lag_dias ?? 0,
          fromX,
          fromY,
          toX,
          toY,
          side,
          critical
        })
      }
    }
    return out
  }, [flat, indexById, dateToX, pxPerDay, rowHeight])

  // Tooltip target
  const tooltipNode = hoverId ? flat.find((n) => n.id === hoverId) : null

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto bg-bg relative"
      style={{ contain: 'strict' }}
      onMouseMove={(e) => setMouseXY({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setMouseXY(null)}
    >
      <div className="relative" style={{ width: totalWidth, height: totalHeight + 56 /* time-scale */ }}>
        <TimeScale origin={origin} end={end} pxPerDay={pxPerDay} todayDate={todayDate} />

        {/* Canvas body (offset pelo time-scale = 56px) */}
        <div
          ref={canvasRef}
          className="relative"
          style={{ width: totalWidth, height: totalHeight }}
          onMouseDown={(e) => {
            // Mousedown em área vazia → inicia lasso. Filtra clicks em barras E setas.
            const target = e.target as HTMLElement | SVGElement
            if (target instanceof HTMLElement && target.closest('[data-bar-id]')) return
            // SVG: target.closest funciona em browsers modernos pra elementos SVG
            const dom = target as Element
            if (typeof dom.closest === 'function' && dom.closest('.dep-arrow')) return
            if (e.button !== 0) return
            const rect = getCanvasRect()
            if (!rect) return
            lassoApi.beginLasso(e as React.MouseEvent<HTMLElement>, rect)
          }}
        >
          {/* Layer 1: Background (weekends + feriados + hoje) */}
          {showWeekends && pxPerDay >= 6 && (
            <BackgroundLayer
              origin={origin}
              totalDays={totalDays}
              pxPerDay={pxPerDay}
              totalHeight={totalHeight}
              feriadosSet={feriadosSet}
            />
          )}

          {/* Linha vertical hoje + chip rotulado */}
          {todayX !== null && (
            <>
              <div
                className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-10"
                style={{
                  left: todayX,
                  boxShadow: '0 0 6px var(--accent-glow-strong)'
                }}
              />
              <div className="gantt-today-chip" style={{ left: todayX + 4 }}>
                HOJE
              </div>
            </>
          )}

          {/* Layer 2: GridLines (verticais no minor tier) */}
          <div className="absolute inset-0 pointer-events-none">
            {minorSpans.map((s, i) => {
              const left = diffDaysLocal(origin, s.start) * pxPerDay
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-border/30"
                  style={{ left }}
                />
              )
            })}
          </div>

          {/* Layer 3: Row backgrounds (alternância + selected/hover) */}
          <div className="absolute inset-0 pointer-events-none">
            {flat.map((n, i) => (
              <div
                key={n.id}
                className={cn(
                  'absolute left-0 right-0 border-b border-border/30',
                  selectedIds.has(n.id) && 'bg-accent/10',
                  hoverId === n.id && !selectedIds.has(n.id) && 'bg-bg-hover/40',
                  i % 2 === 1 && !selectedIds.has(n.id) && hoverId !== n.id && 'bg-bg-panel/20'
                )}
                style={{ top: i * rowHeight, height: rowHeight }}
              />
            ))}
          </div>

          {/* Layer 5: Bars */}
          <div className="absolute inset-0">
            {flat.map((n, i) => renderRow(n, i))}
          </div>

          {/* Layer 12: Dependency arrows (SVG overlay) */}
          <svg
            className="absolute inset-0"
            width={totalWidth}
            height={totalHeight}
            style={{ zIndex: 12, pointerEvents: 'none' }}
          >
            {arrows.map((a) => (
              <DependencyArrow
                key={a.key}
                fromX={a.fromX}
                fromY={a.fromY}
                toX={a.toX}
                toY={a.toY}
                side={a.side}
                critical={a.critical}
                mode={depMode}
                onClick={
                  onDepClick
                    ? (e) => {
                        e.stopPropagation()
                        onDepClick({
                          depId: a.depId,
                          predId: a.predId,
                          sucId: a.sucId,
                          tipo: a.tipo,
                          lag: a.lag,
                          x: e.clientX,
                          y: e.clientY
                        })
                      }
                    : undefined
                }
              />
            ))}
            {/* Link preview (drag de cap em curso) */}
            {dragApi.linkPreview && (
              <g>
                <line
                  x1={dragApi.linkPreview.fromX}
                  y1={dragApi.linkPreview.fromY}
                  x2={dragApi.linkPreview.cursorX}
                  y2={dragApi.linkPreview.cursorY}
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  opacity={0.8}
                />
                <circle
                  cx={dragApi.linkPreview.cursorX}
                  cy={dragApi.linkPreview.cursorY}
                  r={3}
                  fill="var(--accent)"
                />
              </g>
            )}
          </svg>

          {/* Lasso rect (mousedown em área vazia) */}
          {lassoApi.lasso && (
            <div
              className="absolute pointer-events-none border border-accent bg-accent/10"
              style={{
                left: lassoApi.lasso.x,
                top: lassoApi.lasso.y,
                width: lassoApi.lasso.w,
                height: lassoApi.lasso.h,
                zIndex: 14
              }}
            />
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltipNode && mouseXY && (
        <GanttTooltip node={tooltipNode} x={mouseXY.x} y={mouseXY.y} />
      )}
    </div>
  )
}

// ─── BackgroundLayer (interno) ───────────────────────────────────────────
interface BackgroundLayerProps {
  origin: Date
  totalDays: number
  pxPerDay: number
  totalHeight: number
  feriadosSet: Set<string>
}
function BackgroundLayer({
  origin,
  totalDays,
  pxPerDay,
  totalHeight,
  feriadosSet
}: BackgroundLayerProps): ReactNode {
  const shades: ReactNode[] = []
  for (let i = 0; i < totalDays; i++) {
    const d = addDaysLocal(origin, i)
    // ISO em horário LOCAL — toISOString() converte pra UTC e, em fusos
    // positivos, retorna o dia anterior, deslocando o feriado. Mantém
    // coerência com isWeekend(d) (que já usa getDay() local).
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const weekend = isWeekend(d)
    const feriado = feriadosSet.has(iso)
    if (!weekend && !feriado) continue
    shades.push(
      <div
        key={i}
        className={cn(
          'absolute top-0',
          feriado ? 'bg-warn/10' : 'bg-bg-elevated/40'
        )}
        style={{ left: i * pxPerDay, width: pxPerDay, height: totalHeight }}
        title={feriado ? `Feriado: ${iso}` : undefined}
      />
    )
  }
  return <div className="absolute inset-0 pointer-events-none">{shades}</div>
}
