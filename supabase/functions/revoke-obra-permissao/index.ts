// POST /functions/v1/revoke-obra-permissao
// Body: { obra_id: string, user_id: string }
// Permissão: God ou Adm da empresa da obra.
//
// Observação sobre cascata de Apoio:
//   Como o acesso do Apoio é derivado por JOIN via engenheiro_id (não há linha
//   em obra_permissoes pro apoio), basta apagar a linha do Engenheiro — todos
//   os Apoios vinculados a ele perdem a obra automaticamente nas próximas RLS.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  // Aceita POST e DELETE — facilita uso via clientes HTTP simples
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return json({ error: 'Use POST ou DELETE' }, 405)
  }

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm'])
  if (roleErr) return roleErr

  let body: { obra_id?: string; user_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const { obra_id, user_id } = body
  if (!obra_id || !user_id) {
    return json({ error: 'obra_id e user_id são obrigatórios' }, 400)
  }

  // Valida escopo do Adm
  if (caller.role === 'adm') {
    const { data: obra } = await admin
      .from('obras')
      .select('empresa_id')
      .eq('id', obra_id)
      .single()
    if (!obra) return json({ error: 'Obra não encontrada' }, 404)
    if (obra.empresa_id !== caller.empresa_id) {
      return json({ error: 'Obra fora da sua empresa' }, 403)
    }
  }

  const { data, error } = await admin
    .from('obra_permissoes')
    .delete()
    .eq('obra_id', obra_id)
    .eq('user_id', user_id)
    .select('id, obra_id, user_id')

  if (error) return json({ error: error.message }, 400)
  if (!data || data.length === 0) {
    return json({ error: 'Permissão não encontrada' }, 404)
  }
  return json({ revoked: data[0] }, 200)
})
