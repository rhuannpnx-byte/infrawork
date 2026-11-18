import { useMemo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Tracado } from './carteira'

/** Tamanho de desenho do quadro (px); na tela ele estica na largura do cartão, na mesma proporção. */
const L = 480
const A = 200
const LADRILHO = 256
const IMAGEM = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

const xMundo = (lon: number, z: number): number => ((lon + 180) / 360) * LADRILHO * 2 ** z
const yMundo = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * LADRILHO * 2 ** z
}

interface Quadro {
  ladrilhos: Array<{ chave: string; url: string; x: number; y: number }>
  caminhos: string[]
  pontas: Array<[number, number]>
}

/** Enquadra os traçados (maior zoom em que cabem com folga) e lista os ladrilhos de satélite que cobrem o quadro. */
function enquadrar(tracados: Tracado[]): Quadro | null {
  const pontos = tracados.flat()
  if (pontos.length < 2) return null
  let z = 17
  let caixa = { x0: 0, y0: 0, x1: 0, y1: 0 }
  for (; z >= 2; z--) {
    const xs = pontos.map(([lon]) => xMundo(lon, z))
    const ys = pontos.map(([, lat]) => yMundo(lat, z))
    caixa = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    if (caixa.x1 - caixa.x0 <= L * 0.84 && caixa.y1 - caixa.y0 <= A * 0.74) break
  }
  const ox = (caixa.x0 + caixa.x1) / 2 - L / 2
  const oy = (caixa.y0 + caixa.y1) / 2 - A / 2
  const n = 2 ** z
  const ladrilhos: Quadro['ladrilhos'] = []
  for (let ty = Math.floor(oy / LADRILHO); ty <= Math.floor((oy + A) / LADRILHO); ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = Math.floor(ox / LADRILHO); tx <= Math.floor((ox + L) / LADRILHO); tx++) {
      const x = ((tx % n) + n) % n
      ladrilhos.push({
        chave: `${z}/${ty}/${tx}`,
        url: `${IMAGEM}/${z}/${ty}/${x}`,
        x: tx * LADRILHO - ox,
        y: ty * LADRILHO - oy
      })
    }
  }
  // no quadro pequeno, ponto a menos de 1,5 px do anterior não muda o desenho
  const caminhos = tracados.map((t) => {
    let d = ''
    let ultimo: [number, number] | null = null
    t.forEach(([lon, lat], i) => {
      const p: [number, number] = [xMundo(lon, z) - ox, yMundo(lat, z) - oy]
      const fim = i === t.length - 1
      if (ultimo && !fim && Math.hypot(p[0] - ultimo[0], p[1] - ultimo[1]) < 1.5) return
      d += `${d ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`
      ultimo = p
    })
    return d
  })
  const pontas = tracados.flatMap((t) =>
    [t[0], t[t.length - 1]].map(
      ([lon, lat]) => [xMundo(lon, z) - ox, yMundo(lat, z) - oy] as [number, number]
    )
  )
  return { ladrilhos, caminhos, pontas }
}

/** Quadro do cartão da obra: imagem de satélite com o traçado do eixo; sem traçado, o papel quadriculado. */
export function MapaTracado({
  tracados,
  rotulo,
  className,
  children
}: {
  tracados: Tracado[]
  rotulo: string
  className?: string
  children?: ReactNode
}): ReactNode {
  const quadro = useMemo(() => enquadrar(tracados), [tracados])
  const base = cn('relative w-full aspect-[12/5] overflow-hidden bg-bg-elevated', className)

  if (!quadro)
    return (
      <div
        className={base}
        style={{
          backgroundImage:
            'linear-gradient(var(--mt-grid-minor) 1px, transparent 1px), linear-gradient(90deg, var(--mt-grid-minor) 1px, transparent 1px)',
          backgroundSize: '16px 16px'
        }}
      >
        <span className="absolute inset-x-0 bottom-3 text-center text-xs text-text-dim">
          Traçado do eixo ainda não importado
        </span>
        {children}
      </div>
    )

  return (
    <div className={base}>
      <div role="img" aria-label={rotulo} className="absolute inset-0">
        {quadro.ladrilhos.map((t) => (
          <img
            key={t.chave}
            src={t.url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute max-w-none select-none"
            style={{
              left: `${(t.x / L) * 100}%`,
              top: `${(t.y / A) * 100}%`,
              // 1 px a mais fecha a fresta entre ladrilhos vizinhos
              width: `calc(${(LADRILHO / L) * 100}% + 1px)`,
              height: `calc(${(LADRILHO / A) * 100}% + 1px)`
            }}
          />
        ))}
        <svg
          viewBox={`0 0 ${L} ${A}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          {quadro.caminhos.map((d, i) => (
            <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d={d} stroke="var(--sobre-foto)" strokeWidth={6} />
              <path d={d} stroke="var(--chart-laranja)" strokeWidth={2.5} />
            </g>
          ))}
          {quadro.pontas.map(([x, y], i) => (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={3.5}
              fill="var(--na-foto)"
              stroke="var(--sobre-foto)"
              strokeWidth={1.5}
            />
          ))}
        </svg>
      </div>
      <span className="pointer-events-none absolute bottom-1 right-1.5 text-2xs leading-none text-[color:var(--na-foto)] opacity-80">
        Imagem: Esri
      </span>
      {children}
    </div>
  )
}
