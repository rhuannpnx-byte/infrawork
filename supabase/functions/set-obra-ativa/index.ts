// POST /functions/v1/set-obra-ativa
// Body: { obra_id: string, ativa: boolean }
// Permissão: God (qualquer empresa) ou Adm (na sua empresa).
//
// Desabilitar (ativa=false) faz a obra sumir da seleção no app e do contexto do
// agente WhatsApp (ver /me e whatsapp-agent identidade). Não apaga nada — é
// reversível. Exclusão definitiva é a edge delete-obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, assertSameEmpresa, resolveCaller } from '../_shared/auth.ts'

type Body = { obra_id?: string; ativa?: boolean }

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const obraId = body.obra_id?.trim()
  if (!obraId || typeof body.ativa !== 'boolean') {
    return json({ error: 'obra_id e ativa (boolean) são obrigatórios' }, 400)
  }

  const { data: obra, error: obraErr } = await admin
    .from('obras')
    .select('id, empresa_id, nome, codigo')
    .eq('id', obraId)
    .single()
  if (obraErr || !obra) return json({ error: 'Obra não encontrada' }, 404)

  const empErr = assertSameEmpresa(caller, obra.empresa_id)
  if (empErr) return empErr

  const { error } = await admin.from('obras').update({ ativa: body.ativa }).eq('id', obraId)
  if (error) return json({ error: 'Falha ao atualizar a obra', detalhe: error.message }, 400)

  return json({ ok: true, obra_id: obraId, ativa: body.ativa, codigo: obra.codigo }, 200)
})
