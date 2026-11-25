// Escolha do formato do tanque pelo desenho. Cada opção mostra o tanque em vista de arame — a vista de lado e, ao
// lado, a seção — porque no canteiro se reconhece o tanque pela forma, não pelo nome do tampo.

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { FundoCampo, TampoCampo } from '../lib/formulario-tanque'
import type { FormaTanque } from '../lib/tanque'

const TRACO = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinejoin: 'round'
} as const
const EIXO = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 0.8,
  strokeDasharray: '4 3',
  opacity: 0.55
} as const

/**
 * Contorno de um tampo na vista de lado: sai de (x, topo), avança para o lado `sentido` (−1 esquerda, +1 direita) e
 * volta em (x, base). `meia` é a meia altura do costado.
 */
function tampoDeLado(
  x: number,
  topo: number,
  base: number,
  sentido: -1 | 1,
  tampo: TampoCampo
): string {
  const meia = (base - topo) / 2
  // o arco vira para fora do costado: à esquerda no sentido anti-horário, à direita no horário
  const giro = sentido === -1 ? 0 : 1
  switch (tampo) {
    case 'plano':
      return `M${x} ${topo} L${x} ${base}`
    case 'abaulado': {
      // calota rasa: arco de círculo de raio grande
      const flecha = meia * 0.3
      const raio = (meia * meia + flecha * flecha) / (2 * flecha)
      return `M${x} ${topo} A${raio} ${raio} 0 0 ${giro} ${x} ${base}`
    }
    case 'semieliptico':
      return `M${x} ${topo} A${meia / 2} ${meia} 0 0 ${giro} ${x} ${base}`
    case 'hemisferico':
      return `M${x} ${topo} A${meia} ${meia} 0 0 ${giro} ${x} ${base}`
    case 'torisferico': {
      // calota quase reta com o rebordo arredondado nos cantos
      const r = meia * 0.36
      const fora = x + sentido * meia * 0.42
      const dentro = x + sentido * meia * 0.3
      return (
        `M${x} ${topo} Q${dentro} ${topo} ${dentro} ${topo + r} ` +
        `Q${fora} ${topo + meia} ${dentro} ${base - r} Q${dentro} ${base} ${x} ${base}`
      )
    }
  }
}

interface ArameProps {
  forma: FormaTanque
  tampo?: TampoCampo
  fundo?: FundoCampo
  className?: string
}

/** O tanque em vista de arame: de lado e, à direita, a seção (ou a vista de cima, no tanque em pé). */
export function ArameTanque({
  forma,
  tampo = 'plano',
  fundo = 'plano',
  className
}: ArameProps): ReactNode {
  let desenho: ReactNode
  if (forma === 'tabela') {
    // qualquer tanque: uma tabela de alturas e volumes
    desenho = (
      <>
        <rect x={30} y={10} width={60} height={44} rx={2} {...TRACO} />
        <path d="M30 21 H90 M30 32 H90 M30 43 H90 M60 10 V54" {...TRACO} strokeWidth={1} />
      </>
    )
  } else if (forma === 'retangular') {
    desenho = (
      <>
        <rect x={12} y={16} width={62} height={32} {...TRACO} />
        <rect x={86} y={16} width={24} height={32} {...TRACO} />
        <path d="M6 32 H80" {...EIXO} />
      </>
    )
  } else if (forma === 'cilindrico_vertical') {
    const esq = 28
    const dir = 62
    const topo = 8
    const base = 44
    const meio = (esq + dir) / 2
    const fundoPath =
      fundo === 'conico'
        ? `M${esq} ${base} L${meio} ${base + 13} L${dir} ${base}`
        : fundo === 'abaulado'
          ? `M${esq} ${base} A30 30 0 0 0 ${dir} ${base}`
          : `M${esq} ${base} L${dir} ${base}`
    desenho = (
      <>
        <path d={`M${esq} ${base} V${topo} H${dir} V${base}`} {...TRACO} />
        <path d={fundoPath} {...TRACO} />
        {fundo !== 'plano' ? (
          <path d={`M${esq} ${base} H${dir}`} {...TRACO} strokeWidth={0.9} />
        ) : null}
        <path d={`M${meio} 3 V61`} {...EIXO} />
        <circle cx={96} cy={28} r={14} {...TRACO} />
      </>
    )
  } else {
    // deitados: cilíndrico (seção redonda), elíptico e oval (seção mais larga que alta)
    const redondo = forma === 'cilindrico_horizontal'
    const topo = redondo ? 14 : 19
    const base = redondo ? 50 : 45
    const esq = 22
    const dir = 70
    const emenda = tampo !== 'plano'
    desenho = (
      <>
        <path d={`M${esq} ${topo} H${dir} M${esq} ${base} H${dir}`} {...TRACO} />
        <path d={tampoDeLado(esq, topo, base, -1, tampo)} {...TRACO} />
        <path d={tampoDeLado(dir, topo, base, 1, tampo)} {...TRACO} />
        {emenda ? (
          <path
            d={`M${esq} ${topo} V${base} M${dir} ${topo} V${base}`}
            {...TRACO}
            strokeWidth={0.9}
          />
        ) : null}
        <path d="M2 32 H88" {...EIXO} />
        {redondo ? (
          <circle cx={103} cy={32} r={13} {...TRACO} />
        ) : forma === 'eliptico_horizontal' ? (
          <ellipse cx={102} cy={32} rx={15} ry={10} {...TRACO} />
        ) : (
          <rect x={87} y={22} width={30} height={20} rx={10} {...TRACO} />
        )}
      </>
    )
  }
  return (
    <svg viewBox="0 0 120 64" aria-hidden className={cn('h-14 w-full', className)}>
      {desenho}
    </svg>
  )
}

interface Opcao<T extends string> {
  valor: T
  titulo: string
  /** uma frase curta que explica a forma sem jargão */
  apoio?: string
  desenho: ReactNode
}

interface EscolhaProps<T extends string> {
  /** nome do grupo, mostrado acima e lido pelo leitor de tela */
  rotulo: string
  valor: T
  opcoes: Array<Opcao<T>>
  aoMudar: (valor: T) => void
  /** classes da grade (colunas) */
  className?: string
}

/** Escolha única entre opções desenhadas. As setas trocam a opção, como num grupo de rádio. */
export function EscolhaPorDesenho<T extends string>({
  rotulo,
  valor,
  opcoes,
  aoMudar,
  className
}: EscolhaProps<T>): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>): void => {
    const passo =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!passo) return
    e.preventDefault()
    const i = (opcoes.findIndex((o) => o.valor === valor) + passo + opcoes.length) % opcoes.length
    aoMudar(opcoes[i].valor)
    ref.current?.querySelectorAll<HTMLButtonElement>('button')[i]?.focus()
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{rotulo}</span>
      <div
        ref={ref}
        role="radiogroup"
        aria-label={rotulo}
        onKeyDown={aoTeclar}
        className={cn('grid gap-2', className)}
      >
        {opcoes.map((o) => {
          const marcado = o.valor === valor
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={marcado}
              tabIndex={marcado ? 0 : -1}
              title={o.apoio}
              onClick={() => aoMudar(o.valor)}
              className={cn(
                'flex flex-col items-center rounded border px-1.5 pb-1.5 pt-1 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                marcado
                  ? 'border-accent bg-accent-glow-strong text-accent'
                  : 'border-border-strong bg-bg-panel text-text-muted hover:border-border-accent hover:text-text'
              )}
            >
              {o.desenho}
              <span
                className={cn('text-xs leading-tight', marcado ? 'font-semibold' : 'text-text')}
              >
                {o.titulo}
              </span>
              {o.apoio ? (
                <span className="mt-0.5 text-2xs leading-tight text-text-muted">{o.apoio}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A ponta do tanque deitado, ampliada: o costado chega pela esquerda, a emenda e o tampo. É o desenho das opções de
 * tampo — no tanque inteiro a diferença entre um tampo e outro quase não aparece.
 */
export function PontaTanque({
  tampo,
  className
}: {
  tampo: TampoCampo
  className?: string
}): ReactNode {
  const x = 26
  const topo = 8
  const base = 48
  return (
    <svg viewBox="0 0 64 56" aria-hidden className={cn('h-14 w-full', className)}>
      <path d={`M2 ${topo} H${x} M2 ${base} H${x}`} {...TRACO} />
      <path d={tampoDeLado(x, topo, base, 1, tampo)} {...TRACO} />
      {tampo !== 'plano' ? (
        <path d={`M${x} ${topo} V${base}`} {...TRACO} strokeWidth={0.9} />
      ) : null}
      <path d="M0 28 H60" {...EIXO} />
    </svg>
  )
}

/** O fundo do tanque em pé, ampliado: as paredes descem e o fundo fecha reto, em funil ou em calota. */
export function FundoTanque({
  fundo,
  className
}: {
  fundo: FundoCampo
  className?: string
}): ReactNode {
  const esq = 12
  const dir = 52
  const base = 28
  const meio = (esq + dir) / 2
  const fecho =
    fundo === 'conico'
      ? `M${esq} ${base} L${meio} ${base + 22} L${dir} ${base}`
      : fundo === 'abaulado'
        ? `M${esq} ${base} A34 34 0 0 0 ${dir} ${base}`
        : `M${esq} ${base} H${dir}`
  return (
    <svg viewBox="0 0 64 56" aria-hidden className={cn('h-14 w-full', className)}>
      <path d={`M${esq} 2 V${base} M${dir} 2 V${base}`} {...TRACO} />
      <path d={fecho} {...TRACO} />
      {fundo !== 'plano' ? (
        <path d={`M${esq} ${base} H${dir}`} {...TRACO} strokeWidth={0.9} />
      ) : null}
      <path d={`M${meio} 0 V54`} {...EIXO} />
    </svg>
  )
}
