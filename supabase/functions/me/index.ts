// GET /functions/v1/me
// Retorna o profile do JWT + a lista de obras acessíveis (resolvendo herança
// do Apoio via engenheiro_id).
//
// Resposta:
// {
//   profile: { id, email, nome, role, empresa_id, engenheiro_id, ativo },
//   empresa: { id, nome } | null,
//   obras: Array<{ id, nome, codigo, status, empresa_id }>
// }

import { handlePreflight, json } from '../_shared/cors.ts'
import { resolveCaller } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'Use GET' }, 405)
  }

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx

  // Empresa do caller (god → null)
  let empresa: { id: string; nome: string } | null = null
  if (caller.empresa_id) {
    const { data } = await admin
      .from('empresas')
      .select('id, nome')
      .eq('id', caller.empresa_id)
      .single()
    empresa = data ?? null
  }

  // Obras visíveis ao caller (resolve cada papel via service_role pra evitar
  // confiar 100% na RLS — defesa em profundidade).
  let obras: Array<{ id: string; nome: string; codigo: string; status: string; empresa_id: string }> = []
  if (caller.role === 'god') {
    const { data } = await admin
      .from('obras')
      .select('id, nome, codigo, status, empresa_id')
      .order('created_at', { ascending: false })
    obras = data ?? []
  } else if (caller.role === 'adm') {
    const { data } = await admin
      .from('obras')
      .select('id, nome, codigo, status, empresa_id')
      .eq('empresa_id', caller.empresa_id!)
      .order('created_at', { ascending: false })
    obras = data ?? []
  } else if (caller.role === 'engenheiro') {
    const { data } = await admin
      .from('obra_permissoes')
      .select('obras:obra_id ( id, nome, codigo, status, empresa_id )')
      .eq('user_id', caller.id)
    obras = (data ?? [])
      .map((r) => (r as unknown as { obras: typeof obras[number] | null }).obras)
      .filter((o): o is typeof obras[number] => !!o)
  } else if (caller.role === 'apoio') {
    if (!caller.engenheiro_id) {
      obras = []
    } else {
      const { data } = await admin
        .from('obra_permissoes')
        .select('obras:obra_id ( id, nome, codigo, status, empresa_id )')
        .eq('user_id', caller.engenheiro_id)
      obras = (data ?? [])
        .map((r) => (r as unknown as { obras: typeof obras[number] | null }).obras)
        .filter((o): o is typeof obras[number] => !!o)
    }
  }

  return json({
    profile: caller,
    empresa,
    obras
  })
})
