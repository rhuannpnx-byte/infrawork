import { create } from 'zustand'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useTabsStore } from '@/stores/tabs-store'
import type { AuthEmpresa, AuthObra, AuthProfile, MePayload, Role } from '@/types/auth'

/**
 * Remove abas persistidas de módulos que o novo papel não pode acessar.
 * Segurança: abas de uma sessão god/adm não podem sobreviver ao login de um
 * cliente (que só acessa Acompanhamento).
 */
function sanitizarAbasParaPapel(role: Role | null): void {
  useTabsStore.getState().sanitizeForRole(role)
}

interface AuthStore {
  status: 'idle' | 'loading' | 'authenticated' | 'guest'
  profile: AuthProfile | null
  empresa: AuthEmpresa | null
  obras: AuthObra[]
  error: string | null

  bootstrap: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshMe: () => Promise<void>
}

// ─── Presença / acessos ────────────────────────────────────────────────────
// Heartbeat enquanto o app está aberto + registro de 1 acesso por boot/login.
// "Online agora" no painel de usuários = last_seen_at nos últimos ~2,5 min.

const HEARTBEAT_MS = 60_000
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function pararHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function iniciarHeartbeat(): void {
  if (!supabase || heartbeatTimer) return
  heartbeatTimer = setInterval(() => {
    void supabase!.rpc('registrar_presenca').then(
      () => {},
      () => {} // best-effort — nunca quebra a sessão
    )
  }, HEARTBEAT_MS)
}

/** Registra 1 acesso (login OU abertura do app com sessão) e liga o heartbeat. */
async function registrarAcessoEHeartbeat(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.rpc('registrar_acesso')
  } catch {
    /* não bloqueia o login se a RPC falhar */
  }
  iniciarHeartbeat()
}

async function fetchMe(): Promise<MePayload | null> {
  if (!supabase) return null
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) return null

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/me`
  const r = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!r.ok) {
    throw new Error(`/me retornou ${r.status}`)
  }
  return (await r.json()) as MePayload
}

export const useAuthStore = create<AuthStore>((set) => ({
  status: 'idle',
  profile: null,
  empresa: null,
  obras: [],
  error: null,

  async bootstrap() {
    if (!SUPABASE_ENABLED) {
      // Modo mock: cria uma sessão sintética como God (apenas DEV).
      set({
        status: 'authenticated',
        profile: {
          id: 'mock-god',
          email: 'rhuann.nunes@tecpav.com.br',
          nome: 'God Administrador (mock)',
          role: 'god',
          empresa_id: null,
          engenheiro_id: null,
          ativo: true
        },
        empresa: null,
        obras: []
      })
      sanitizarAbasParaPapel('god')
      return
    }
    set({ status: 'loading', error: null })
    try {
      const { data } = await supabase!.auth.getSession()
      if (!data.session) {
        set({ status: 'guest', profile: null, empresa: null, obras: [] })
        return
      }
      const me = await fetchMe()
      if (!me) {
        set({ status: 'guest' })
        return
      }
      set({
        status: 'authenticated',
        profile: me.profile,
        empresa: me.empresa,
        obras: me.obras,
        error: null
      })
      sanitizarAbasParaPapel(me.profile.role)
      void registrarAcessoEHeartbeat()
    } catch (e) {
      set({ status: 'guest', error: e instanceof Error ? e.message : String(e) })
    }
  },

  async signInWithPassword(email, password) {
    if (!SUPABASE_ENABLED || !supabase) {
      throw new Error('Supabase desativado neste ambiente.')
    }
    set({ status: 'loading', error: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ status: 'guest', error: error.message })
      throw error
    }
    // Carrega o perfil diretamente (em vez de refreshMe, que engole erros): assim uma
    // falha pós-login no /me vira erro visível na tela de login.
    try {
      const me = await fetchMe()
      if (!me) {
        set({ status: 'guest', profile: null, empresa: null, obras: [] })
        throw new Error('/me retornou vazio')
      }
      set({
        status: 'authenticated',
        profile: me.profile,
        empresa: me.empresa,
        obras: me.obras,
        error: null
      })
      sanitizarAbasParaPapel(me.profile.role)
      void registrarAcessoEHeartbeat()
    } catch (e) {
      set({ status: 'guest', error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  },

  async signOut() {
    pararHeartbeat()
    if (supabase) {
      await supabase.auth.signOut()
    }
    set({ status: 'guest', profile: null, empresa: null, obras: [] })
    // Não deixa abas (e seus módulos) sobreviverem ao logout.
    useTabsStore.getState().resetToHome()
  },

  async refreshMe() {
    if (!SUPABASE_ENABLED) return
    try {
      const me = await fetchMe()
      if (!me) {
        set({ status: 'guest', profile: null, empresa: null, obras: [] })
        return
      }
      set({
        status: 'authenticated',
        profile: me.profile,
        empresa: me.empresa,
        obras: me.obras,
        error: null
      })
      sanitizarAbasParaPapel(me.profile.role)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  }
}))

// Mantém a store sincronizada com mudanças do Supabase Auth (refresh de token, signOut em outra aba, etc.)
if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      pararHeartbeat()
      useAuthStore.setState({ status: 'guest', profile: null, empresa: null, obras: [] })
      useTabsStore.getState().resetToHome()
    } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
      void useAuthStore.getState().refreshMe()
    }
  })
}
