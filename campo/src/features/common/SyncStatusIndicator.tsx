import { AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import type { SyncStatus } from '@/core/db/entities'
import { useSyncStatus } from '@/core/sync/useSyncStatus'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'
import { cn } from '@/lib/cn'
import { ROTULO_ENVIO, TOM_ENVIO, rotuloFila, type TomEnvio } from './rotulosEnvio'

/**
 * Indicador da fila de envio no cabeçalho das telas: girando = enviando; cinza = sem rede; âmbar com número = itens
 * aguardando; verde = tudo enviado. Tocar força um ciclo de envio.
 */
export function SyncStatusIndicator({ className }: { className?: string }) {
  const { online, syncing, outboxPending } = useSyncStatus()
  const label = rotuloFila({ online, syncing, outboxPending })
  const tom = tomDaFila({ online, syncing, outboxPending })

  return (
    <button
      type="button"
      onClick={() => void triggerForegroundSync('user-tap-indicator', { ignoreCooldown: true })}
      disabled={syncing}
      aria-label={label}
      title={label}
      className={cn(
        // alvo de toque de 44 px; o selo visível é o miolo
        'inline-flex min-h-touch min-w-touch items-center justify-center disabled:cursor-default',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded px-2 text-2xs font-semibold tabular',
          'transition-colors duration-150',
          tom.selo,
        )}
      >
        {syncing ? (
          <span className="h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
        ) : (
          <span className={cn('h-2 w-2 rounded-full', tom.ponto)} />
        )}
        {outboxPending > 0 && <span>{outboxPending > 99 ? '99+' : outboxPending}</span>}
      </span>
    </button>
  )
}

function tomDaFila(s: { online: boolean; syncing: boolean; outboxPending: number }): {
  selo: string
  ponto: string
} {
  if (s.syncing) return TOM_ENVIO.info
  if (!s.online) return { selo: 'bg-on-surface/10 text-on-surface-dim', ponto: 'bg-on-surface-muted' }
  if (s.outboxPending > 0) return TOM_ENVIO.warn
  return TOM_ENVIO.ok
}

const ICONE: Record<TomEnvio, typeof Clock> = {
  ok: CheckCircle2,
  warn: Clock,
  bad: AlertCircle,
  info: Loader2,
}

/** Selo da situação de envio de um item (lançamento, ficha, foto): mesmo rótulo e mesma cor em todas as telas. */
export function SeloEnvio({ status, className }: { status: SyncStatus; className?: string }) {
  const { rotulo, tom } = ROTULO_ENVIO[status]
  const Icone = ICONE[tom]
  return (
    <span className={cn('selo flex-shrink-0', TOM_ENVIO[tom].selo, className)}>
      <Icone className={cn('h-3 w-3', status === 'SYNCING' && 'animate-spin')} aria-hidden />
      {rotulo}
    </span>
  )
}
