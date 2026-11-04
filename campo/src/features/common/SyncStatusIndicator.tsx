import { useSyncStatus } from '@/core/sync/useSyncStatus'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'
import { cn } from '@/lib/cn'

/**
 * Indicador compacto de status de sync para a toolbar das rotas top
 * (home, produção/list, fotos/list, carreteiro/step0).
 *
 * Substitui o banner `fixed top-0` antigo (intrusivo, comia 40px). Aqui é
 * um chip pequeno alinhado direita do header — sempre visível, nunca bloqueia
 * conteúdo. Estados (do mais importante pro menos):
 *
 *   1. syncing    → spinner azul + número de pendentes (se houver)
 *   2. offline    → dot cinza + número de pendentes
 *   3. pendente   → dot âmbar + número (online mas algo está na fila)
 *   4. ok         → dot verde, sem número (tudo sincronizado)
 *
 * Tap → força um ciclo de sync (`triggerForegroundSync` com ignoreCooldown).
 * Sem dropdown/sheet — feedback visual é suficiente; quem quiser detalhes
 * abre a tela de Fotos/Produção que mostra cada item.
 */

interface Props {
  className?: string
}

export function SyncStatusIndicator({ className }: Props) {
  const { online, syncing, outboxPending } = useSyncStatus()

  const label = describe({ online, syncing, outboxPending })
  const tone = pickTone({ online, syncing, outboxPending })

  function handleTap() {
    void triggerForegroundSync('user-tap-indicator', { ignoreCooldown: true })
  }

  return (
    <button
      type="button"
      onClick={handleTap}
      disabled={syncing}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2',
        'font-mono text-[11px] tabular',
        'transition-colors duration-150',
        tone.bg,
        tone.text,
        'hover:brightness-110 active:brightness-95 disabled:cursor-default',
        className,
      )}
    >
      {syncing ? (
        <span
          className={cn(
            'h-2 w-2 animate-spin rounded-full border border-current border-t-transparent',
          )}
        />
      ) : (
        <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
      )}
      {outboxPending > 0 && <span>{outboxPending > 99 ? '99+' : outboxPending}</span>}
    </button>
  )
}

function describe(s: { online: boolean; syncing: boolean; outboxPending: number }): string {
  if (s.syncing) return s.outboxPending > 0 ? `Sincronizando ${s.outboxPending}…` : 'Sincronizando…'
  if (!s.online) {
    return s.outboxPending > 0 ? `Offline — ${s.outboxPending} aguardando` : 'Offline'
  }
  if (s.outboxPending > 0) return `${s.outboxPending} aguardando sincronização`
  return 'Tudo sincronizado'
}

function pickTone(s: { online: boolean; syncing: boolean; outboxPending: number }): {
  bg: string
  text: string
  dot: string
} {
  if (s.syncing) {
    return { bg: 'bg-info/15', text: 'text-info', dot: 'bg-info' }
  }
  if (!s.online) {
    return { bg: 'bg-on-surface-muted/10', text: 'text-on-surface-dim', dot: 'bg-on-surface-muted' }
  }
  if (s.outboxPending > 0) {
    return { bg: 'bg-warn/15', text: 'text-warn', dot: 'bg-warn' }
  }
  return { bg: 'bg-ok/10', text: 'text-ok', dot: 'bg-ok' }
}
