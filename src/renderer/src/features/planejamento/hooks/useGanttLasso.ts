// useGanttLasso — seleção retangular no GanttPane (Fase 4).
//
// Mousedown em área vazia do canvas (não barra/marco/seta) → desenha retângulo
// seguindo o cursor. Mouseup → calcula AABB de cada barra vs rect → seleciona
// todas que interseccionam.
//
// Shift/Ctrl + lasso: adiciona à seleção atual em vez de substituir.
// Escape cancela o lasso em curso.

import { useCallback, useState } from 'react'

export interface LassoRect {
  /** Coordenadas em px relativas ao canvas (origin top-left). */
  x: number
  y: number
  w: number
  h: number
}

interface LassoState {
  startX: number
  startY: number
  curX: number
  curY: number
  additive: boolean
}

export interface UseGanttLassoInput {
  readOnly: boolean
  /** Retorna rect cumulativo (left/right/top/bottom) de cada barra no canvas. */
  barRectsRef: React.MutableRefObject<Map<string, { x: number; y: number; w: number; h: number }>>
  onSelectMany: (ids: string[], opts?: { add?: boolean }) => void
  onClearSelection: () => void
}

export interface UseGanttLassoReturn {
  beginLasso: (e: React.MouseEvent, canvasRect: DOMRect) => void
  /** Retângulo atual do lasso pra UI desenhar. NULL = inativo. */
  lasso: LassoRect | null
}

export function useGanttLasso(input: UseGanttLassoInput): UseGanttLassoReturn {
  const { readOnly, barRectsRef, onSelectMany, onClearSelection } = input
  const [state, setState] = useState<LassoState | null>(null)

  const beginLasso = useCallback(
    (e: React.MouseEvent, canvasRect: DOMRect) => {
      if (readOnly) return
      // Lasso só inicia em mousedown sem modificador especial além de Shift/Ctrl.
      // Filtra mousedown em elementos com data-bar-id (TaskBar/Milestone).
      const target = e.target as HTMLElement
      if (target.closest('[data-bar-id]')) return
      // Right-click não inicia lasso
      if (e.button !== 0) return

      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      const startX = e.clientX - canvasRect.left
      const startY = e.clientY - canvasRect.top

      // Click puro (sem drag): apenas limpa seleção se não additive
      let dragged = false

      setState({ startX, startY, curX: startX, curY: startY, additive })

      const onMove = (ev: MouseEvent): void => {
        const curX = ev.clientX - canvasRect.left
        const curY = ev.clientY - canvasRect.top
        const dx = Math.abs(curX - startX)
        const dy = Math.abs(curY - startY)
        if (!dragged && Math.max(dx, dy) >= 3) dragged = true
        setState({ startX, startY, curX, curY, additive })
      }

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('keydown', onKey)

        if (!dragged) {
          // Click sem drag: limpa seleção (se não additive)
          if (!additive) onClearSelection()
          setState(null)
          return
        }

        const final: LassoRect = {
          x: Math.min(startX, state?.curX ?? startX),
          y: Math.min(startY, state?.curY ?? startY),
          w: Math.abs((state?.curX ?? startX) - startX),
          h: Math.abs((state?.curY ?? startY) - startY)
        }

        // Lê o rect FINAL via closure no setState callback (state pode estar stale)
        // — usa o último valor do range registrado via onMove em vez do state React.
        // Pra simplificar, recalculamos manualmente do último onMove:
        setState((current) => {
          if (!current) return null
          const rect: LassoRect = {
            x: Math.min(current.startX, current.curX),
            y: Math.min(current.startY, current.curY),
            w: Math.abs(current.curX - current.startX),
            h: Math.abs(current.curY - current.startY)
          }
          // Filtra barras que interseccionam o rect
          const hit: string[] = []
          for (const [id, b] of barRectsRef.current) {
            if (
              b.x + b.w >= rect.x &&
              b.x <= rect.x + rect.w &&
              b.y + b.h >= rect.y &&
              b.y <= rect.y + rect.h
            ) {
              hit.push(id)
            }
          }
          if (hit.length > 0) onSelectMany(hit, { add: current.additive })
          else if (!current.additive) onClearSelection()
          return null
        })
        void final
      }

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape') {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          window.removeEventListener('keydown', onKey)
          setState(null)
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('keydown', onKey)
    },
    [readOnly, barRectsRef, onSelectMany, onClearSelection, state?.curX, state?.curY]
  )

  const lasso: LassoRect | null = state
    ? {
        x: Math.min(state.startX, state.curX),
        y: Math.min(state.startY, state.curY),
        w: Math.abs(state.curX - state.startX),
        h: Math.abs(state.curY - state.startY)
      }
    : null

  return { beginLasso, lasso }
}
