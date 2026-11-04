/**
 * Wrapper sobre Screen Wake Lock API. Mantém a tela acesa durante operações longas
 * (captura de foto, upload). Silencioso em iOS Safari < 16.4 (sem suporte).
 *
 * Sempre chame `release()` no cleanup — wake lock é caro em bateria.
 */

interface WakeLockSentinelLike {
  release(): Promise<void>
}

interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

export async function requestScreenWakeLock(): Promise<WakeLockSentinelLike | null> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
    if (!wl) return null
    return await wl.request('screen')
  } catch {
    return null
  }
}

export async function releaseWakeLock(s: WakeLockSentinelLike | null): Promise<void> {
  if (!s) return
  try {
    await s.release()
  } catch {
    /* já liberado */
  }
}
