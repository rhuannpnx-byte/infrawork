import { useMemo, type ReactNode } from 'react'
import { createRelevo } from '@/app/routes/login-relevo'
import { cn } from '@/lib/utils'

const COLUNAS = 64
const LINHAS = 30
const CELULA = 9

function caminho(seg: Float32Array): string {
  let d = ''
  for (let i = 0; i < seg.length; i += 4)
    d += `M${(seg[i] * CELULA).toFixed(1)} ${(seg[i + 1] * CELULA).toFixed(1)}L${(seg[i + 2] * CELULA).toFixed(1)} ${(seg[i + 3] * CELULA).toFixed(1)}`
  return d
}

/**
 * Curvas de nível do login, em versão discreta: fundo dos estados vazios e da tela de carregamento. É só
 * decoração (some para leitor de tela) e esmaece nas bordas para não disputar com o texto.
 */
export function CurvasDeNivel({
  semente = 81,
  className
}: {
  /** Muda o relevo desenhado; a mesma semente dá sempre o mesmo desenho. */
  semente?: number
  className?: string
}): ReactNode {
  const { normais, mestras } = useMemo(() => {
    const curvas = createRelevo(COLUNAS, LINHAS, semente).isolinhas(0.16, 0, 4)
    return { normais: caminho(curvas.normais), mestras: caminho(curvas.mestras) }
  }, [semente])
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${COLUNAS * CELULA} ${LINHAS * CELULA}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_72%)]',
        className
      )}
    >
      <path d={normais} fill="none" stroke="var(--border)" strokeWidth={1} />
      <path d={mestras} fill="none" stroke="var(--border-strong)" strokeWidth={1} opacity={0.6} />
    </svg>
  )
}
