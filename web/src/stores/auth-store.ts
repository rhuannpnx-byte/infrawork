import { create } from 'zustand'
import { LINK_AUTH, supabase, SUPABASE_CONFIGURADO } from '@/lib/supabase/client'
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
  /** Entrou por link de redefinição de senha: mostrar "Definir nova senha" antes do app. */
  recuperacaoSenha: boolean
  /** Aviso para a tela de login (ex.: link de redefinição expirado). */
  avisoLogin: string | null

  bootstrap: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshMe: () => Promise<void>
  enviarLinkRecuperacao: (email: string) => Promise<void>
  definirNovaSenha: (senha: string) => Promise<void>
  cancelarRecuperacao: () => Promise<void>
}

function avisoDoLink(codigo: string | null): string | null {
  if (!codigo) return null
  if (codigo === 'otp_expired') return 'O link de redefinição expirou. Solicite um novo.'
  return 'O link de acesso é inválido ou já foi usado. Solicite um novo.'
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
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(() => {
    void supabase.rpc('registrar_presenca').then(
      () => {},
      () => {} // best-effort — nunca quebra a sessão
    )
  }, HEARTBEAT_MS)
}

/** Registra 1 acesso (login OU abertura do app com sessão) e liga o heartbeat. */
async function registrarAcessoEHeartbeat(): Promise<void> {
  try {
    await supabase.rpc('registrar_acesso')
  } catch {
    /* não bloqueia o login se a RPC falhar */
  }
  iniciarHeartbeat()
}

async function fetchMe(): Promise<MePayload | null> {
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

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: 'idle',
  profile: null,
  empresa: null,
  obras: [],
  error: null,
  recuperacaoSenha: false,
  avisoLogin: avisoDoLink(LINK_AUTH.erro),

  async bootstrap() {
    if (get().status !== 'idle') return
    if (!SUPABASE_CONFIGURADO) {
      set({ status: 'guest', profile: null, empresa: null, obras: [] })
      return
    }
    set({ status: 'loading', error: null })
    try {
      if (LINK_AUTH.recuperacao) {
        const tokens = LINK_AUTH.recuperacao
        LINK_AUTH.recuperacao = null
        const { error } = await supabase.auth.setSession(tokens)
        if (error) {
          set({ status: 'guest', avisoLogin: avisoDoLink('invalido') })
          return
        }
        set({ recuperacaoSenha: true })
      }
      const { data } = await supabase.auth.getSession()
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
    // Sem status 'loading' aqui: o AuthGate trocaria a tela de login pelo
    // "Carregando…" e, se o login falhar, a mensagem de erro se perderia.
    set({ error: null, avisoLogin: null })
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

  async enviarLinkRecuperacao(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/'
    })
    if (error) throw error
  },

  async definirNovaSenha(senha) {
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) throw error
    set({ recuperacaoSenha: false })
  },

  async cancelarRecuperacao() {
    set({ recuperacaoSenha: false })
    await useAuthStore.getState().signOut()
  },

  async refreshMe() {
    if (!SUPABASE_CONFIGURADO) return
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

// Mantém a store sincronizada com o Supabase Auth: saída em outra aba e troca de usuário. Renovação do token e volta
// à aba não mudam o perfil; o login e a abertura já carregam o perfil por conta própria.
if (SUPABASE_CONFIGURADO) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      pararHeartbeat()
      useAuthStore.setState({ status: 'guest', profile: null, empresa: null, obras: [] })
      useTabsStore.getState().resetToHome()
    } else if (event === 'SIGNED_IN') {
      const { status, profile } = useAuthStore.getState()
      if (status === 'authenticated' && profile?.id !== session.user.id) {
        void useAuthStore.getState().refreshMe()
      }
    }
  })
}
