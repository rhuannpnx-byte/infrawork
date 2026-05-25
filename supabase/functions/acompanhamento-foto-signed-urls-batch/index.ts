// POST /functions/v1/acompanhamento-foto-signed-urls-batch
// Body: { foto_ids: string[], transform?: { width, height?, quality?, resize? } }
// Permissão: god / adm / engenheiro / apoio com acesso à obra.
//
// Versão batch da signed-url singular — usada pelo grid de fotos virtualizado
// e pelo mapa com marcadores. Valida acesso para TODAS as obras envolvidas
// antes de assinar.
//
// Quando `transform.width` (ou height) é informado, Supabase Storage gera uma
// variante redimensionada server-side e cacheada na CDN — fundamental pra UI
// não baixar a foto FULL (centenas de KB) só pra renderizar thumb 96px.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

const TTL = Number(Deno.env.get('SUPABASE_PRESIGN_TTL_SECONDS') ?? '900')
const DEFAULT_BUCKET = Deno.env.get('SUPABASE_BUCKET_FOTOS') ?? 'monito-fotos'
const MAX_IDS = 100

interface TransformOpts {
  width?: number
  height?: number
  quality?: number
  resize?: 'cover' | 'contain' | 'fill'
}

interface Body {
  foto_ids?: string[]
  transform?: TransformOpts
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { admin } = ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro', 'apoio'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const ids = (body.foto_ids ?? []).filter((s): s is string => typeof s === 'string' && s.length > 0)
  if (ids.length === 0) return json({ error: 'foto_ids vazio' }, 400)
  if (ids.length > MAX_IDS) return json({ error: `máximo ${MAX_IDS} ids por chamada` }, 400)

  // Sanitiza transform — limita pra evitar abuso (CDN cobra por tamanho)
  const tRaw = body.transform ?? {}
  const tW = typeof tRaw.width === 'number' && tRaw.width > 0 ? Math.min(2400, Math.round(tRaw.width)) : undefined
  const tH = typeof tRaw.height === 'number' && tRaw.height > 0 ? Math.min(2400, Math.round(tRaw.height)) : undefined
  const tQ = typeof tRaw.quality === 'number' && tRaw.quality >= 20 && tRaw.quality <= 100 ? Math.round(tRaw.quality) : undefined
  const tResize: TransformOpts['resize'] | undefined =
    tRaw.resize === 'cover' || tRaw.resize === 'contain' || tRaw.resize === 'fill' ? tRaw.resize : undefined
  const transformOpts =
    tW || tH
      ? { transform: { ...(tW ? { width: tW } : {}), ...(tH ? { height: tH } : {}), ...(tQ ? { quality: tQ } : {}), ...(tResize ? { resize: tResize } : {}) } }
      : undefined

  const { data: fotos, error: fErr } = await admin
    .from('acompanhamento_foto')
    .select('id, obra_id, storage_bucket, storage_key')
    .in('id', ids)
  if (fErr) return json({ error: fErr.message }, 500)

  // Garante acesso a cada obra distinta (1 chamada de assertObraAccess por obra)
  const obrasUnicas = [...new Set((fotos ?? []).map((f) => f.obra_id as string))]
  for (const obraId of obrasUnicas) {
    const accErr = await assertObraAccess(ctx, obraId, { write: false })
    if (accErr) return accErr
  }

  const expiresIso = new Date(Date.now() + TTL * 1000).toISOString()

  // Paraleliza geração de URLs (até 50 concorrentes)
  const out: Array<{ foto_id: string; url?: string; expires_at?: string; error?: string }> = []
  const CONCURRENCY = 50
  for (let i = 0; i < (fotos?.length ?? 0); i += CONCURRENCY) {
    const slice = (fotos ?? []).slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      slice.map(async (f) => {
        if (!f.storage_key) return { foto_id: f.id as string, error: 'sem storage_key' }
        const bucket = f.storage_bucket || DEFAULT_BUCKET
        const { data: signed, error } = await admin.storage
          .from(bucket)
          .createSignedUrl(f.storage_key, TTL, transformOpts)
        if (error || !signed) return { foto_id: f.id as string, error: error?.message ?? 'falha sign' }
        return { foto_id: f.id as string, url: signed.signedUrl, expires_at: expiresIso }
      })
    )
    out.push(...results)
  }

  return json({ ok: true, urls: out, ttl_seconds: TTL })
})
