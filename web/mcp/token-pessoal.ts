/**
 * Token pessoal (gerado no web, Perfil › Tokens de IA) → sessão do dono do token. O token nunca é guardado: só o
 * SHA-256 em `mcp_token`. A sessão é criada sem senha (link mágico gerado e verificado no servidor) e fica em cache
 * até perto de expirar. Precisa da service key no servidor (variável SUPABASE_SERVICE_ROLE_KEY, nunca no front).
 */
import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const PREFIXO_TOKEN = 'iwk_'

export interface Sessao {
  access_token: string
  refresh_token: string
  expira: number
}

const cache = new Map<string, Sessao>()

export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex')

function admin(url: string): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Token pessoal indisponível neste servidor (falta a service key).')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function sessaoDoToken(url: string, anon: string, token: string): Promise<Sessao> {
  const h = hashToken(token)
  const em = cache.get(h)
  const agora = Date.now() / 1000
  const adm = admin(url)
  const { data: t, error } = await adm
    .from('mcp_token')
    .select('id, user_id, expira_em, revogado_em')
    .eq('hash', h)
    .maybeSingle()
  if (error) throw new Error(`Falha ao validar o token: ${error.message}`)
  if (!t || t.revogado_em) throw new Error('Token inválido ou revogado.')
  if (t.expira_em && new Date(t.expira_em).getTime() < Date.now())
    throw new Error('Token expirado.')
  void adm
    .from('mcp_token')
    .update({ ultimo_uso_em: new Date().toISOString() })
    .eq('id', t.id)
    .then()

  if (em && em.expira - 60 > agora) return em
  const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  if (em) {
    const { data } = await pub.auth.refreshSession({ refresh_token: em.refresh_token })
    if (data.session) {
      const s = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expira: data.session.expires_at ?? agora + 3600
      }
      cache.set(h, s)
      return s
    }
  }
  const { data: u, error: eu } = await adm.auth.admin.getUserById(t.user_id)
  if (eu || !u.user?.email) throw new Error('Dono do token não encontrado.')
  const { data: link, error: el } = await adm.auth.admin.generateLink({
    type: 'magiclink',
    email: u.user.email
  })
  if (el || !link.properties?.hashed_token)
    throw new Error('Não foi possível abrir a sessão do token.')
  const { data: v, error: ev } = await pub.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token
  })
  if (ev || !v.session)
    throw new Error(`Não foi possível abrir a sessão do token: ${ev?.message ?? ''}`)
  const s = {
    access_token: v.session.access_token,
    refresh_token: v.session.refresh_token,
    expira: v.session.expires_at ?? agora + 3600
  }
  cache.set(h, s)
  return s
}
