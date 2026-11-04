import { supabase } from '@/core/supabase'
import { sessionStore } from './SessionStore'

/**
 * O cliente do Supabase renova o access token sozinho (refresh token) quando há rede. Espelhamos a renovação no
 * relógio da sessão local; se a renovação for recusada (refresh token revogado), a sessão local continua — os
 * lançamentos ficam na fila — e o ReauthBanner pede novo login.
 */
export function ligarRenovacaoDeToken(): () => void {
  const { data } = supabase.auth.onAuthStateChange((evento, s) => {
    if (!sessionStore.isAuthenticated()) return
    if (s && (evento === 'TOKEN_REFRESHED' || evento === 'SIGNED_IN')) {
      sessionStore.tokenRenovado(s.access_token, (s.expires_at ?? 0) * 1000)
    } else if (evento === 'SIGNED_OUT') {
      sessionStore.markTokenExpired()
    }
  })
  return () => data.subscription.unsubscribe()
}
