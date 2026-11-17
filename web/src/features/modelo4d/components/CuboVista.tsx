import { forwardRef, useImperativeHandle, useRef, type CSSProperties, type ReactNode } from 'react'
import { Home } from 'lucide-react'

/** Vista pedida pelo cubo: o rumo em que a câmera olha (null = mantém o atual) e a inclinação, em radianos. */
export interface VistaCubo {
  rumo: number | null
  inclinacao: number
}

export interface CuboVistaRef {
  /** Gira o cubo para a direção da câmera: rumo (0 = norte, horário) e inclinação (−π/2 = de cima), em radianos. */
  orientar: (rumo: number, inclinacao: number) => void
}

interface Props {
  aoOlhar: (vista: VistaCubo) => void
  /** Arrastar o cubo gira a cena em torno do ponto que está no centro da tela. */
  aoArrastar: (dx: number, dy: number, fim: boolean) => void
  aoInicio: () => void
}

const LADO = 64
const AREA = LADO * 1.7
const GRAU = Math.PI / 180

type Ponto = 'N' | 'S' | 'L' | 'O' | 'NE' | 'NO' | 'SE' | 'SO'
// rumo em que a câmera olha quando está naquele ponto cardeal, de frente para o centro
const RUMO: Record<Ponto, number> = {
  N: 180 * GRAU,
  S: 0,
  L: 270 * GRAU,
  O: 90 * GRAU,
  NE: 225 * GRAU,
  NO: 135 * GRAU,
  SE: 315 * GRAU,
  SO: 45 * GRAU
}
const NOME: Record<Ponto, string> = {
  N: 'norte',
  S: 'sul',
  L: 'leste',
  O: 'oeste',
  NE: 'nordeste',
  NO: 'noroeste',
  SE: 'sudeste',
  SO: 'sudoeste'
}
const DE_LADO = -18 * GRAU
const DE_CIMA_45 = -45 * GRAU
const DE_CANTO = -35 * GRAU

interface Zona {
  ponto: Ponto
  inclinacao: number
  estilo: CSSProperties
}

const FAIXA = 11
const CANTO = 15
const borda = {
  cima: { left: CANTO, right: CANTO, top: 0, height: FAIXA },
  baixo: { left: CANTO, right: CANTO, bottom: 0, height: FAIXA },
  esquerda: { top: CANTO, bottom: CANTO, left: 0, width: FAIXA },
  direita: { top: CANTO, bottom: CANTO, right: 0, width: FAIXA },
  cantoCE: { top: 0, left: 0, width: CANTO, height: CANTO },
  cantoCD: { top: 0, right: 0, width: CANTO, height: CANTO },
  cantoBE: { bottom: 0, left: 0, width: CANTO, height: CANTO },
  cantoBD: { bottom: 0, right: 0, width: CANTO, height: CANTO }
} satisfies Record<string, CSSProperties>

/** Face lateral vista de fora: a aresta de cima, as duas verticais e os dois cantos de cima. */
const lateral = (de: Ponto, esquerda: Ponto, direita: Ponto): Zona[] => [
  { ponto: de, inclinacao: DE_CIMA_45, estilo: borda.cima },
  { ponto: esquerda, inclinacao: DE_LADO, estilo: borda.esquerda },
  { ponto: direita, inclinacao: DE_LADO, estilo: borda.direita },
  { ponto: esquerda, inclinacao: DE_CANTO, estilo: borda.cantoCE },
  { ponto: direita, inclinacao: DE_CANTO, estilo: borda.cantoCD }
]

// leste = +x e sul = +y no plano do cubo; cada face lateral fica com o texto de pé (o topo para cima)
const FACES: {
  id: string
  rotulo: string
  nome: string
  giro: string
  vista: VistaCubo
  zonas: Zona[]
}[] = [
  {
    id: 'topo',
    rotulo: 'TOPO',
    nome: 'Vista de cima',
    giro: '',
    vista: { rumo: null, inclinacao: -89.5 * GRAU },
    zonas: [
      { ponto: 'N', inclinacao: DE_CIMA_45, estilo: borda.cima },
      { ponto: 'S', inclinacao: DE_CIMA_45, estilo: borda.baixo },
      { ponto: 'O', inclinacao: DE_CIMA_45, estilo: borda.esquerda },
      { ponto: 'L', inclinacao: DE_CIMA_45, estilo: borda.direita },
      { ponto: 'NO', inclinacao: DE_CANTO, estilo: borda.cantoCE },
      { ponto: 'NE', inclinacao: DE_CANTO, estilo: borda.cantoCD },
      { ponto: 'SO', inclinacao: DE_CANTO, estilo: borda.cantoBE },
      { ponto: 'SE', inclinacao: DE_CANTO, estilo: borda.cantoBD }
    ]
  },
  {
    id: 'norte',
    rotulo: 'N',
    nome: 'Vista a partir do norte',
    giro: 'rotateX(90deg) rotateZ(180deg)',
    vista: { rumo: RUMO.N, inclinacao: DE_LADO },
    zonas: lateral('N', 'NE', 'NO')
  },
  {
    id: 'sul',
    rotulo: 'S',
    nome: 'Vista a partir do sul',
    giro: 'rotateX(-90deg)',
    vista: { rumo: RUMO.S, inclinacao: DE_LADO },
    zonas: lateral('S', 'SO', 'SE')
  },
  {
    id: 'leste',
    rotulo: 'L',
    nome: 'Vista a partir do leste',
    giro: 'rotateZ(-90deg) rotateX(-90deg)',
    vista: { rumo: RUMO.L, inclinacao: DE_LADO },
    zonas: lateral('L', 'SE', 'NE')
  },
  {
    id: 'oeste',
    rotulo: 'O',
    nome: 'Vista a partir do oeste',
    giro: 'rotateZ(90deg) rotateX(-90deg)',
    vista: { rumo: RUMO.O, inclinacao: DE_LADO },
    zonas: lateral('O', 'NO', 'SO')
  }
]

/**
 * Cubo de orientação: mostra para onde a câmera olha. Clicar numa face, aresta ou canto leva a cena para aquela
 * vista; arrastar gira a cena; a casa volta à vista geral e o anel marca o norte.
 */
export const CuboVista = forwardRef<CuboVistaRef, Props>(function CuboVista(
  { aoOlhar, aoArrastar, aoInicio },
  ref
): ReactNode {
  const cubo = useRef<HTMLDivElement>(null)
  const anel = useRef<HTMLDivElement>(null)
  const arrasto = useRef<{ x: number; y: number; andou: number } | null>(null)

  useImperativeHandle(ref, () => ({
    orientar: (rumo, inclinacao) => {
      const tomba = Math.PI / 2 + inclinacao
      if (cubo.current) cubo.current.style.transform = `rotateX(${tomba}rad) rotateZ(${-rumo}rad)`
      if (anel.current) anel.current.style.transform = `rotateX(${tomba}rad) rotateZ(${-rumo}rad)`
    }
  }))

  return (
    <div className="absolute right-3 top-3 select-none" style={{ width: AREA, height: AREA }}>
      <div
        className="absolute inset-0"
        style={{ perspective: 420 }}
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
          ref={anel}
          aria-hidden
          className="pointer-events-none absolute rounded-full border border-border-strong"
          style={{
            left: (AREA - LADO * 1.55) / 2,
            top: (AREA - LADO * 1.55) / 2,
            width: LADO * 1.55,
            height: LADO * 1.55,
            transformStyle: 'preserve-3d'
          }}
        >
          <span
            className="absolute left-1/2 -translate-x-1/2 text-2xs font-semibold text-danger"
            style={{ top: -7, transform: `translateX(-50%) translateZ(${-LADO / 2}px)` }}
          >
            N
          </span>
        </div>
        <div
          ref={cubo}
          className="absolute"
          style={{
            left: (AREA - LADO) / 2,
            top: (AREA - LADO) / 2,
            width: LADO,
            height: LADO,
            transformStyle: 'preserve-3d'
          }}
        >
          {FACES.map((f) => (
            <div
              key={f.id}
              className="absolute inset-0"
              style={{
                transform: `${f.giro} translateZ(${LADO / 2}px)`,
                backfaceVisibility: 'hidden'
              }}
            >
              <button
                type="button"
                aria-label={f.nome}
                title={f.nome}
                onClick={() => aoOlhar(f.vista)}
                className="absolute inset-0 flex items-center justify-center border border-border-strong bg-bg-panel text-xs font-semibold text-text hover:bg-bg-elevated hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {f.rotulo}
              </button>
              {f.zonas.map((z, k) => {
                const nome = `Vista a partir do ${NOME[z.ponto]}${z.inclinacao === DE_LADO ? '' : ', de cima'}`
                return (
                  <button
                    key={k}
                    type="button"
                    tabIndex={-1}
                    aria-label={nome}
                    title={nome}
                    onClick={() => aoOlhar({ rumo: RUMO[z.ponto], inclinacao: z.inclinacao })}
                    className="absolute hover:bg-accent/40"
                    style={z.estilo}
                  />
                )
              })}
            </div>
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
      <button
        type="button"
        aria-label="Voltar à vista geral"
        title="Voltar à vista geral"
        onClick={aoInicio}
        className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded border border-border-strong bg-bg-panel text-text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Home size={13} aria-hidden />
      </button>
    </div>
  )
})
