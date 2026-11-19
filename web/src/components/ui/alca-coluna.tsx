import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { LARGURA_MINIMA } from '@/lib/tabelas/colunas-ajustaveis'

/**
 * Alça na borda direita do título de uma coluna de grade própria: arrastar, setas com ela em foco, duplo clique
 * volta às larguras padrão. O título leva `relative celula-ajustavel`.
 */
export function AlcaColuna({
  rotulo,
  largura,
  aoMudar,
  aoRestaurar
}: {
  rotulo: string
  largura: number
  aoMudar: (largura: number, final: boolean) => void
  aoRestaurar: () => void
}): ReactNode {
  const [arrastando, setArrastando] = useState(false)

  const aoApertar = (e: PointerEvent<HTMLSpanElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const alca = e.currentTarget
    const x0 = e.clientX
    const l0 = largura
    let ultima = l0
    alca.setPointerCapture(e.pointerId)
    setArrastando(true)
    const selecaoAntes = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const mover = (ev: globalThis.PointerEvent): void => {
      ultima = l0 + ev.clientX - x0
      aoMudar(ultima, false)
    }
    const soltar = (): void => {
      alca.removeEventListener('pointermove', mover)
      alca.removeEventListener('pointerup', soltar)
      alca.removeEventListener('pointercancel', soltar)
      document.body.style.userSelect = selecaoAntes
      setArrastando(false)
      aoMudar(ultima, true)
    }
    alca.addEventListener('pointermove', mover)
    alca.addEventListener('pointerup', soltar)
    alca.addEventListener('pointercancel', soltar)
  }

  const aoTeclar = (e: KeyboardEvent<HTMLSpanElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    e.stopPropagation()
    const passo = (e.shiftKey ? 4 : 1) * 16
    aoMudar(largura + (e.key === 'ArrowRight' ? passo : -passo), true)
  }

  return (
    <span
      className="ajuste-coluna"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Largura da coluna ${rotulo}`}
      aria-valuemin={LARGURA_MINIMA}
      aria-valuemax={2000}
      aria-valuenow={Math.round(largura)}
      tabIndex={0}
      title="Arraste para mudar a largura. Duplo clique volta às larguras padrão."
      data-arrastando={arrastando ? '' : undefined}
      onPointerDown={aoApertar}
      onKeyDown={aoTeclar}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        aoRestaurar()
      }}
    />
  )
}
