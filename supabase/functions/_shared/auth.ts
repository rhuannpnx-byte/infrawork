// Helpers compartilhados pelas Edge Functions:
//   - clients (caller + admin)
//   - resolveCaller() devolve o profile do JWT do request
//   - assertRole() valida o papel mínimo / a empresa do chamador

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { json } from './cors.ts'

export type Role = 'god' | 'adm' | 'engenheiro' | 'apoio'

export interface CallerProfile {
  id: string
  email: string
  nome: string
  role: Role
  empresa_id: string | null
  engenheiro_id: string | null
  ativo: boolean
}

export interface CallerContext {
  jwt: string
  caller: CallerProfile
  /** Client autenticado como o caller (respeita RLS). */
  authed: SupabaseClient
  /** Client com service_role — bypass de RLS. Use só pra operações privilegiadas. */
  admin: SupabaseClient
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltam variáveis de ambiente do Supabase nas Edge Functions.')
}

export async function resolveCaller(req: Request): Promise<CallerContext | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Não autenticado' }, 401)
  }
  const jwt = authHeader.slice('Bearer '.length)

  const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { data: userData, error: userErr } = await authed.auth.getUser()
  if (userErr || !userData.user) {
    return json({ error: 'JWT inválido' }, 401)
  }

  // Buscamos via admin pra não depender da RLS ainda — o profile pode estar
  // em transição de criação.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, email, nome, role, empresa_id, engenheiro_id, ativo')
    .eq('id', userData.user.id)
    .single()

  if (profileErr || !profile) {
    return json({ error: 'Profile não encontrado para o JWT' }, 403)
  }
  if (!profile.ativo) {
    return json({ error: 'Usuário inativo' }, 403)
  }

  return { jwt, caller: profile as CallerProfile, authed, admin }
}

export function assertRole(caller: CallerProfile, allowed: Role[]): Response | null {
  if (!allowed.includes(caller.role)) {
    return json({ error: `Papel não autorizado: ${caller.role}` }, 403)
  }
  return null
}

/** Garante que o caller (Adm/Eng/Apoio) está atuando dentro da própria empresa. */
export function assertSameEmpresa(
  caller: CallerProfile,
  empresaId: string | null
): Response | null {
  if (caller.role === 'god') return null
  if (!caller.empresa_id || caller.empresa_id !== empresaId) {
    return json({ error: 'Operação fora da sua empresa' }, 403)
  }
  return null
}
