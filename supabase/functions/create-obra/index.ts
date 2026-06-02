// POST /functions/v1/create-obra
// Body: { nome, codigo, status?, empresa_id?, unidade_espaco_padrao? }
// Permissão: God (qualquer empresa) ou Adm (na sua empresa).
//
// Apos criar a obra, cria 1 trecho default 'Principal' herdando a unidade
// passada (ou 'km' default). Trecho_id e obrigatorio em planejamento_tarefa
// (FK NOT NULL), entao toda obra precisa de pelo menos 1 trecho de inicio.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'

type Unidade = 'km' | 'm' | 'estaca'

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm'])
  if (roleErr) return roleErr

  let body: {
    nome?: string
    codigo?: string
    status?: string
    empresa_id?: string
    unidade_espaco_padrao?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const nome = body.nome?.trim()
  const codigo = body.codigo?.trim()
  if (!nome || !codigo) return json({ error: 'nome e codigo são obrigatórios' }, 400)

  const unidade: Unidade = (() => {
    const u = body.unidade_espaco_padrao?.trim()
    if (u === 'km' || u === 'm' || u === 'estaca') return u
    return 'km'
  })()

  let empresaId: string
  if (caller.role === 'god') {
    if (!body.empresa_id) return json({ error: 'empresa_id obrigatório para god' }, 400)
    empresaId = body.empresa_id
  } else {
    if (!caller.empresa_id) return json({ error: 'Adm sem empresa_id' }, 500)
    empresaId = caller.empresa_id
  }

  const { data: obra, error } = await admin
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

  // Trecho default 'Principal' — toda obra precisa de >=1 trecho (FK NOT NULL).
  const { error: trechoErr } = await admin
    .from('obra_trecho')
    .insert({
      obra_id: obra.id,
      nome: 'Principal',
      ordem: 0,
      unidade_espaco_padrao: unidade
    })

  if (trechoErr) {
    // Rollback manual: remove a obra criada acima pra nao deixar orfaa.
    await admin.from('obras').delete().eq('id', obra.id)
    return json({ error: `Falha ao criar trecho default: ${trechoErr.message}` }, 500)
  }

  return json(obra, 201)
})
