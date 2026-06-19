// POST /functions/v1/update-usuario
// Body: {
//   id: string                 (profile a editar — obrigatório)
//   nome?: string
//   whatsapp?: string | null   (dígitos; '' / null limpa)
//   role?: 'god'|'adm'|'engenheiro'|'apoio'|'cliente'
//   empresa_id?: string | null (só God; ignorado p/ Adm — fica na própria empresa)
//   engenheiro_id?: string | null (obrigatório quando role final = 'apoio')
//   ativo?: boolean
// }
//
// Quem pode: God e Adm.
//   God → edita qualquer usuário, qualquer campo.
//   Adm → edita usuários da própria empresa; não mexe em God; não promove a God;
//         empresa fica travada na própria.
//
// Mantém as invariantes do schema (chk_god_no_empresa, chk_apoio_has_engenheiro):
// recalcula empresa_id/engenheiro_id de forma coerente com o role final.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller, type Role } from '../_shared/auth.ts'

type Body = {
  id?: string
  nome?: string
  whatsapp?: string | null
  role?: Role
  empresa_id?: string | null
  engenheiro_id?: string | null
  ativo?: boolean
}

/** Mantém só dígitos; string vazia vira null. */
function normWhatsapp(v: string | null | undefined): string | null {
  if (v == null) return null
  const d = v.replace(/\D/g, '')
  return d.length === 0 ? null : d
}

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

  const id = body.id?.trim()
  if (!id) return json({ error: 'id é obrigatório' }, 400)

  // ── alvo ───────────────────────────────────────────────────────────────
  const { data: alvo, error: alvoErr } = await admin
    .from('profiles')
    .select('id, email, nome, role, empresa_id, engenheiro_id, ativo, whatsapp')
    .eq('id', id)
    .single()
  if (alvoErr || !alvo) return json({ error: 'Usuário não encontrado' }, 404)

  // ── escopo do Adm ────────────────────────────────────────────────────────
  if (caller.role === 'adm') {
    if (alvo.role === 'god') return json({ error: 'Adm não pode editar God' }, 403)
    if (alvo.empresa_id !== caller.empresa_id) {
      return json({ error: 'Usuário fora da sua empresa' }, 403)
    }
  }

  // ── role final ─────────────────────────────────────────────────────────
  const role: Role = body.role ?? (alvo.role as Role)
  if (!['god', 'adm', 'engenheiro', 'apoio', 'cliente'].includes(role)) {
    return json({ error: 'role inválido' }, 400)
  }
  if (caller.role === 'adm' && role === 'god') {
    return json({ error: 'Adm não pode promover a God' }, 403)
  }

  // ── empresa final ────────────────────────────────────────────────────────
  let empresaId: string | null
  if (role === 'god') {
    empresaId = null
  } else if (caller.role === 'adm') {
    empresaId = caller.empresa_id // travado na empresa do Adm
  } else {
    // God: usa o que veio no body, senão mantém a empresa atual
    empresaId = body.empresa_id !== undefined ? body.empresa_id : alvo.empresa_id
    if (!empresaId) return json({ error: 'empresa_id obrigatório para papel ≠ god' }, 400)
  }

  // ── engenheiro final ──────────────────────────────────────────────────────
  let engenheiroId: string | null = null
  if (role === 'apoio') {
    engenheiroId =
      body.engenheiro_id !== undefined ? body.engenheiro_id : alvo.engenheiro_id
    if (!engenheiroId) return json({ error: 'Apoio precisa de engenheiro_id' }, 400)
    // engenheiro_id precisa ser engenheiro ATIVO da mesma empresa
    const { data: eng } = await admin
      .from('profiles')
      .select('id, role, empresa_id, ativo')
      .eq('id', engenheiroId)
      .single()
    if (!eng || eng.role !== 'engenheiro' || eng.empresa_id !== empresaId || !eng.ativo) {
      return json({ error: 'engenheiro_id inválido para a empresa' }, 400)
    }
  }

  // ── monta o patch ─────────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {
    role,
    empresa_id: empresaId,
    engenheiro_id: engenheiroId
  }
  if (body.nome !== undefined) {
    const nome = body.nome.trim()
    if (nome.length < 2) return json({ error: 'Nome muito curto' }, 400)
    patch.nome = nome
  }
  if (body.whatsapp !== undefined) {
    patch.whatsapp = normWhatsapp(body.whatsapp)
  }
  if (body.ativo !== undefined) {
    patch.ativo = !!body.ativo
  }

  const { data: atualizado, error: updErr } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', id)
    .select(
      'id, email, nome, role, empresa_id, engenheiro_id, ativo, whatsapp, created_at'
    )
    .single()

  if (updErr) return json({ error: 'Falha ao atualizar', detalhe: updErr.message }, 400)

  // Mantém o nome em sincronia no Auth (user_metadata) quando mudou.
  if (patch.nome) {
    await admin.auth.admin
      .updateUserById(id, { user_metadata: { nome: patch.nome } })
      .catch(() => undefined)
  }

  return json(atualizado, 200)
})
