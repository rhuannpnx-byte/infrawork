import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { storageKey } from '@/lib/storage-keys'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Cliente Supabase do renderer.
 *
 * Ativação:
 *   - Auto: basta haver VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no env.
 *   - Override explícito: VITE_USE_SUPABASE='false' força o modo mock mesmo
 *     com as chaves presentes (útil pra demos / offline).
 *
 * Quando `null`, o módulo de auth usa um fallback "auto-login como God" para
 * desenvolvimento, e os hooks de dados continuam servindo do mock-adapter.
 */
export const supabase: SupabaseClient | null = (() => {
  if (import.meta.env.VITE_USE_SUPABASE === 'false') return null
  if (!url || !anonKey) return null
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: storageKey('auth.v1')
    }
  })
})()

export const SUPABASE_ENABLED = supabase !== null

/**
 * Link de e-mail do Supabase Auth (fluxo implícito): `#access_token=…&type=recovery`
 * ou `#error_code=otp_expired…`. Lido no carregamento do módulo — antes do
 * url-sync reescrever a URL — e removido da barra de endereço na hora, para os
 * tokens não ficarem expostos no histórico.
 */
export interface LinkAuth {
  recuperacao: { access_token: string; refresh_token: string } | null
  erro: string | null
}
export const LINK_AUTH: LinkAuth = (() => {
  const vazio: LinkAuth = { recuperacao: null, erro: null }
  if (typeof window === 'undefined' || !window.location.hash) return vazio
  const p = new URLSearchParams(window.location.hash.slice(1))
  const access_token = p.get('access_token')
  const refresh_token = p.get('refresh_token')
  const erro = p.get('error_code') ?? p.get('error')
  if (!access_token && !erro) return vazio
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search
  )
  if (erro) return { recuperacao: null, erro }
  if (p.get('type') === 'recovery' && access_token && refresh_token) {
    return { recuperacao: { access_token, refresh_token }, erro: null }
  }
  return vazio
})()

export function functionsBaseUrl(): string {
  if (!url) return ''
  return `${url}/functions/v1`
}
