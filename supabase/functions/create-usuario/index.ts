// POST /functions/v1/create-usuario
// Body: {
//   email: string
//   nome: string
//   role: 'god' | 'adm' | 'engenheiro' | 'apoio'
//   empresa_id?: string   (obrigatório quando role != 'god'; força a empresa do caller p/ Adm/Eng)
//   engenheiro_id?: string (obrigatório p/ role='apoio'; forçado a auth.uid() p/ Engenheiro)
//   password?: string      (opcional; quando omitido envia invite por email)
// }
//
// Matriz aplicada:
//   God        → cria qualquer papel em qualquer empresa
//   Adm        → cria adm/engenheiro/apoio/cliente na sua empresa
//   Engenheiro → cria apenas apoio vinculado a si (próprio engenheiro_id)
//   Apoio      → negado
//   Cliente    → tem empresa fixa, engenheiro_id sempre null (não-apoio)
//
// Estratégia:
//   1. Validar papel + escopo
//   2. Criar auth.user via service_role (createUser ou inviteUserByEmail)
//   3. Inserir profile via service_role
//   4. Em caso de falha no profile, deletar o auth.user (rollback manual)

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller, type Role } from '../_shared/auth.ts'

type Body = {
  email?: string
  nome?: string
  role?: Role
  empresa_id?: string | null
  engenheiro_id?: string | null
  password?: string
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const email = body.email?.trim().toLowerCase()
  const nome = body.nome?.trim()
  const role = body.role
  if (!email || !nome || !role) {
    return json({ error: 'email, nome e role são obrigatórios' }, 400)
  }
  if (!['god', 'adm', 'engenheiro', 'apoio', 'cliente'].includes(role)) {
    return json({ error: 'role inválido' }, 400)
  }

  let empresaId = body.empresa_id ?? null
  let engenheiroId = body.engenheiro_id ?? null

  // ── valida combinação papel/escopo conforme o caller ─────────────────────
  if (caller.role === 'god') {
    if (role !== 'god' && !empresaId) {
      return json({ error: 'empresa_id obrigatório para papel ≠ god' }, 400)
    }
    if (role === 'god' && empresaId) {
      return json({ error: 'role=god não pode ter empresa_id' }, 400)
    }
    if (role === 'apoio' && !engenheiroId) {
      return json({ error: 'apoio precisa de engenheiro_id' }, 400)
    }
  } else if (caller.role === 'adm') {
    if (!['adm', 'engenheiro', 'apoio', 'cliente'].includes(role)) {
      return json({ error: 'Adm não pode criar god' }, 403)
    }
    // Adm SEMPRE atua na própria empresa — ignora o que veio no body
    empresaId = caller.empresa_id
    if (role === 'apoio' && !engenheiroId) {
      return json({ error: 'apoio precisa de engenheiro_id' }, 400)
    }
    if (engenheiroId) {
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
  } else if (caller.role === 'engenheiro') {
    if (role !== 'apoio') {
      return json({ error: 'Engenheiro só pode criar Apoio' }, 403)
    }
    // Engenheiro SEMPRE cria apoio vinculado a si, na sua empresa
    empresaId = caller.empresa_id
    engenheiroId = caller.id
  } else {
    return json({ error: 'Sem permissão' }, 403)
  }

  // ── cria o auth.user ─────────────────────────────────────────────────────
  let newUserId: string
  // Se a senha veio preenchida no body mas é curta demais, rejeita explicitamente
  // (em vez de virar convite silencioso, que confundia o usuário no front).
  if (body.password !== undefined && body.password !== '') {
    if (body.password.length < 10) {
      return json({ error: 'Senha precisa ter ao menos 10 caracteres.' }, 400)
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { nome }
    })
    if (error || !data.user) {
      return json({ error: error?.message ?? 'Falha ao criar usuário no Auth' }, 400)
    }
    newUserId = data.user.id
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { nome }
    })
    if (error || !data.user) {
      return json({ error: error?.message ?? 'Falha ao convidar usuário' }, 400)
    }
    newUserId = data.user.id
  }

  // ── cria o profile (com rollback do auth.user em caso de falha) ──────────
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .insert({
      id: newUserId,
      email,
      nome,
      role,
      empresa_id: empresaId,
      engenheiro_id: role === 'apoio' ? engenheiroId : null,
      ativo: true
    })
    .select('id, email, nome, role, empresa_id, engenheiro_id, ativo, created_at')
    .single()

  if (profileErr) {
    await admin.auth.admin.deleteUser(newUserId).catch(() => undefined)
    return json({ error: `Profile: ${profileErr.message}` }, 400)
  }

  return json(profile, 201)
})
