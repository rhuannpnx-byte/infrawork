// Identidade e escopo de permissão do Oráculo — FONTE ÚNICA DE SEGURANÇA.
//
// O agente usa service_role (bypassa RLS), então a regra de acesso a obras
// precisa ser reimplementada aqui, espelhando EXATAMENTE as policies de `obras`:
//   god        → todas as obras
//   adm        → obras da própria empresa
//   engenheiro → SOMENTE obras concedidas em obra_permissoes (user_id = ele)
//   cliente    → idem engenheiro
//   apoio      → obras concedidas ao seu engenheiro_id
//
// O remetente da DM é identificado pelo número (profiles.whatsapp). Só responde
// a usuários ATIVOS e com habilitação ativa em whatsapp_oraculo_acesso.

import { supabase } from '../supabase.js'
import { logger } from '../logger.js'

export type Role = 'god' | 'adm' | 'engenheiro' | 'apoio' | 'cliente'

export interface Profile {
  id: string
  nome: string
  role: Role
  empresa_id: string | null
  engenheiro_id: string | null
  ativo: boolean
  whatsapp: string | null
}

export interface ObraRef {
  id: string
  codigo: string
  nome: string
  empresa_id: string
}

function soDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

/** Normaliza número BR removendo o 9 extra de celular (55 + DDD + 9 + 8 díg = 13
 *  → 12). Permite casar JIDs que ora trazem, ora omitem o nono dígito. */
function normalizarBR(n: string): string {
  if (n.length === 13 && n.startsWith('55') && n[4] === '9') {
    return n.slice(0, 4) + n.slice(5)
  }
  return n
}

/** true se dois números representam o mesmo telefone (tolerante ao 9º dígito BR). */
export function mesmoNumero(a: string, b: string): boolean {
  const da = soDigitos(a)
  const db = soDigitos(b)
  if (!da || !db) return false
  if (da === db) return true
  return normalizarBR(da) === normalizarBR(db)
}

/** Identifica o remetente de uma DM: casa o número do JID com profiles.whatsapp
 *  de um usuário ATIVO e com habilitação ATIVA no Oráculo. Null = ignorar. */
export async function identificarRemetente(jid: string): Promise<Profile | null> {
  // O número fica antes do '@'; para JID telefônico vem o telefone.
  const numero = soDigitos(jid.split('@')[0])
  if (!numero) return null

  // 2 queries simples (sem embed do PostgREST, mais robusto): acessos ativos →
  // profiles → casa o telefone em JS (tolerante ao 9º dígito BR).
  const { data: acessos } = await supabase
    .from('whatsapp_oraculo_acesso')
    .select('user_id')
    .eq('ativo', true)
  const ids = (acessos ?? []).map((a) => (a as { user_id: string }).user_id)
  if (ids.length === 0) {
    logger.info({ jid }, 'oráculo: nenhum usuário habilitado')
    return null
  }

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, nome, role, empresa_id, engenheiro_id, ativo, whatsapp')
    .in('id', ids)
    .eq('ativo', true)

  for (const p of (profs ?? []) as Profile[]) {
    if (p.whatsapp && mesmoNumero(numero, p.whatsapp)) return p
  }
  logger.info(
    { numero, candidatos: (profs ?? []).map((p) => (p as Profile).whatsapp) },
    'oráculo: remetente não casou com nenhum usuário habilitado'
  )
  return null
}

/** Lista as obras a que o profile tem acesso — espelha a RLS de `obras`. */
export async function obrasPermitidas(p: Profile): Promise<ObraRef[]> {
  const sel = 'id, codigo, nome, empresa_id'

  if (p.role === 'god') {
    const { data } = await supabase.from('obras').select(sel).order('codigo')
    return (data ?? []) as ObraRef[]
  }

  if (p.role === 'adm') {
    if (!p.empresa_id) return []
    const { data } = await supabase
      .from('obras')
      .select(sel)
      .eq('empresa_id', p.empresa_id)
      .order('codigo')
    return (data ?? []) as ObraRef[]
  }

  // engenheiro/cliente → permissões do próprio; apoio → do seu engenheiro
  const alvoUserId = p.role === 'apoio' ? p.engenheiro_id : p.id
  if (!alvoUserId) return []

  const { data } = await supabase
    .from('obra_permissoes')
    .select('obra:obra_id(id, codigo, nome, empresa_id)')
    .eq('user_id', alvoUserId)

  const obras = (data ?? [])
    .map((r) => (r as unknown as { obra: ObraRef | null }).obra)
    .filter((o): o is ObraRef => !!o)
  obras.sort((a, b) => a.codigo.localeCompare(b.codigo))
  return obras
}
