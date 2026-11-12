/**
 * Substitui `@/lib/supabase/client` no bundle do MCP: o `supabase` exportado aponta, a cada acesso, para o cliente
 * do usuário da chamada em curso. Assim os módulos do web (carga do cronograma, exportações, parsers) rodam sem
 * mudança e com o RLS do usuário. `auth.getSession` devolve a sessão da chamada (usada por lib/supabase/functions).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ctxAtual } from './contexto'

export const supabase = new Proxy({} as SupabaseClient, {
  get(_alvo, prop) {
    const c = ctxAtual()
    if (prop === 'auth') {
      const auth = c.sb.auth
      return new Proxy(auth, {
        get(a, p) {
          if (p === 'getSession')
            return async () => ({
              data: { session: { access_token: c.jwt, user: { id: c.perfil.id } } },
              error: null
            })
          const v = Reflect.get(a, p)
          return typeof v === 'function' ? v.bind(a) : v
        }
      })
    }
    const v = Reflect.get(c.sb, prop)
    return typeof v === 'function' ? v.bind(c.sb) : v
  }
})

export const SUPABASE_CONFIGURADO = true

export const LINK_AUTH = { recuperacao: null, erro: null }

export function functionsBaseUrl(): string {
  return `${ctxAtual().url}/functions/v1`
}
