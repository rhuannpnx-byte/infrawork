// POST /functions/v1/recalcular-orcamento
// Body: { obra_id: string }
// Permissão: God/Adm/Engenheiro com acesso à obra (write).
//
// Roda a função PL/pgSQL `recalcular_orcamento(_obra_id)` que faz rollup
// ascendente da árvore Plan_Orc com lock advisory por obra. Idempotente.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: { obra_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const { data, error } = await admin.rpc('recalcular_orcamento', { _obra_id: obra_id })
  if (error) return json({ error: error.message }, 400)

  return json(data ?? { ok: true }, 200)
})
