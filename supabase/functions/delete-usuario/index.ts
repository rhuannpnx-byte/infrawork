// POST /functions/v1/delete-usuario
// Body: { id: string }
//
// Quem pode: God e Adm.
//   God → exclui qualquer usuário (menos a si mesmo).
//   Adm → exclui usuários da própria empresa; não exclui God; não exclui a si.
//
// Exclusão é DEFINITIVA: apaga o auth.user, e o profile cai por cascata
// (profiles.id → auth.users on delete cascade). As permissões de obra recebidas
// pelo alvo (obra_permissoes.user_id) também caem por cascata.
//
// Dois bloqueios de integridade tratados antes do delete:
//   1. obra_permissoes.concedido_por é ON DELETE RESTRICT → reatribuímos as
//      concessões feitas pelo alvo ao caller (preserva o acesso de terceiros).
//   2. profiles.engenheiro_id é ON DELETE SET NULL, mas apoio exige engenheiro
//      (chk_apoio_has_engenheiro) → se o alvo é engenheiro com apoios vinculados,
//      bloqueamos com mensagem clara (reatribuir/excluir os apoios primeiro).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'

type Body = { id?: string }

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
  if (id === caller.id) return json({ error: 'Você não pode excluir a si mesmo.' }, 400)

  const { data: alvo, error: alvoErr } = await admin
    .from('profiles')
    .select('id, nome, role, empresa_id')
    .eq('id', id)
    .single()
  if (alvoErr || !alvo) return json({ error: 'Usuário não encontrado' }, 404)

  if (caller.role === 'adm') {
    if (alvo.role === 'god') return json({ error: 'Adm não pode excluir God' }, 403)
    if (alvo.empresa_id !== caller.empresa_id) {
      return json({ error: 'Usuário fora da sua empresa' }, 403)
    }
  }

  // (2) engenheiro com apoios → bloqueia
  if (alvo.role === 'engenheiro') {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('engenheiro_id', id)
    if ((count ?? 0) > 0) {
      return json(
        {
          error: `Este engenheiro tem ${count} apoio(s) vinculado(s). Reatribua ou exclua os apoios antes de excluí-lo.`
        },
        409
      )
    }
  }

  // (1) reatribui as concessões feitas pelo alvo ao caller (evita RESTRICT)
  const { error: reErr } = await admin
    .from('obra_permissoes')
    .update({ concedido_por: caller.id })
    .eq('concedido_por', id)
  if (reErr) {
    return json(
      { error: 'Falha ao reatribuir concessões do usuário', detalhe: reErr.message },
      400
    )
  }

  // exclui o auth.user → profile cai por cascata
  const { error: delErr } = await admin.auth.admin.deleteUser(id)
  if (delErr) {
    return json({ error: 'Falha ao excluir usuário', detalhe: delErr.message }, 400)
  }

  return json({ ok: true, deleted: { id, nome: alvo.nome } }, 200)
})
