/** Projeto padrão (o publicado), injetado no build a partir das variáveis VITE_ do web — chaves públicas. */
declare const __IW_SUPABASE_URL__: string
declare const __IW_SUPABASE_ANON_KEY__: string
declare const __IW_SITE__: string

export const PADRAO = {
  supabaseUrl: __IW_SUPABASE_URL__,
  supabaseAnonKey: __IW_SUPABASE_ANON_KEY__,
  site: __IW_SITE__
}
