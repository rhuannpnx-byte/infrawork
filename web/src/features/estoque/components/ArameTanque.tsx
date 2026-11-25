// Escolha do formato do tanque pelo desenho. Cada opção mostra o tanque em vista de arame, em perspectiva (o corpo,
// os anéis de solda, os berços, a boca de visita e a escada), porque no canteiro se reconhece o tanque pela forma,
// não pelo nome do tampo. Os traços saem da geometria 3D de `lib/arame3d.ts`.

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { desenhoDoFormato, desenhoDoFundo, desenhoDoTampo, type DesenhoArame } from '../lib/arame3d'
import type { FundoCampo, TampoCampo } from '../lib/formulario-tanque'
import type { FormaTanque } from '../lib/tanque'

/**
 * Pinta um desenho de arame: cada peça é cheia com a cor da folha (para esconder o que fica atrás dela) e traçada
 * com a cor do texto em volta, então acompanha o tema e o estado do cartão. A espessura do traço é fixa em pixels,
 * para o desenho ficar nítido em qualquer tamanho.
 */
function Arame({ desenho, className }: { desenho: DesenhoArame; className?: string }): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${desenho.largura} ${desenho.altura}`}
      aria-hidden
      className={cn('w-full', className)}
    >
      {desenho.tracos.map((t, i) =>
        t.tipo === 'corpo' ? (
          <path
            key={i}
            d={t.d}
            className="fill-bg-panel"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <path
            key={i}
            d={t.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={t.tipo === 'linha' ? 1.1 : 0.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )
      )}
    </svg>
  )
}

/** O tanque inteiro, para a escolha do formato. A "tabela do fabricante" não tem forma: é uma tabela. */
export function ArameTanque({
  forma,
  className
}: {
  forma: FormaTanque
  className?: string
}): ReactNode {
  if (forma === 'tabela')
    return (
      <svg viewBox="0 0 200 120" aria-hidden className={cn('h-20 w-full', className)}>
        <rect
          x={52}
          y={22}
          width={96}
          height={76}
          rx={3}
          className="fill-bg-panel"
          stroke="currentColor"
          strokeWidth={1.7}
        />
        <path
          d="M52 41 H148 M52 60 H148 M52 79 H148 M100 22 V98"
          fill="none"
          stroke="currentColor"
          strokeWidth={0.9}
        />
      </svg>
    )
  return <Arame desenho={desenhoDoFormato(forma)} className={cn('h-20', className)} />
}

/** A ponta do tanque deitado, quase de perfil: é no contorno que um tampo se distingue do outro. */
export function PontaTanque({
  tampo,
  className
}: {
  tampo: TampoCampo
  className?: string
}): ReactNode {
  return <Arame desenho={desenhoDoTampo(tampo)} className={cn('h-20', className)} />
}

/** O tanque em pé visto quase de lado: o fundo aparece por baixo do costado (reto, em funil ou em calota). */
export function FundoTanque({
  fundo,
  className
}: {
  fundo: FundoCampo
  className?: string
}): ReactNode {
  return <Arame desenho={desenhoDoFundo(fundo)} className={cn('h-20', className)} />
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
