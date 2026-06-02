// CronogramaSplitter — divisor draggable entre Grid (esquerda) e GanttPane (direita).
//
// Min/max e persistência localStorage ficam em ./split-width.ts (separado pra
// satisfazer react-refresh — componente exporta só o componente).
// Duplo-clique → reseta pro default.

import { useEffect, useState, type ReactNode } from 'react'
import { saveSplitWidth, SPLIT_WIDTH_DEFAULT, SPLIT_WIDTH_MAX, SPLIT_WIDTH_MIN } from './split-width'

interface CronogramaSplitterProps {
  width: number
  onChange: (newWidth: number) => void
}

export function CronogramaSplitter({ width, onChange }: CronogramaSplitterProps): ReactNode {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging])

  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startW = width
    const onMove = (ev: MouseEvent): void => {
      const next = Math.max(
        SPLIT_WIDTH_MIN,
        Math.min(SPLIT_WIDTH_MAX, startW + (ev.clientX - startX))
      )
      onChange(next)
    }
    const onUp = (): void => {
      setDragging(false)
      saveSplitWidth(width)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onDoubleClick = (): void => {
    onChange(SPLIT_WIDTH_DEFAULT)
    saveSplitWidth(SPLIT_WIDTH_DEFAULT)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation="vertical"
      title="Arrastar para redimensionar · duplo-clique para resetar"
      className={[
        'w-1 shrink-0 cursor-col-resize relative group transition-colors',
        dragging ? 'bg-accent' : 'bg-border hover:bg-accent/60'
      ].join(' ')}
    >
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/10" />
    </div>
  )
}
