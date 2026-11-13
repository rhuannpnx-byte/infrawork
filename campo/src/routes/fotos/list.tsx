import { db } from '@/core/db/dexie'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated, useSession } from '@/core/auth/SessionStore'
import { useFotosDaObra, useObra } from '@/core/db/daos'
import { SeloEnvio, SyncStatusIndicator } from '@/features/common/SyncStatusIndicator'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'
import { deleteFoto } from '@/features/fotos/fotoRepo'
import type { OutFoto } from '@/core/db/entities'
import { cn } from '@/lib/cn'
import { contar, plural } from '@/lib/texto'

/**
 * Lista de fotos que ainda não foram enviadas. As enviadas ficam no InfraWork Web (Acompanhamento › Fotos); aqui
 * aparece só o contador delas. Cada cartão traz a situação do envio, os dados da foto e as ações de tentar de
 * novo e excluir.
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
      <header className="sticky top-0 z-10 border-b border-border bg-bg-base pl-safe pr-safe pt-safe">
        <div className="flex items-center gap-1 px-2 py-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Voltar">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-on-surface">Fotos a enviar</h1>
            <p className="truncate text-xs text-on-surface-dim">
              {obra?.codigo ?? '—'} ·{' '}
              {pending == null
                ? 'Carregando…'
                : pending.length === 0
                  ? 'Tudo enviado'
                  : `${pending.length} a enviar`}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh} aria-label="Enviar agora">
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
              <p className="mt-6 flex w-full items-center justify-center gap-1.5 text-center text-xs text-on-surface-dim">
                <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden />
                {contar(syncedCount, 'foto', 'fotos')} já{' '}
                {plural(syncedCount, 'enviada', 'enviadas')} ao InfraWork Web
              </p>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate('/fotos/capture')}
        className="fixed bottom-6 right-4 z-20 inline-flex min-h-[56px] items-center gap-2 rounded-md bg-accent px-5 font-semibold text-accent-fg shadow-flutuante hover:bg-accent-dark active:bg-accent-dark"
      >
        <Camera className="h-6 w-6" aria-hidden />
        Tirar foto
      </button>
    </main>
  )
}

function EmptyState({ syncedCount }: { syncedCount: number }) {
  return (
    <div className="flex min-h-[60svh] items-center justify-center">
      <div className="max-w-xs text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-ok" aria-hidden />
        <p className="mt-4 font-medium text-on-surface">Nenhuma foto a enviar</p>
        <p className="mt-2 text-sm text-on-surface-dim">
          {syncedCount > 0
            ? `${contar(syncedCount, 'foto', 'fotos')} já no InfraWork Web. Toque em "Tirar foto" para registrar a próxima.`
            : 'Toque em "Tirar foto" para registrar a primeira foto da obra.'}
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
  const comErro = foto.syncStatus === 'FAILED' || foto.syncStatus === 'REJEITADA'

  async function handleDelete() {
    if (!confirm('Excluir esta foto que ainda não foi enviada? Não dá para recuperar.')) return
    await deleteFoto(foto.id)
  }

  return (
    // a situação vem no selo (o mesmo das outras listas); com erro, a borda inteira do cartão muda de cor
    <div
      className={cn('card-surface flex items-stretch overflow-hidden', comErro && 'border-bad/60')}
      data-status={foto.syncStatus}
    >
      <div className="min-w-0 flex-1 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeloEnvio status={foto.syncStatus} />
          <span className="text-xs text-on-surface-dim tabular">{time}</span>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-on-surface">
          {foto.servicoNome ?? 'Sem serviço'}
        </p>
        <p className="truncate text-xs text-on-surface-dim">
          {[foto.encarregadoNome, foto.equipeNome].filter(Boolean).join(' · ') || '—'}
        </p>
        <p className="mt-1 text-xs text-on-surface-muted tabular">
          {foto.lat != null && foto.lng != null
            ? `GPS ${foto.lat.toFixed(4)}, ${foto.lng.toFixed(4)}${foto.accuracy ? ` ±${Math.round(foto.accuracy)} m` : ''}`
            : 'Sem GPS'}
        </p>
        {comErro && (
          <div className="mt-2">
            {foto.failureReason && (
              <p className="text-xs text-bad">Motivo: {foto.failureReason}</p>
            )}
            <button
              type="button"
              onClick={() =>
                void db.out_foto
                  .update(foto.id, { syncStatus: 'PENDING', lastSyncAttempt: 0 })
                  .then(() => triggerForegroundSync('retry-foto', { ignoreCooldown: true }))
              }
              className="mt-1.5 inline-flex min-h-touch items-center rounded-md border border-border-strong px-3 text-sm font-semibold text-accent hover:border-accent"
            >
              Tentar de novo
            </button>
          </div>
        )}
      </div>
      {foto.syncStatus !== 'SYNCING' && (
        <button
          type="button"
          onClick={handleDelete}
          className="flex w-12 flex-shrink-0 items-center justify-center border-l border-border text-bad transition-colors hover:bg-bad/10"
          aria-label="Excluir foto"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
