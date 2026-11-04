import { useEffect, useState } from 'react'
import { useOutboxCounts } from '@/core/db/daos'
import { getLastSyncAt, isSyncRunning } from './foregroundSync'
import { isBackendReachable } from '@/core/network/onlineProbe'

/**
 * Hook unificado de estado do sync — fonte única pra todas as UIs (indicador
 * compacto, toasts, badges). Substitui o estado local que estava espalhado em
 * NetworkStatusBanner + home.doSync + fotos.list.handleSync.
 *
 * Combina:
 *  - `online`: navigator.onLine + último resultado de probe ao backend
 *  - `syncing`: lê o singleton runningPromise via `isSyncRunning()` + escuta
 *    eventos `monitor:sync:start|end` pra re-render
 *  - `outboxPending`: count de PENDING/FAILED/SYNCING em produção + fotos
 *  - `lastSyncAt`: epoch ms do último ciclo bem-sucedido (persistido)
 *
 * Re-renderiza só quando algum desses valores muda — sem polling.
 */
export interface SyncStatus {
  online: boolean
  syncing: boolean
  outboxPending: number
  lastSyncAt: number | null
}

export function useSyncStatus(): SyncStatus {
  const counts = useOutboxCounts()
  const outboxPending = counts?.total ?? 0

  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [syncing, setSyncing] = useState<boolean>(() => isSyncRunning())
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => getLastSyncAt())

  // Reage aos eventos do engine de sync
  useEffect(() => {
    const onStart = () => setSyncing(true)
    const onEnd = () => {
      setSyncing(false)
      setLastSyncAt(getLastSyncAt())
    }
    window.addEventListener('monitor:sync:start', onStart)
    window.addEventListener('monitor:sync:end', onEnd)
    return () => {
      window.removeEventListener('monitor:sync:start', onStart)
      window.removeEventListener('monitor:sync:end', onEnd)
    }
  }, [])

  // Reage a online/offline (com probe real — navigator.onLine mente)
  useEffect(() => {
    const onOnline = () => {
      void isBackendReachable().then((ok) => setOnline(ok))
    }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return { online, syncing, outboxPending, lastSyncAt }
}
