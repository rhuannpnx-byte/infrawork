import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Estado de sessão persistido em **localStorage**.
 *
 * PWA é sandboxed por origin — XSS é a única superfície de ataque relevante; cripto extra
 * sem chave externa é segurança teatral. Mitigação real fica em CSP estrita + logout limpa tudo
 * (Dexie + caches).
 *
 * Identidade do InfraWork Web (Supabase Auth): o access token vence em 1h, mas o refresh token renova a sessão
 * sozinho quando há rede — o relógio aqui só decide quando pedir novo login.
 *
 * OFFLINE-FIRST (2026-09-21): "ter sessão" e "token válido" são coisas
 * diferentes. A sessão (identidade + obra escolhida) vale até o operador
 * sair; o token (JWT 12h) só importa para falar com o servidor. Antes, token
 * vencido = tela de login, e login exige rede — o operador que abria o app no
 * campo, sem sinal, no dia seguinte ficava trancado fora dos catálogos e dos
 * rascunhos. Agora ele continua lançando (outbox) e entra de novo quando tiver
 * rede (ReauthBanner).
 */
export interface Session {
  /** access token do Supabase (renovado sozinho pelo cliente; espelhado aqui para o relógio da sessão) */
  token: string
  expiresAtEpochMs: number
  userId: string
  userNome: string
  userEmail: string
  role: string
  empresaId: string | null
  /** Obra selecionada no Home (alvo de Produção, Viagens e Fotos). */
  obraAtualId: string | null
}

const STORAGE_KEY = 'infrawork_campo_session'

// Snapshot cacheado — exigência do `useSyncExternalStore`: `getSnapshot` precisa devolver
// a MESMA referência se o valor não mudou (compara por `Object.is`). Sem cache, cada
// chamada de `read()` faria `JSON.parse` e retornaria objeto novo → loop infinito.
let cached: Session | null = readFromStorage()
let cachedValid = true

function readFromStorage(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    // Schema mínimo — não usamos zod aqui pra evitar import no boot crítico.
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAtEpochMs !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function read(): Session | null {
  if (!cachedValid) {
    cached = readFromStorage()
    cachedValid = true
  }
  return cached
}

function invalidateCache() {
  cachedValid = false
}

function write(s: Session | null) {
  if (s == null) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  // Atualiza cache imediatamente para evitar segundo JSON.parse
  cached = s
  cachedValid = true
  notifyAll()
}

// =============================================================================
//  Observable (subscribe pattern para useSyncExternalStore)
// =============================================================================
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // Também escuta mudanças vindas de outras abas — outra tab mudou localStorage,
  // nosso cache ficou stale.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      invalidateCache()
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function notifyAll() {
  listeners.forEach((l) => l())
}

// =============================================================================
//  API pública
// =============================================================================
export const sessionStore = {
  /** Lê snapshot atual (síncrono — usado no Splash). */
  current(): Session | null {
    return read()
  },

  /** Há sessão local (identidade). NÃO depende do token — ver cabeçalho do arquivo. */
  isAuthenticated(): boolean {
    return read() != null
  },

  /** Token ainda dentro da validade, pelo relógio do aparelho. */
  isTokenValid(): boolean {
    const s = read()
    return s != null && s.expiresAtEpochMs > Date.now()
  },

  /**
   * O servidor respondeu 401: o token morreu. Mantém identidade, projeto e
   * todos os dados locais; só marca que é preciso entrar de novo.
   */
  markTokenExpired() {
    const c = read()
    if (c && c.expiresAtEpochMs !== 0) write({ ...c, expiresAtEpochMs: 0 })
  },

  /** True só quando o SERVIDOR recusou o token (imune a relógio errado do aparelho). */
  serverRejectedToken(): boolean {
    return read()?.expiresAtEpochMs === 0
  },

  /** Salva nova sessão (login). */
  save(session: Session) {
    write(session)
  },

  /** Patch parcial (ex.: trocar projeto/obra atual). */
  patch(partial: Partial<Session>) {
    const current = read()
    if (!current) return
    write({ ...current, ...partial })
  },

  /** Limpa tudo (logout). Caller é responsável por também limpar Dexie + caches. */
  clear() {
    write(null)
  },

  /** O Supabase renovou o token: atualiza o relógio da sessão. */
  tokenRenovado(token: string, expiresAtEpochMs: number) {
    const c = read()
    if (c) write({ ...c, token, expiresAtEpochMs })
  },

  /** Subscribe externo (raramente usado fora do hook). */
  subscribe,
}

// =============================================================================
//  React hook (useSyncExternalStore — evita derived state bugs)
// =============================================================================
export function useSession(): Session | null {
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.current,
    () => null, // SSR fallback — não rodamos SSR mas exigido pela API
  )
}

/** Há sessão local — libera o app inteiro, online ou offline. */
export function useIsAuthenticated(): boolean {
  return useSession() != null
}

/** Token dentro da validade. Re-avalia a cada minuto para pegar o vencimento com o app aberto. */
export function useTokenValid(): boolean {
  const s = useSession()
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  return s != null && s.expiresAtEpochMs > Date.now()
}
