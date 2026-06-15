// POST /functions/v1/acompanhamento-foto-signed-url
// Body: { foto_id: string }
// Permissão: god / adm / engenheiro / apoio com acesso à obra.
//
// Gera signed URL temporária (15 min) para download direto do bucket Supabase.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

const TTL = Number(Deno.env.get('SUPABASE_PRESIGN_TTL_SECONDS') ?? '900')
const DEFAULT_BUCKET = Deno.env.get('SUPABASE_BUCKET_FOTOS') ?? 'monito-fotos'

interface Body {
  foto_id?: string
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro', 'apoio', 'cliente'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const foto_id = body.foto_id?.trim()
  if (!foto_id) return json({ error: 'foto_id é obrigatório' }, 400)

  const { data: foto, error: fotoErr } = await admin
    .from('acompanhamento_foto')
    .select('id, obra_id, storage_bucket, storage_key')
    .eq('id', foto_id)
    .maybeSingle()
  if (fotoErr || !foto) return json({ error: 'Foto não encontrada' }, 404)
  if (!foto.storage_key) return json({ error: 'Foto sem storage_key' }, 422)

  const accErr = await assertObraAccess(ctx, foto.obra_id, { write: false })
  if (accErr) return accErr

  const bucket = foto.storage_bucket || DEFAULT_BUCKET
  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(foto.storage_key, TTL)
  if (signErr || !signed) {
    return json({ error: signErr?.message ?? 'Falha ao assinar URL' }, 500)
  }

  return json({
    url: signed.signedUrl,
    expires_at: new Date(Date.now() + TTL * 1000).toISOString()
  })
})
