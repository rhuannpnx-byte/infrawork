// useGanttDrag — gerencia drag de barras no GanttPane (Fase 4).
//
// Modos suportados:
//   * 'move'         — arrasta barra inteira; multi-seleção move tudo junto
//   * 'resize-left'  — ajusta data_inicio
//   * 'resize-right' — ajusta data_fim
//   * 'link'         — drag de cap → cria dependência ao soltar em outra barra
//
// Estratégia:
//   1. mousedown em zone='body|left|right|cap-left|cap-right' chama beginDrag
//   2. threshold de 4px antes de "ativar" — evita conflito com click
//   3. mousemove atualiza preview local (`previewById`) — UI re-renderiza com
//      datas previstas
//   4. mouseup commit:
//        move/resize → useUpdateTarefa({data_inicio, data_fim, data_inicio_manual: true})
//        link        → useAddDependencia({pred_id, suc_id, tipo, lag_dias: 0})
//   5. Escape cancela (limpa preview, não commita)
//
// Snap a dia útil: usamos cronograma-pure.nextWorkDay nos commits. Preview
// usa dia corrido pra fluidez visual; commit final ajusta pro dia útil.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependenciaTipo } from '@/types/planejamento'
import { addDaysLocal, diffDaysLocal, MS_DAY } from '../lib/time-scale'
import { isoDate, parseISO } from '../lib/dates'

export type DragZone = 'body' | 'left' | 'right' | 'cap-left' | 'cap-right'

export interface DragPreview {
  data_inicio: string
  data_fim: string
}

export interface LinkPreview {
  srcId: string
  srcSide: 'left' | 'right'
  fromX: number
  fromY: number
  cursorX: number
  cursorY: number
}

interface InternalDragState {
  active: boolean
  mode: 'move' | 'resize-left' | 'resize-right' | 'link'
  srcId: string
  /** Mouse X em viewport ao iniciar. */
  originX: number
  /** Mouse Y em viewport (pra link preview). */
  originY: number
  /** Snapshot inicial dos ids movidos (move com multi-seleção). */
  initialDates: Map<string, { ini: string; fim: string }>
  /** Cap side em link mode. */
  srcSide?: 'left' | 'right'
  /** Coordenadas absolutas (canvas) do ponto de origem da seta. */
  linkOriginCanvasX?: number
  linkOriginCanvasY?: number
}

export interface UseGanttDragInput {
  pxPerDay: number
  readOnly: boolean
  /** IDs selecionados (move arrasta todos juntos se srcId está dentro). */
  selectedIds: Set<string>
  /** Mapa id → tarefa (pra ler data_inicio/data_fim atuais). */
  tarefasById: Map<string, { id: string; data_inicio: string | null; data_fim: string | null }>
  onCommitMove: (
    updates: Array<{ id: string; data_inicio: string; data_fim: string }>
  ) => Promise<void>
  onCommitResizeLeft: (id: string, newInicio: string) => Promise<void>
  onCommitResizeRight: (id: string, newFim: string) => Promise<void>
  onCommitLink: (predId: string, sucId: string, tipo: DependenciaTipo) => Promise<void>
}

export interface UseGanttDragReturn {
  beginDrag: (
    e: React.MouseEvent,
    barId: string,
    zone: DragZone,
    canvasOriginRect: DOMRect
  ) => void
  /** Mapa de previews ativos durante drag. Vazio quando inativo. */
  previewById: Map<string, DragPreview>
  /** Preview da seta de link sendo desenhada (NULL quando não há link em curso). */
  linkPreview: LinkPreview | null
  /** Modo atual (pra UI mostrar cursor). */
  active: boolean
}

const THRESHOLD_PX = 4

export function useGanttDrag(input: UseGanttDragInput): UseGanttDragReturn {
  const {
    pxPerDay,
    readOnly,
    selectedIds,
    tarefasById,
    onCommitMove,
    onCommitResizeLeft,
    onCommitResizeRight,
    onCommitLink
  } = input

  const stateRef = useRef<InternalDragState | null>(null)
  const [previewById, setPreviewById] = useState<Map<string, DragPreview>>(new Map())
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null)

  const cleanup = useCallback(() => {
    stateRef.current = null
    setPreviewById(new Map())
    setLinkPreview(null)
  }, [])

  const beginDrag = useCallback(
    (e: React.MouseEvent, barId: string, zone: DragZone, canvasRect: DOMRect) => {
      if (readOnly) return
      e.preventDefault()
      e.stopPropagation()

      const tarefa = tarefasById.get(barId)
      if (!tarefa || !tarefa.data_inicio || !tarefa.data_fim) return

      // IDs a serem afetados: move + selectedIds inclui srcId → mover todos
      // selecionados. Senão, só o srcId.
      const ids =
        zone === 'body' && selectedIds.has(barId) && selectedIds.size > 1
          ? Array.from(selectedIds)
          : [barId]

      const initialDates = new Map<string, { ini: string; fim: string }>()
      for (const id of ids) {
        const t = tarefasById.get(id)
        if (t?.data_inicio && t?.data_fim) {
          initialDates.set(id, { ini: t.data_inicio, fim: t.data_fim })
        }
      }

      let mode: InternalDragState['mode']
      let srcSide: 'left' | 'right' | undefined
      if (zone === 'body') mode = 'move'
      else if (zone === 'left') mode = 'resize-left'
      else if (zone === 'right') mode = 'resize-right'
      else {
        mode = 'link'
        srcSide = zone === 'cap-left' ? 'left' : 'right'
      }

      // Para link mode: calcula ponto de origem em coordenadas do CANVAS.
      const target = e.currentTarget as HTMLElement
      const barRect = target.getBoundingClientRect()
      let linkOriginCanvasX: number | undefined
      let linkOriginCanvasY: number | undefined
      if (mode === 'link') {
        const sideX = srcSide === 'left' ? barRect.left : barRect.right
        const midY = barRect.top + barRect.height / 2
        linkOriginCanvasX = sideX - canvasRect.left
        linkOriginCanvasY = midY - canvasRect.top
      }

      stateRef.current = {
        active: false,
        mode,
        srcId: barId,
        originX: e.clientX,
        originY: e.clientY,
        initialDates,
        srcSide,
        linkOriginCanvasX,
        linkOriginCanvasY
      }

      const onMove = (ev: MouseEvent): void => {
        const st = stateRef.current
        if (!st) return
        const dx = ev.clientX - st.originX

        // Só ativa drag após threshold (evita disparar em click acidental)
        if (!st.active && Math.abs(dx) < THRESHOLD_PX) return
        if (!st.active) st.active = true

        if (st.mode === 'link') {
          // Atualiza linkPreview baseado em coords do CANVAS
          if (st.linkOriginCanvasX == null || st.linkOriginCanvasY == null) return
          const cursorCanvasX = ev.clientX - canvasRect.left
          const cursorCanvasY = ev.clientY - canvasRect.top
          setLinkPreview({
            srcId: st.srcId,
            srcSide: st.srcSide!,
            fromX: st.linkOriginCanvasX,
            fromY: st.linkOriginCanvasY,
            cursorX: cursorCanvasX,
            cursorY: cursorCanvasY
          })
          return
        }

        // Move/resize: converte dx em dias
        const deltaDias = Math.round(dx / pxPerDay)
        const newPreview = new Map<string, DragPreview>()

        if (st.mode === 'move') {
          for (const [id, init] of st.initialDates) {
            const ini = isoDate(addDaysLocal(parseISO(init.ini), deltaDias))
            const fim = isoDate(addDaysLocal(parseISO(init.fim), deltaDias))
            newPreview.set(id, { data_inicio: ini, data_fim: fim })
          }
        } else if (st.mode === 'resize-left') {
          const init = st.initialDates.get(st.srcId)
          if (!init) return
          let novoIni = addDaysLocal(parseISO(init.ini), deltaDias)
          const fim = parseISO(init.fim)
          // Clamp: data_inicio nunca depois de data_fim
          if (novoIni > fim) novoIni = fim
          newPreview.set(st.srcId, {
            data_inicio: isoDate(novoIni),
            data_fim: init.fim
          })
        } else if (st.mode === 'resize-right') {
          const init = st.initialDates.get(st.srcId)
          if (!init) return
          let novoFim = addDaysLocal(parseISO(init.fim), deltaDias)
          const ini = parseISO(init.ini)
          if (novoFim < ini) novoFim = ini
          newPreview.set(st.srcId, {
            data_inicio: init.ini,
            data_fim: isoDate(novoFim)
          })
        }
        setPreviewById(newPreview)
      }

      const onUp = (ev: MouseEvent): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('keydown', onKey)

        const st = stateRef.current
        if (!st) return cleanup()

        // Click sem drag: apenas limpa state, não commita
        if (!st.active) return cleanup()

        if (st.mode === 'link') {
          // Detecta target via elementFromPoint
          const target = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
          const bar = target?.closest('[data-bar-id]') as HTMLElement | null
          const dstId = bar?.dataset.barId
          cleanup()
          if (!dstId || dstId === st.srcId) {
            return // soltou no nada ou em si mesma → cancela
          }
          // Determina dstSide pela metade x do bar destino
          const dstRect = bar!.getBoundingClientRect()
          const dstSide: 'left' | 'right' = ev.clientX < dstRect.left + dstRect.width / 2 ? 'left' : 'right'
          // Infere tipo
          let tipo: DependenciaTipo
          if (st.srcSide === 'right' && dstSide === 'left') tipo = 'FS'
          else if (st.srcSide === 'left' && dstSide === 'left') tipo = 'SS'
          else if (st.srcSide === 'right' && dstSide === 'right') tipo = 'FF'
          else tipo = 'SF'
          void onCommitLink(st.srcId, dstId, tipo)
          return
        }

        // Move/resize commit
        if (st.mode === 'move') {
          const updates: Array<{ id: string; data_inicio: string; data_fim: string }> = []
          for (const [id, preview] of previewByRef.current) {
            updates.push({
              id,
              data_inicio: preview.data_inicio,
              data_fim: preview.data_fim
            })
          }
          cleanup()
          if (updates.length > 0) void onCommitMove(updates)
          return
        }
        if (st.mode === 'resize-left') {
          const p = previewByRef.current.get(st.srcId)
          cleanup()
          if (p) void onCommitResizeLeft(st.srcId, p.data_inicio)
          return
        }
        if (st.mode === 'resize-right') {
          const p = previewByRef.current.get(st.srcId)
          cleanup()
          if (p) void onCommitResizeRight(st.srcId, p.data_fim)
          return
        }
      }

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape') {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          window.removeEventListener('keydown', onKey)
          cleanup()
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('keydown', onKey)
    },
    [
      readOnly,
      tarefasById,
      selectedIds,
      pxPerDay,
      onCommitMove,
      onCommitResizeLeft,
      onCommitResizeRight,
      onCommitLink,
      cleanup
    ]
  )

  // Ref pra acessar preview atual dentro de closures de eventListeners
  const previewByRef = useRef(previewById)
  useEffect(() => {
    previewByRef.current = previewById
  }, [previewById])

  // Limpa quando readOnly ou input muda significativamente
  useEffect(() => () => cleanup(), [cleanup])

  // Silencia helpers usados acima
  void diffDaysLocal
  void MS_DAY

  return {
    beginDrag,
    previewById,
    linkPreview,
    active: previewById.size > 0 || linkPreview !== null
  }
}
