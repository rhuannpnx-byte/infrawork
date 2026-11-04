// POST /functions/v1/acompanhamento-foto-delete
// Body: { foto_ids: string[] }  (até 100 por chamada)
//
// Soft delete (excluida_em/excluida_por) + remoção do arquivo no bucket.
//
// Permissão:
//   - god/adm/engenheiro com acesso de escrita à obra: qualquer foto.
//   - apoio: só fotos que ele mesmo enviou nas últimas 24 h (erro de campo).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

interface Body {
  foto_ids?: string[]
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: Body = {}
  try { body = await req.json() } catch { /* */ }
  const ids = (body.foto_ids ?? []).filter((s) => typeof s === 'string' && s.length > 0)
  if (ids.length === 0) return json({ error: 'foto_ids vazio' }, 400)
  if (ids.length > 100) return json({ error: 'Limite 100 fotos por chamada' }, 400)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro', 'apoio'])
  if (roleErr) return roleErr

  const { admin, caller } = ctx

  const { data: fotos, error: selErr } = await admin
    .from('acompanhamento_foto')
    .select('id, obra_id, storage_bucket, storage_key, excluida_em, enviado_por, created_at')
    .in('id', ids)

  if (selErr) return json({ error: `Lookup: ${selErr.message}` }, 500)
  if (!fotos || fotos.length === 0) return json({ ok: true, removidas: 0, ja_excluidas: 0 })

  const obrasUnicas = [...new Set(fotos.map((f) => f.obra_id as string))]
  if (caller.role === 'apoio') {
    for (const obraId of obrasUnicas) {
      const accErr = await assertObraAccess(ctx, obraId, { write: false })
      if (accErr) return accErr
    }
    const limite = Date.now() - 24 * 60 * 60 * 1000
    const negadas = fotos.filter(
      (f) => f.enviado_por !== caller.id || new Date(f.created_at as string).getTime() < limite
    )
    if (negadas.length > 0) {
      return json({ error: 'Apoio só pode remover fotos que enviou nas últimas 24 horas' }, 403)
    }
  } else {
    for (const obraId of obrasUnicas) {
      const accErr = await assertObraAccess(ctx, obraId, { write: true })
      if (accErr) return accErr
    }
  }

  const aProcessar = fotos.filter((f) => f.excluida_em == null)
  const jaExcluidas = fotos.length - aProcessar.length
  if (aProcessar.length === 0) {
    return json({ ok: true, removidas: 0, ja_excluidas: jaExcluidas })
  }

  const agora = new Date().toISOString()
  const { error: updErr, count } = await admin
    .from('acompanhamento_foto')
    .update({ excluida_em: agora, excluida_por: caller.id }, { count: 'exact' })
    .in('id', aProcessar.map((f) => f.id))
  if (updErr) return json({ error: `Update: ${updErr.message}` }, 500)

  const byBucket = new Map<string, string[]>()
  for (const f of aProcessar) {
    if (!f.storage_bucket || !f.storage_key) continue
    const arr = byBucket.get(f.storage_bucket as string) ?? []
    arr.push(f.storage_key as string)
    byBucket.set(f.storage_bucket as string, arr)
  }
  const warnings: string[] = []
  for (const [bucket, keys] of byBucket.entries()) {
    const { error: bErr } = await admin.storage.from(bucket).remove(keys)
    if (bErr) warnings.push(`Storage remove (${bucket}): ${bErr.message}`)
  }

  return json({
    ok: true,
    removidas: count ?? aProcessar.length,
    ja_excluidas: jaExcluidas,
    warnings
  })
})
