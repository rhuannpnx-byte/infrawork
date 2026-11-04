/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_USE_SUPABASE?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Prefixo das chaves de localStorage/sessão (default: infrawork). */
  readonly VITE_STORAGE_PREFIX?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
