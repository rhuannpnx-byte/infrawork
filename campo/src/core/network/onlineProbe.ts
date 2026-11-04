/**
 * Probe de conectividade. `navigator.onLine` mente no iOS Safari (true mesmo sem rota para o servidor), então
 * fazemos uma chamada curta ao health do Auth do Supabase com prazo de 3s.
 *
 * Usado pelo foreground sync para não disparar envios que vão falhar na hora.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/core/supabase'

export async function isBackendReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  if (!SUPABASE_URL) return false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3000)
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
