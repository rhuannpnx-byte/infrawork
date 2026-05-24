import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
      storageKey: 'infrawork.auth.v1'
    }
  })
})()

export const SUPABASE_ENABLED = supabase !== null

export function functionsBaseUrl(): string {
  if (!url) return ''
  return `${url}/functions/v1`
}
