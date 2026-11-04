import { Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  AlertCircle,
  Clock,
  Trash2,
} from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated, useSession } from '@/core/auth/SessionStore'
import { useFotosDaObra, useObra } from '@/core/db/daos'
import { SyncStatusIndicator } from '@/features/common/SyncStatusIndicator'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'
import { deleteFoto } from '@/features/fotos/fotoRepo'
import type { OutFoto } from '@/core/db/entities'
import { cn } from '@/lib/cn'

/**
 * Lista de fotos PENDENTES (não-SYNCED) — refactor 2026-05-26:
 *
 *   - REMOVIDO: visualização de foto (thumbs + detalhe fullscreen). User
 *     pediu pra app focar SÓ no que falta enviar — fotos sincronizadas
 *     ficam no SIGA web e (no APK) também na galeria do telefone.
 *   - Cards verticais com status, metadados e ação retry/excluir.
 *   - Contador secundário "X já enviadas" pra dar feedback de progresso.
 *   - FAB central "Tirar foto" + botão "Sincronizar agora" no header.
 */
export function FotosListRoute() {
  const authed = useIsAuthenticated()
  const session = useSession()
  const navigate = useNavigate()

  const obra = useObra(session?.obraAtualId)
  const feed = useFotosDaObra(session?.obraAtualId)
  const pending = feed?.pending
  const syncedCount = feed?.syncedCount ?? 0

  if (!authed) return <Navigate to="/login" replace />
  if (session?.obraAtualId == null) return <Navigate to="/" replace />

  function handleRefresh() {
    void triggerForegroundSync('fotos-list-refresh', { ignoreCooldown: true })
  }

  return (
    <main className="flex min-h-svh flex-col bg-bg-base">
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base/95 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="flex items-center gap-2 px-2 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-on-surface">Fotos pendentes</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {obra?.codigo ?? '—'} ·{' '}
              {pending == null
                ? 'Carregando…'
                : pending.length === 0
                  ? 'Nada pendente'
                  : `${pending.length} aguardando sync`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            aria-label="Sincronizar agora"
          >
            <RefreshCw className="h-5 w-5" />
          </Button>
          <SyncStatusIndicator />
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto p-4 pb-28">
        {pending == null ? (
          <div className="mt-12 flex items-center justify-center gap-2 text-center text-on-surface-dim">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : pending.length === 0 ? (
          <EmptyState syncedCount={syncedCount} />
        ) : (
          <>
            <ul className="space-y-2">
              {pending.map((f) => (
                <li key={f.id}>
                  <PendingFotoCard foto={f} />
                </li>
              ))}
            </ul>
            {syncedCount > 0 && (
              <p className="mt-6 inline-flex w-full items-center justify-center gap-1 text-center text-xs text-on-surface-dim">
                <CheckCircle2 className="h-3 w-3 text-ok" />
                {syncedCount} foto{syncedCount > 1 ? 's' : ''} já enviada
                {syncedCount > 1 ? 's' : ''} no SIGA
              </p>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate('/fotos/capture')}
        className="fixed bottom-6 right-6 z-20 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-bg-base shadow-xl transition-opacity hover:opacity-90 active:opacity-80"
        aria-label="Tirar foto"
      >
        <Camera className="h-7 w-7" />
      </button>
    </main>
  )
}

function EmptyState({ syncedCount }: { syncedCount: number }) {
  return (
    <div className="flex min-h-[60svh] items-center justify-center">
      <div className="max-w-xs text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ok/10">
          <CheckCircle2 className="h-8 w-8 text-ok" />
        </div>
        <p className="mt-4 font-medium text-on-surface">Tudo sincronizado</p>
        <p className="mt-2 text-sm text-on-surface-dim">
          {syncedCount > 0
            ? `${syncedCount} foto${syncedCount > 1 ? 's' : ''} no SIGA. Toque na câmera pra registrar a próxima.`
            : 'Toque na câmera para registrar a primeira foto da obra.'}
        </p>
      </div>
    </div>
  )
}

function PendingFotoCard({ foto }: { foto: OutFoto }) {
  const time = new Date(foto.capturedAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  async function handleDelete() {
    if (!confirm('Excluir essa foto pendente? Não dá pra recuperar.')) return
    await deleteFoto(foto.id)
  }

  return (
    <div
      className={cn(
        'card-surface flex items-stretch gap-3 px-3 py-3',
        statusBorderCls(foto.syncStatus),
      )}
    >
      <div className="w-1 rounded-full" style={{ backgroundColor: statusColor(foto.syncStatus) }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusBadge status={foto.syncStatus} />
          <span className="text-xs text-on-surface-dim">{time}</span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-on-surface">
          {foto.servicoNome ?? '(sem serviço)'}
        </p>
        <p className="truncate text-xs text-on-surface-dim">
          {[foto.encarregadoNome, foto.equipeNome].filter(Boolean).join(' · ') || '—'}
        </p>
        {foto.lat != null && foto.lng != null && (
          <p className="mt-1 text-[10px] text-on-surface-muted">
            GPS {foto.lat.toFixed(4)}, {foto.lng.toFixed(4)}
            {foto.accuracy ? ` ±${Math.round(foto.accuracy)}m` : ''}
          </p>
        )}
        {foto.syncStatus === 'FAILED' && foto.failureReason && (
          <p className="mt-1 truncate text-[10px] text-bad">Erro: {foto.failureReason}</p>
        )}
      </div>
      {foto.syncStatus !== 'SYNCING' && (
        <button
          type="button"
          onClick={handleDelete}
          className="flex items-center rounded px-2 text-bad transition-colors hover:bg-bad/10"
          aria-label="Excluir"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: OutFoto['syncStatus'] }) {
  const map: Record<OutFoto['syncStatus'], { label: string; icon: JSX.Element; cls: string }> = {
    PENDING: {
      label: 'Aguardando',
      icon: <Clock className="h-3 w-3" />,
      cls: 'bg-warn/15 text-warn',
    },
    SYNCING: {
      label: 'Enviando',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      cls: 'bg-info/15 text-info',
    },
    SYNCED: {
      label: 'Enviada',
      icon: <CheckCircle2 className="h-3 w-3" />,
      cls: 'bg-ok/15 text-ok',
    },
    FAILED: {
      label: 'Falhou',
      icon: <AlertCircle className="h-3 w-3" />,
      cls: 'bg-bad/15 text-bad',
    },
    // Estado do carreteiro; fotos nunca chegam nele (mantido pelo tipo compartilhado).
    REJEITADA: {
      label: 'Recusada',
      icon: <AlertCircle className="h-3 w-3" />,
      cls: 'bg-bad/15 text-bad',
    },
  }
  const m = map[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        m.cls,
      )}
    >
      {m.icon}
      {m.label}
    </span>
  )
}

function statusColor(status: OutFoto['syncStatus']): string {
  switch (status) {
    case 'PENDING':
      return 'rgb(var(--warn) / 0.6)'
    case 'SYNCING':
      return 'rgb(var(--info) / 0.6)'
    case 'SYNCED':
      return 'rgb(var(--ok) / 0.6)'
    case 'FAILED':
    case 'REJEITADA':
      return 'rgb(var(--bad) / 0.6)'
  }
}

function statusBorderCls(status: OutFoto['syncStatus']): string {
  switch (status) {
    case 'FAILED':
      return 'border-l-2 border-l-bad/30'
    default:
      return ''
  }
}
