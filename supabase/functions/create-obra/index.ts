// POST /functions/v1/create-obra
// Body: { nome, codigo, status?, empresa_id? }
// Permissão: God (qualquer empresa) ou Adm (na sua empresa).

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

  let body: { nome?: string; codigo?: string; status?: string; empresa_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const nome = body.nome?.trim()
  const codigo = body.codigo?.trim()
  if (!nome || !codigo) return json({ error: 'nome e codigo são obrigatórios' }, 400)

  let empresaId: string
  if (caller.role === 'god') {
    if (!body.empresa_id) return json({ error: 'empresa_id obrigatório para god' }, 400)
    empresaId = body.empresa_id
  } else {
    // Adm: força a própria empresa
    if (!caller.empresa_id) return json({ error: 'Adm sem empresa_id' }, 500)
    empresaId = caller.empresa_id
  }

  const { data, error } = await admin
    .from('obras')
    .insert({
      empresa_id: empresaId,
      nome,
      codigo,
      status: body.status?.trim() || 'em_andamento'
    })
    .select('id, empresa_id, nome, codigo, status, created_at')
    .single()

  if (error) return json({ error: error.message }, 400)
  return json(data, 201)
})
