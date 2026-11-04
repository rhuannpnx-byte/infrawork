import { useEffect } from 'react'
import { pushProducaoOutbox } from './producaoSync'
import { pushFichaOutbox } from './fichaSync'
import { pushFotoOutbox } from './fotoSync'
import { refreshAllCatalogs } from './catalogSync'
import { refreshPainelDaObraAtual } from './painelSync'
import { isBackendReachable } from '@/core/network/onlineProbe'
import { sessionStore } from '@/core/auth/SessionStore'

/**
 * Motor de envio em primeiro plano. Dispara em:
 *  - `online` — voltou a internet
 *  - `visibilitychange` visível — o operador voltou ao app
 *  - `pageshow` com bfcache (iOS Safari)
 *  - `focus`
 *  - heartbeat de 60s com o app visível (iOS não tem Background Sync)
 *
 * Cada ciclo: probe do servidor → envia produção, fichas e fotos → renova os catálogos em segundo plano.
 * Mutex em cada `push*` evita corrida; cooldown de 20s entre ciclos.
 */
const HEARTBEAT_MS = 60_000
const COOLDOWN_MS = 20_000
const LAST_SYNC_KEY = 'campo.lastSyncAt'

let lastRunAt = 0
let runningPromise: Promise<void> | null = null

export function isSyncRunning(): boolean {
  return runningPromise != null
}

export function getLastSyncAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

export interface TriggerOpts {
  /** Pula o cooldown (logo depois de salvar, para o operador ver o envio). */
  ignoreCooldown?: boolean
}

export async function triggerForegroundSync(reason: string, opts: TriggerOpts = {}): Promise<void> {
  const now = Date.now()
  if (runningPromise) return runningPromise
  if (!opts.ignoreCooldown && now - lastRunAt < COOLDOWN_MS) return
  if (!sessionStore.isAuthenticated()) return
  // o servidor recusou a sessão: espera o operador entrar de novo
  if (sessionStore.serverRejectedToken()) return
  if (!(await isBackendReachable())) return
  lastRunAt = now
  window.dispatchEvent(new CustomEvent('monitor:sync:start', { detail: { reason } }))
  runningPromise = doSync(reason).finally(() => {
    runningPromise = null
    try {
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
    } catch {
      /* storage cheio / modo privado */
    }
    window.dispatchEvent(new CustomEvent('monitor:sync:end', { detail: { reason } }))
  })
  return runningPromise
}

async function doSync(reason: string): Promise<void> {
  console.info('[fgSync] ciclo:', reason)
  // produção antes das fotos (a foto de um lançamento liga pelo uuid dele)
  const prod = await pushProducaoOutbox().catch((e) => {
    console.warn('[fgSync] produção falhou:', e)
    return null
  })
  const [fichas, fotos] = await Promise.allSettled([pushFichaOutbox(), pushFotoOutbox()])
  const aceitos = [
    prod?.accepted ? `${prod.accepted} produção` : null,
    fichas.status === 'fulfilled' && fichas.value.accepted
      ? `${fichas.value.accepted} ficha(s)`
      : null,
    fotos.status === 'fulfilled' && fotos.value.accepted ? `${fotos.value.accepted} foto(s)` : null,
  ].filter(Boolean)
  if (aceitos.length) dispatchToast('ok', `${aceitos.join(' + ')} enviado(s) ✓`)
  const recusados =
    (prod?.rejected ?? 0) + (fichas.status === 'fulfilled' ? fichas.value.rejected : 0)
  if (recusados > 0)
    dispatchToast('bad', `${recusados} lançamento(s) recusado(s) — veja o motivo e corrija`)
  const forcar = reason === 'mount' || reason === 'online' || reason.startsWith('manual')
  refreshAllCatalogs({ seMaisAntigoQueMs: forcar ? 0 : 10 * 60_000 }).catch((e) =>
    console.warn('[fgSync] catálogos falharam:', e),
  )
  // visão estratégica (engenheiro/adm/god): retrato da obra atual, no máximo a cada 5 min
  refreshPainelDaObraAtual(forcar).catch((e) => console.warn('[fgSync] painel falhou:', e))
}

function dispatchToast(kind: 'ok' | 'warn' | 'bad' | 'info', message: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('monitor:toast', { detail: { kind, message } }))
}

/** Registra os listeners enquanto autenticado (App.tsx). */
export function useForegroundSyncListeners(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onOnline = () => void triggerForegroundSync('online', { ignoreCooldown: true })
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void triggerForegroundSync('visibility')
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void triggerForegroundSync('bfcache-restore')
    }
    const onFocus = () => void triggerForegroundSync('focus')
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') void triggerForegroundSync('heartbeat')
    }, HEARTBEAT_MS)
    void triggerForegroundSync('mount', { ignoreCooldown: true })
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      clearInterval(heartbeat)
    }
  }, [enabled])
}
