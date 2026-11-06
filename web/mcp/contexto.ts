/**
 * Contexto de cada chamada do MCP: o cliente Supabase com o JWT do próprio usuário (o RLS vale como no web), o
 * perfil e um helper para as Edge Functions. Fica num AsyncLocalStorage para os módulos do web, que importam o
 * singleton `@/lib/supabase/client`, usarem o cliente da chamada (ver supabase-proxy.ts).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Papel = 'god' | 'adm' | 'engenheiro' | 'apoio' | 'cliente' | 'apontador'

export interface Perfil {
  id: string
  email: string
  nome: string
  role: Papel
  empresa_id: string | null
  ativo: boolean
}

export interface Ctx {
  url: string
  anon: string
  jwt: string
  sb: SupabaseClient
  perfil: Perfil
}

const als = new AsyncLocalStorage<Ctx>()

export function ctxAtual(): Ctx {
  const c = als.getStore()
  if (!c) throw new Error('Sem contexto de usuário (chamada fora de uma ferramenta do MCP).')
  return c
}

export const comCtx = <T>(c: Ctx, f: () => Promise<T>): Promise<T> => als.run(c, f)

export function clienteDoUsuario(url: string, anon: string, jwt: string): SupabaseClient {
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}

/** Monta o contexto a partir de um JWT do Supabase (sessão de senha, OAuth ou token pessoal trocado). */
export async function criarCtx(url: string, anon: string, jwt: string): Promise<Ctx> {
  const sb = clienteDoUsuario(url, anon, jwt)
  const { data: u, error: eu } = await sb.auth.getUser(jwt)
  if (eu || !u.user) throw new Error('Sessão inválida ou expirada.')
  const { data: p, error } = await sb
    .from('profiles')
    .select('id, email, nome, role, empresa_id, ativo')
    .eq('id', u.user.id)
    .single()
  if (error || !p) throw new Error('Perfil do usuário não encontrado.')
  if (!p.ativo) throw new Error('Usuário inativo.')
  return { url, anon, jwt, sb, perfil: p as Perfil }
}

/** Chama uma Edge Function como o usuário. */
export async function fn<T = unknown>(nome: string, body?: object): Promise<T> {
  const c = ctxAtual()
  const r = await fetch(`${c.url}/functions/v1/${nome}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.jwt}`,
      apikey: c.anon,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  })
  const text = await r.text()
  const j = text ? JSON.parse(text) : null
  if (!r.ok) {
    const msg = j?.error ?? r.statusText
    const det = j?.detalhe && j.detalhe !== msg ? ` (${j.detalhe})` : ''
    throw new Error(`${nome}: ${msg}${det}`)
  }
  return j as T
}

/** RPC como o usuário; erro do banco vira exceção com a mensagem original. */
export async function rpc<T = unknown>(
  nome: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const { data, error } = await ctxAtual().sb.rpc(nome, args)
  if (error) throw new Error(error.message)
  return data as T
}
