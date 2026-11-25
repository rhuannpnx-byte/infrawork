import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/utils'
import { alturaTotal, type Tanque } from '../lib/tanque'
import type { StatusEstoque } from '../tipos'

const TOM: Record<StatusEstoque, string> = {
  normal: 'text-success',
  baixo: 'text-warn',
  zerado: 'text-danger',
  negativo: 'text-danger',
  sem_saldo: 'text-text-dim'
}

interface Props {
  /** medidas do tanque; null = depósito (desenha o monte) */
  tanque: Tanque | null
  /** quanto está cheio, de 0 a 1 (em altura no tanque; em quantidade no depósito) */
  fracao: number | null
  status: StatusEstoque
  /** descrição para leitor de tela ("Tanque T1 com 61% do nível") */
  rotulo: string
  className?: string
}

/**
 * Desenho do nível: a seção do tanque (círculo, elipse, oval ou retângulo) cheia até a altura do líquido, ou o monte
 * do depósito cheio na proporção do saldo. A cor acompanha o status; o número fica ao lado, na tela que o usa.
 */
export function DesenhoNivel({ tanque, fracao, status, rotulo, className }: Props): ReactNode {
  const recorte = useId()
  const f = Math.min(1, Math.max(0, fracao ?? 0))
  // caixa de desenho 100 × 100, com a figura centralizada
  let largura = 100
  let altura = 100
  if (tanque) {
    const h = alturaTotal(tanque)
    const w =
      tanque.forma === 'cilindrico_horizontal' || tanque.forma === 'cilindrico_vertical'
        ? tanque.diametro
        : tanque.forma === 'eliptico_horizontal' || tanque.forma === 'oval_horizontal'
          ? tanque.largura
          : tanque.forma === 'retangular'
            ? tanque.largura
            : h * 0.7
    if (w > 0 && h > 0) {
      const escala = 96 / Math.max(w, h)
      largura = w * escala
      altura = h * escala
    }
  }
  const x = (100 - largura) / 2
  const y = (100 - altura) / 2
  const arredondado =
    tanque?.forma === 'cilindrico_horizontal' || tanque?.forma === 'eliptico_horizontal'
      ? 'elipse'
      : tanque?.forma === 'oval_horizontal'
        ? 'oval'
        : 'reto'
  const contorno = (preenchido: boolean): ReactNode => {
    const estilo = preenchido
      ? { fill: 'currentColor', fillOpacity: 0.55, stroke: 'none' }
      : { fill: 'none', stroke: 'currentColor', strokeWidth: 2 }
    if (!tanque) return <path d="M4 94 L50 14 L96 94 Z" strokeLinejoin="round" {...estilo} />
    if (arredondado === 'elipse')
      return <ellipse cx={50} cy={50} rx={largura / 2} ry={altura / 2} {...estilo} />
    return (
      <rect
        x={x}
        y={y}
        width={largura}
        height={altura}
        rx={arredondado === 'oval' ? Math.min(largura, altura) / 2 : 3}
        {...estilo}
      />
    )
  }
  const base = tanque ? y + altura : 94
  const cheio = (tanque ? altura : 80) * f
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={rotulo}
      className={cn('h-24 w-24 shrink-0', TOM[status], className)}
    >
      <defs>
        <clipPath id={recorte}>
          <rect x={0} y={base - cheio} width={100} height={cheio} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${recorte})`}>{contorno(true)}</g>
      <g className="text-border-strong">{contorno(false)}</g>
      {f > 0 && f < 1 ? (
        <line
          x1={tanque ? x : 4}
          x2={tanque ? x + largura : 96}
          y1={base - cheio}
          y2={base - cheio}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  )
}
