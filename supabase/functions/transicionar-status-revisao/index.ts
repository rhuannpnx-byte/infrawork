// POST /functions/v1/transicionar-status-revisao
// Body: { revisao_id: string, novo_status: string }
//
// Matriz de transições:
//   rascunho   → em_revisao  : god/adm/eng com permissão
//   em_revisao → aprovada    : god/adm (não eng)
//   em_revisao → rascunho    : god/adm/eng (rollback)
//   aprovada   → homologada  : god/adm
//   aprovada   → rascunho    : god/adm (rollback)
//   qualquer (exceto homologada) → cancelada : god/adm
//
// Homologada é terminal — não pode voltar.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller, type CallerProfile } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

type Status = 'rascunho' | 'em_revisao' | 'aprovada' | 'homologada' | 'cancelada'

interface Transicao {
  de: Status
  para: Status
  /** Roles permitidos. */
  papeis: ('god' | 'adm' | 'engenheiro')[]
}

const TRANSICOES: Transicao[] = [
  { de: 'rascunho',   para: 'em_revisao', papeis: ['god', 'adm', 'engenheiro'] },
  { de: 'em_revisao', para: 'aprovada',   papeis: ['god', 'adm'] },
  { de: 'em_revisao', para: 'rascunho',   papeis: ['god', 'adm', 'engenheiro'] },
  { de: 'aprovada',   para: 'homologada', papeis: ['god', 'adm'] },
  { de: 'aprovada',   para: 'rascunho',   papeis: ['god', 'adm'] },
  { de: 'rascunho',   para: 'cancelada',  papeis: ['god', 'adm'] },
  { de: 'em_revisao', para: 'cancelada',  papeis: ['god', 'adm'] },
  { de: 'aprovada',   para: 'cancelada',  papeis: ['god', 'adm'] }
]

function transicaoValida(de: Status, para: Status, caller: CallerProfile): boolean {
  const t = TRANSICOES.find((x) => x.de === de && x.para === para)
  if (!t) return false
  return (t.papeis as readonly string[]).includes(caller.role)
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

  let body: { revisao_id?: string; novo_status?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const revisao_id = body.revisao_id?.trim()
  const novo_status = body.novo_status?.trim() as Status | undefined
  if (!revisao_id || !novo_status) {
    return json({ error: 'revisao_id e novo_status são obrigatórios' }, 400)
  }
  if (!['rascunho', 'em_revisao', 'aprovada', 'homologada', 'cancelada'].includes(novo_status)) {
    return json({ error: 'novo_status inválido' }, 400)
  }

  // Busca revisão atual
  const { data: rev } = await admin
    .from('revisao_orcamento')
    .select('id, obra_id, status')
    .eq('id', revisao_id)
    .maybeSingle()
  if (!rev) return json({ error: 'Revisão não encontrada' }, 404)

  // Eng só pode transitar se tem acesso de escrita à obra
  const acc = await assertObraAccess(ctx, rev.obra_id, { write: true })
  if (acc) return acc

  // Valida transição
  const de = rev.status as Status
  if (de === novo_status) return json({ error: 'Nenhuma mudança de status' }, 400)
  if (!transicaoValida(de, novo_status, caller)) {
    return json(
      { error: `Transição ${de} → ${novo_status} não permitida para o papel '${caller.role}'` },
      403
    )
  }

  // Preenche timestamps + autor por tipo de transição
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status: novo_status }
  if (novo_status === 'aprovada') {
    patch.aprovada_em = now
    patch.aprovada_por = caller.id
  } else if (novo_status === 'homologada') {
    patch.homologada_em = now
    patch.homologada_por = caller.id
  } else if (novo_status === 'cancelada') {
    patch.cancelada_em = now
    patch.cancelada_por = caller.id
  } else if (novo_status === 'rascunho') {
    // Rollback: limpa carimbos posteriores
    patch.aprovada_em = null
    patch.aprovada_por = null
    patch.homologada_em = null
    patch.homologada_por = null
    patch.cancelada_em = null
    patch.cancelada_por = null
  }

  const { data, error } = await admin
    .from('revisao_orcamento')
    .update(patch)
    .eq('id', revisao_id)
    .select('id, status, aprovada_em, homologada_em, cancelada_em')
    .single()
  if (error) return json({ error: error.message }, 400)
  return json(data, 200)
})
