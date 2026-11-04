import { createClient } from '@supabase/supabase-js'

/**
 * Cliente do Supabase do InfraWork Web — o mesmo banco do sistema web (sem backend intermediário: RLS + RPCs
 * `campo_*`). A sessão (access + refresh token) fica no localStorage e é renovada sozinha quando há rede; offline
 * o app segue lançando na outbox (ver SessionStore).
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[campo] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes — veja .env.example')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'infrawork-campo-auth',
  },
})

/** Bucket privado das fotos (o mesmo do web). Caminho: `<empresa>/<obra>/<producao|avulsa>/<uuid>.jpg`. */
export const BUCKET_FOTOS = 'acompanhamento-fotos'
