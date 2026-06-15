// POST /functions/v1/grant-obra-permissao
// Body: { obra_id: string, user_id: string }
// Permissão:
//   - God: qualquer obra
//   - Adm: obra da sua empresa, e user_id deve ser ENGENHEIRO ou CLIENTE da mesma empresa
// Notas:
//   - Engenheiros e Clientes recebem permissão direta. Apoios herdam via engenheiro_id.
//   - Idempotente: se já existe vínculo, retorna 200.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

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

  // Resolve obra e engenheiro alvo
  const { data: obra } = await admin
    .from('obras')
    .select('id, empresa_id')
    .eq('id', obra_id)
    .single()
  if (!obra) return json({ error: 'Obra não encontrada' }, 404)

  const { data: alvo } = await admin
    .from('profiles')
    .select('id, role, empresa_id, ativo')
    .eq('id', user_id)
    .single()
  if (!alvo) return json({ error: 'Usuário não encontrado' }, 404)

  if (alvo.role !== 'engenheiro' && alvo.role !== 'cliente') {
    return json({ error: 'Permissões diretas só para Engenheiro ou Cliente (Apoio herda)' }, 400)
  }
  if (!alvo.ativo) return json({ error: 'Usuário inativo' }, 400)
  if (alvo.empresa_id !== obra.empresa_id) {
    return json({ error: 'Usuário e obra de empresas diferentes' }, 400)
  }

  // Adm precisa ser da mesma empresa da obra
  if (caller.role === 'adm' && caller.empresa_id !== obra.empresa_id) {
    return json({ error: 'Obra fora da sua empresa' }, 403)
  }

  const { data, error } = await admin
    .from('obra_permissoes')
    .upsert(
      { obra_id, user_id, concedido_por: caller.id },
      { onConflict: 'obra_id,user_id', ignoreDuplicates: false }
    )
    .select('id, obra_id, user_id, concedido_por, created_at')
    .single()

  if (error) return json({ error: error.message }, 400)
  return json(data, 201)
})
