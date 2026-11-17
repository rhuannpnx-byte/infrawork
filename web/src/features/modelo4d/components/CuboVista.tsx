import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react'

export type FaceCubo = 'topo' | 'norte' | 'sul' | 'leste' | 'oeste'

export interface CuboVistaRef {
  /** Gira o cubo para a direção da câmera: rumo (0 = norte, horário) e inclinação (−π/2 = de cima), em radianos. */
  orientar: (rumo: number, inclinacao: number) => void
}

interface Props {
  aoEscolher: (face: FaceCubo) => void
  /** Arrastar o cubo gira a cena em torno do ponto que está no centro da tela. */
  aoArrastar: (dx: number, dy: number, fim: boolean) => void
}

const LADO = 64
// leste = +x e sul = +y no plano do cubo; cada face lateral fica com o texto de pé (o topo para cima)
const FACES: { face: FaceCubo; rotulo: string; nome: string; giro: string }[] = [
  { face: 'topo', rotulo: 'TOPO', nome: 'Vista de cima', giro: '' },
  {
    face: 'norte',
    rotulo: 'N',
    nome: 'Vista a partir do norte',
    giro: 'rotateX(90deg) rotateZ(180deg)'
  },
  { face: 'sul', rotulo: 'S', nome: 'Vista a partir do sul', giro: 'rotateX(-90deg)' },
  {
    face: 'leste',
    rotulo: 'L',
    nome: 'Vista a partir do leste',
    giro: 'rotateZ(-90deg) rotateX(-90deg)'
  },
  {
    face: 'oeste',
    rotulo: 'O',
    nome: 'Vista a partir do oeste',
    giro: 'rotateZ(90deg) rotateX(-90deg)'
  }
]

/** Cubo de orientação: mostra para onde a câmera olha; clicar numa face leva a cena para aquela vista. */
export const CuboVista = forwardRef<CuboVistaRef, Props>(function CuboVista(
  { aoEscolher, aoArrastar },
  ref
): ReactNode {
  const cubo = useRef<HTMLDivElement>(null)
  const arrasto = useRef<{ x: number; y: number; andou: number } | null>(null)

  useImperativeHandle(ref, () => ({
    orientar: (rumo, inclinacao) => {
      if (!cubo.current) return
      const tomba = Math.PI / 2 + inclinacao
      cubo.current.style.transform = `rotateX(${tomba}rad) rotateZ(${-rumo}rad)`
    }
  }))

  return (
    <div
      className="absolute right-3 top-3 select-none"
      style={{ width: LADO * 1.7, height: LADO * 1.7, perspective: 420 }}
      onPointerDown={(e) => {
        arrasto.current = { x: e.clientX, y: e.clientY, andou: 0 }
      }}
      onPointerMove={(e) => {
        const a = arrasto.current
        if (!a) return
        const dx = e.clientX - a.x
        const dy = e.clientY - a.y
        a.andou += Math.abs(dx) + Math.abs(dy)
        a.x = e.clientX
        a.y = e.clientY
        if (a.andou <= 4) return
        // só captura o ponteiro depois de arrastar: capturar no toque roubaria o clique das faces
        if (!e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.setPointerCapture(e.pointerId)
        aoArrastar(dx, dy, false)
      }}
      onPointerUp={(e) => {
        const a = arrasto.current
        arrasto.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId)
        if (a && a.andou > 4) aoArrastar(0, 0, true)
      }}
    >
      <div
        ref={cubo}
        className="absolute"
        style={{
          left: (LADO * 1.7 - LADO) / 2,
          top: (LADO * 1.7 - LADO) / 2,
          width: LADO,
          height: LADO,
          transformStyle: 'preserve-3d'
        }}
      >
        {FACES.map((f) => (
          <button
            key={f.face}
            type="button"
            aria-label={f.nome}
            title={f.nome}
            onClick={() => {
              aoEscolher(f.face)
            }}
            className="absolute inset-0 flex items-center justify-center border border-border-strong bg-bg-panel text-xs font-semibold text-text hover:bg-bg-elevated hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{
              transform: `${f.giro} translateZ(${LADO / 2}px)`,
              backfaceVisibility: 'hidden'
            }}
          >
            {f.rotulo}
          </button>
        ))}
        <div
          aria-hidden
          className="absolute inset-0 border border-border-strong bg-bg-elevated"
          style={{
            transform: `rotateX(180deg) translateZ(${LADO / 2}px)`,
            backfaceVisibility: 'hidden'
          }}
        />
      </div>
    </div>
  )
})
