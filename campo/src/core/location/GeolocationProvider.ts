/**
 * Wrapper de `navigator.geolocation` (PWA):
 *
 *  - `getCurrentPosition()`: one-shot com timeout duplo (alta precisão →
 *    baixa precisão → cache fallback). Mantido por back-compat.
 *  - `watchCurrentPosition(cb)`: subscrição contínua. Emite posições conforme
 *    o sensor entrega — primeira posição em ~1-3s vs 5-10s do one-shot.
 *
 * Última posição conhecida é cacheada em localStorage com TTL de 6h.
 */

export interface FixedPosition {
  lat: number
  lng: number
  accuracy: number // metros
  capturedAt: number // epoch ms
}

export type GeoStatus = 'idle' | 'pending' | 'ok' | 'unavailable' | 'denied'

export interface GeoResult {
  status: GeoStatus
  position?: FixedPosition
  errorMessage?: string
  /** Indica que a posição veio do cache (última conhecida) — GPS atual falhou. */
  stale?: boolean
}

const CACHE_KEY = 'monitor:last-position'
// 6h em vez de 12h: terrenos de obra mudam de posição (frente avança), cache
// muito velho engana o operador. 6h cobre dia de trabalho típico.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

function readCachedPosition(): FixedPosition | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FixedPosition
    if (Date.now() - parsed.capturedAt > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedPosition(p: FixedPosition) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(p))
  } catch {
    /* quota/private mode */
  }
}

function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err != null &&
    'code' in err &&
    (err as GeolocationPositionError).code === 1
  )
}

/**
 * One-shot — usado em fluxos não-câmera (legado).
 *
 * Estratégia: alta precisão 5s → baixa 5s → cache. Reduzido de 10s → 5s
 * porque watchPosition geralmente já populou o cache antes da gente chegar
 * aqui (ex.: refresh de tela).
 */
export async function getCurrentPosition(): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    const cached = readCachedPosition()
    return cached
      ? { status: 'ok', position: cached, stale: true }
      : { status: 'unavailable', errorMessage: 'Geolocation API indisponível' }
  }

  try {
    const p = await getPosition({ enableHighAccuracy: true, timeout: 5_000, maximumAge: 0 })
    writeCachedPosition(p)
    return { status: 'ok', position: p }
  } catch (e1) {
    if (isPermissionDenied(e1)) {
      return { status: 'denied', errorMessage: 'Permissão negada' }
    }
    try {
      const p = await getPosition({ enableHighAccuracy: false, timeout: 5_000, maximumAge: 60_000 })
      writeCachedPosition(p)
      return { status: 'ok', position: p }
    } catch (e2) {
      if (isPermissionDenied(e2)) {
        return { status: 'denied', errorMessage: 'Permissão negada' }
      }
      const cached = readCachedPosition()
      if (cached) return { status: 'ok', position: cached, stale: true }
      return {
        status: 'unavailable',
        errorMessage: e2 instanceof Error ? e2.message : 'Erro de geolocalização',
      }
    }
  }
}

function getPosition(opts: PositionOptions): Promise<FixedPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: pos.timestamp,
        })
      },
      reject,
      opts,
    )
  })
}

/**
 * Subscrição contínua de posição — emite a cada fix novo que o GPS entrega.
 * Usado na tela de captura de fotos pra mostrar acquisition em tempo real e
 * destravar o botão de shutter quando precisão >= threshold.
 *
 * Vantagens vs `getCurrentPosition`:
 *  - 1ª posição chega antes (sensor entrega fixes parciais conforme ganha sats)
 *  - Precisão melhora visivelmente (operador vê o ±Xm caindo)
 *  - Pode pausar (stop()) quando user navega pra outra tela
 *
 * Callback recebe um GeoResult sempre que muda. Se permissão for negada,
 * recebe `{ status: 'denied' }` e o watch é encerrado automaticamente.
 *
 * Retorna função pra parar o watch — chamar no cleanup do useEffect.
 */
export function watchCurrentPosition(cb: (r: GeoResult) => void): () => void {
  // Emite cache imediatamente (se houver) pra UI mostrar "GPS cache" enquanto
  // o watch ainda não emitiu o primeiro fix. Operador vê valor preliminar e
  // sabe que sistema está vivo.
  const cached = readCachedPosition()
  if (cached) cb({ status: 'ok', position: cached, stale: true })
  else cb({ status: 'pending' })

  return startBrowserWatch(cb, cached)
}

function startBrowserWatch(cb: (r: GeoResult) => void, cached: FixedPosition | null): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    cb({ status: 'unavailable', errorMessage: 'Geolocation API indisponível' })
    return () => {}
  }
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p: FixedPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        capturedAt: pos.timestamp,
      }
      writeCachedPosition(p)
      cb({ status: 'ok', position: p })
    },
    (err) => {
      if (isPermissionDenied(err)) {
        cb({ status: 'denied', errorMessage: 'Permissão negada' })
        navigator.geolocation.clearWatch(watchId)
        return
      }
      if (!cached) {
        cb({
          status: 'unavailable',
          errorMessage: err instanceof Error ? err.message : 'Erro de geolocalização',
        })
      }
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 10_000,
    },
  )
  return () => navigator.geolocation.clearWatch(watchId)
}

/**
 * Threshold IDEAL — acuracidade desejada (verde, sem aviso).
 */
export const GPS_ACCURACY_THRESHOLD_METERS = 50

/**
 * Threshold MÁXIMO — limite acima do qual o botão fica bloqueado. Entre ideal
 * e máximo, libera mas mostra aviso (operador decide se vale a foto).
 *
 * Adicionado depois de feedback de campo: 50m é muito conservador em locais
 * com vista de céu obstruída (mata, túnel, sob viaduto, indoor). Operador
 * ficava esperando sem conseguir tirar a foto.
 */
export const GPS_ACCURACY_MAX_METERS = 150

/** Posição "boa o bastante" pra liberar shutter SEM aviso (verde). */
export function isAccurateEnough(position: FixedPosition | null | undefined): boolean {
  if (!position) return false
  return position.accuracy <= GPS_ACCURACY_THRESHOLD_METERS
}

/** Posição utilizável (libera shutter, talvez com aviso amarelo). */
export function isUsablePosition(position: FixedPosition | null | undefined): boolean {
  if (!position) return false
  return position.accuracy <= GPS_ACCURACY_MAX_METERS
}
