// POST /functions/v1/documentacao-remover-documento
// Body: { obra_id: string, documento_id: string }
// Permissão: God (qualquer empresa) ou Adm (na sua empresa).
//
// Remove UM documento importado por engano. Tira o(s) arquivo(s) do bucket
// `documentacao` (não caem por FK) e apaga a linha `documento`, que CASCATEIA
// versões/chunks/candidatos; as tabelas do dossiê (parte/evento/clausula/…)
// têm doc_id ON DELETE SET NULL. O re-resolve do dossiê (resolver/validar/
// lacunas/montar) é disparado pelo cliente após esta chamada.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, assertSameEmpresa, resolveCaller } from '../_shared/auth.ts'

type Body = { obra_id?: string; documento_id?: string }

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
  const documentoId = body.documento_id?.trim()
  if (!obraId) return json({ error: 'obra_id é obrigatório' }, 400)
  if (!documentoId) return json({ error: 'documento_id é obrigatório' }, 400)

  // Obra + escopo de empresa.
  const { data: obra, error: obraErr } = await admin
    .from('obras')
    .select('id, empresa_id')
    .eq('id', obraId)
    .single()
  if (obraErr || !obra) return json({ error: 'Obra não encontrada' }, 404)
  const empErr = assertSameEmpresa(caller, obra.empresa_id)
  if (empErr) return empErr

  // Documento precisa pertencer à obra (evita remover doc de outra obra).
  const { data: doc, error: docErr } = await admin
    .from('documento')
    .select('id, obra_id')
    .eq('id', documentoId)
    .maybeSingle()
  if (docErr) return json({ error: 'Falha ao ler documento', detalhe: docErr.message }, 400)
  if (!doc) return json({ ok: true, removido: false }, 200) // já não existe — idempotente
  if (doc.obra_id !== obraId) return json({ error: 'Documento não pertence à obra' }, 403)

  // Best-effort: remove os objetos do Storage (não caem por cascade).
  try {
    const { data: versoes } = await admin
      .from('documento_versao')
      .select('storage_bucket, storage_key')
      .eq('documento_id', documentoId)
      .not('storage_key', 'is', null)
    const byBucket = new Map<string, string[]>()
    for (const v of versoes ?? []) {
      const bucket = (v as { storage_bucket?: string | null }).storage_bucket
      const key = (v as { storage_key?: string | null }).storage_key
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
    /* best-effort — não bloqueia a remoção do registro */
  }

  // Apaga o documento (cascateia versão/chunk/candidato; dossiê fica com doc_id NULL).
  const { error: delErr } = await admin
    .from('documento')
    .delete()
    .eq('id', documentoId)
    .eq('obra_id', obraId)
  if (delErr) return json({ error: 'Falha ao remover', detalhe: delErr.message }, 400)

  return json({ ok: true, removido: true }, 200)
})
