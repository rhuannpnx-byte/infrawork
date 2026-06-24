// POST /functions/v1/delete-obra
// Body: { obra_id: string }
// Permissão: God (qualquer empresa) ou Adm (na sua empresa).
//
// EXCLUSÃO DEFINITIVA (hard delete). Todas as tabelas que referenciam obras(id)
// têm ON DELETE CASCADE (orçamento, planejamento, acompanhamento, documentação,
// trechos, permissões, etc.), então apagar a obra apaga TODOS os dados dela.
// Operação irreversível — a UI exige digitar o código da obra para confirmar.
//
// Antes do cascade, removemos (best-effort) os arquivos de fotos no Storage, que
// não caem por FK. Falha aqui não impede a exclusão da obra.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, assertSameEmpresa, resolveCaller } from '../_shared/auth.ts'

type Body = { obra_id?: string }

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
  if (!obraId) return json({ error: 'obra_id é obrigatório' }, 400)

  const { data: obra, error: obraErr } = await admin
    .from('obras')
    .select('id, empresa_id, nome, codigo')
    .eq('id', obraId)
    .single()
  if (obraErr || !obra) return json({ error: 'Obra não encontrada' }, 404)

  const empErr = assertSameEmpresa(caller, obra.empresa_id)
  if (empErr) return empErr

  // Best-effort: remove os objetos de fotos do Storage (não caem por cascade).
  try {
    const { data: fotos } = await admin
      .from('acompanhamento_foto')
      .select('storage_bucket, storage_key')
      .eq('obra_id', obraId)
      .not('storage_key', 'is', null)
    const byBucket = new Map<string, string[]>()
    for (const f of fotos ?? []) {
      const bucket = (f as { storage_bucket?: string | null }).storage_bucket
      const key = (f as { storage_key?: string | null }).storage_key
      if (!bucket || !key) continue
      const arr = byBucket.get(bucket) ?? []
      arr.push(key)
      byBucket.set(bucket, arr)
    }
    for (const [bucket, keys] of byBucket) {
      for (let i = 0; i < keys.length; i += 1000) {
        await admin.storage.from(bucket).remove(keys.slice(i, i + 1000))
      }
    }
  } catch {
    /* best-effort — não bloqueia a exclusão da obra */
  }

  const { error } = await admin.from('obras').delete().eq('id', obraId)
  if (error) return json({ error: 'Falha ao excluir a obra', detalhe: error.message }, 400)

  return json({ ok: true, deleted: { id: obraId, nome: obra.nome, codigo: obra.codigo } }, 200)
})
