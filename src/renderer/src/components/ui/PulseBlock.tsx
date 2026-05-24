import { cn } from '@/lib/utils'

interface PulseBlockProps {
  h?: number | string
  w?: number | string
  className?: string
  rounded?: 'sm' | 'md' | 'lg' | 'full'
}

/**
 * Skeleton/placeholder simples — substitui o Skeleton do shadcn (não instalado).
 * Usado durante loading dos cards do dashboard, tabelas, charts.
 */
export function PulseBlock({ h = 12, w = '100%', className, rounded = 'sm' }: PulseBlockProps) {
  const radius =
    rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-lg' : rounded === 'md' ? 'rounded-md' : 'rounded-sm'
  return (
    <div
      className={cn('animate-pulse bg-bg-elevated', radius, className)}
      style={{
        height: typeof h === 'number' ? `${h}px` : h,
        width: typeof w === 'number' ? `${w}px` : w
      }}
    />
  )
}
