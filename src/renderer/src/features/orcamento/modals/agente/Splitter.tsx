// Divisor vertical draggable para o workbench de 3 painéis. Leve, sem
// persistência (diferente do CronogramaSplitter). `side` indica de que lado o
// painel redimensionado fica, para o delta do mouse ter o sinal certo.

import { useEffect, useState, type ReactNode } from 'react'

interface Props {
  width: number
  min: number
  max: number
  side: 'left' | 'right'
  onChange: (w: number) => void
}

export function Splitter({ width, min, max, side, onChange }: Props): ReactNode {
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
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
      onChange(Math.max(min, Math.min(max, startW + delta)))
    }
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      title="Arrastar para redimensionar"
      className={[
        'w-1 shrink-0 cursor-col-resize relative group transition-colors',
        dragging ? 'bg-accent' : 'bg-border hover:bg-accent/60'
      ].join(' ')}
    >
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/10" />
    </div>
  )
}
