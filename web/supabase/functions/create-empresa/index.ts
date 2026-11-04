// POST /functions/v1/create-empresa
// Body: { nome: string; cnpj?: string }
// Permissão: apenas God.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god'])
  if (roleErr) return roleErr

  let body: { nome?: string; cnpj?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const nome = body.nome?.trim()
  if (!nome) return json({ error: 'nome obrigatório' }, 400)
  const cnpj = body.cnpj?.trim() || null

  const { data, error } = await ctx.admin
    .from('empresas')
    .insert({ nome, cnpj })
    .select('id, nome, cnpj, ativo, created_at')
    .single()

  if (error) return json({ error: error.message }, 400)
  return json(data, 201)
})
