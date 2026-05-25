// POST /functions/v1/acompanhamento-fotos-listar
// Body: {
//   obra_id: string,
//   filtros?: {
//     data_de?: string,        // ISO date 'YYYY-MM-DD'
//     data_ate?: string,
//     servico_ids?: number[],  // SIGA servico_executado_id
//     equipe_match_ids?: string[], // uuid de equipe_match (filtra via encarregado_match.equipe_match_id)
//     encarregado_nomes?: string[],
//     frente?: string,
//     somente_geo?: boolean,
//     bbox?: [south:number, west:number, north:number, east:number]
//   },
//   page?: number,             // default 0
//   page_size?: number,        // default 50, max 200
//   with_urls?: boolean        // default true → assina URLs em lote
// }
//
// Permissão: god/adm/eng/apoio com acesso à obra. Consulta a view
// vw_acompanhamento_foto_enriquecida.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

const TTL = Number(Deno.env.get('SUPABASE_PRESIGN_TTL_SECONDS') ?? '900')
const DEFAULT_BUCKET = Deno.env.get('SUPABASE_BUCKET_FOTOS') ?? 'monito-fotos'
const PAGE_MAX = 200

interface Body {
  obra_id?: string
  filtros?: {
    data_de?: string
    data_ate?: string
    servico_ids?: number[]
    equipe_match_ids?: string[]
    encarregado_nomes?: string[]
    frente?: string
    somente_geo?: boolean
    bbox?: [number, number, number, number]
  }
  page?: number
  page_size?: number
  with_urls?: boolean
  /** Transform aplicada nas URLs assinadas — pra reduzir banda em thumbnails. */
  url_transform?: {
    width?: number
    height?: number
    quality?: number
    resize?: 'cover' | 'contain' | 'fill'
  }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  let body: Body = {}
  try { body = await req.json() } catch { /* ignore */ }
  if (!body.obra_id) return json({ error: 'obra_id obrigatório' }, 400)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro', 'apoio'])
  if (roleErr) return roleErr
  const accErr = await assertObraAccess(ctx, body.obra_id, { write: false })
  if (accErr) return accErr

  const { admin } = ctx
  const page = Math.max(0, Number(body.page ?? 0))
  const pageSize = Math.min(PAGE_MAX, Math.max(1, Number(body.page_size ?? 50)))
  const from = page * pageSize
  const to = from + pageSize - 1
  const withUrls = body.with_urls !== false
  const f = body.filtros ?? {}

  let q = admin
    .from('vw_acompanhamento_foto_enriquecida')
    .select(
      'id, obra_id, siga_foto_id, producao_siga_id, lat, lng, siga_servico_id, siga_servico_nome, siga_encarregado_nome, captured_at, captured_date, storage_bucket, storage_key, obs, servico_match_id, servico_display_nome, equipe_match_id, equipe_display_nome, equipe_display_cor, encarregado_display_nome, correlacao_producao, producao_inferida_id, frente, mime, size_bytes',
      { count: 'exact' }
    )
    .eq('obra_id', body.obra_id)
    .order('captured_at', { ascending: false })
    .range(from, to)

  if (f.data_de) q = q.gte('captured_date', f.data_de)
  if (f.data_ate) q = q.lte('captured_date', f.data_ate)
  if (Array.isArray(f.servico_ids) && f.servico_ids.length > 0) q = q.in('siga_servico_id', f.servico_ids)
  if (Array.isArray(f.equipe_match_ids) && f.equipe_match_ids.length > 0) q = q.in('equipe_match_id', f.equipe_match_ids)
  if (Array.isArray(f.encarregado_nomes) && f.encarregado_nomes.length > 0) q = q.in('siga_encarregado_nome', f.encarregado_nomes)
  if (f.frente) q = q.eq('frente', f.frente)
  if (f.somente_geo) { q = q.not('lat', 'is', null).not('lng', 'is', null) }
  if (Array.isArray(f.bbox) && f.bbox.length === 4) {
    const [s, w, n, e] = f.bbox
    q = q.gte('lat', s).lte('lat', n).gte('lng', w).lte('lng', e)
  }

  const { data: rows, error, count } = await q
  if (error) return json({ error: error.message }, 500)

  // Sanitiza transform (limita pra evitar abuso/custo)
  const tRaw = body.url_transform ?? {}
  const tW = typeof tRaw.width === 'number' && tRaw.width > 0 ? Math.min(2400, Math.round(tRaw.width)) : undefined
  const tH = typeof tRaw.height === 'number' && tRaw.height > 0 ? Math.min(2400, Math.round(tRaw.height)) : undefined
  const tQ = typeof tRaw.quality === 'number' && tRaw.quality >= 20 && tRaw.quality <= 100 ? Math.round(tRaw.quality) : undefined
  const tResize = tRaw.resize === 'cover' || tRaw.resize === 'contain' || tRaw.resize === 'fill' ? tRaw.resize : undefined
  const transformOpts =
    tW || tH
      ? { transform: { ...(tW ? { width: tW } : {}), ...(tH ? { height: tH } : {}), ...(tQ ? { quality: tQ } : {}), ...(tResize ? { resize: tResize } : {}) } }
      : undefined

  let urls: Array<{ foto_id: string; url: string; expires_at: string }> = []
  if (withUrls && rows && rows.length > 0) {
    const expiresIso = new Date(Date.now() + TTL * 1000).toISOString()
    const CONCURRENCY = 50
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const slice = rows.slice(i, i + CONCURRENCY)
      const out = await Promise.all(
        slice.map(async (r) => {
          if (!r.storage_key) return null
          const bucket = (r.storage_bucket as string) || DEFAULT_BUCKET
          const { data: signed } = await admin.storage
            .from(bucket)
            .createSignedUrl(r.storage_key as string, TTL, transformOpts)
          if (!signed) return null
          return { foto_id: r.id as string, url: signed.signedUrl, expires_at: expiresIso }
        })
      )
      for (const u of out) if (u) urls.push(u)
    }
  }

  return json({
    ok: true,
    fotos: rows ?? [],
    urls,
    page,
    page_size: pageSize,
    total: count ?? 0,
    ttl_seconds: TTL
  })
})
