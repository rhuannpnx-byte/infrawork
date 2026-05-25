import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { adminApi } from '@/lib/supabase/functions'
import type {
  FotosListarFiltros,
  FotosListarResposta,
  FotoEnriquecida
} from '@/types/acompanhamento'

const PAGE = 50

/** Variants de tamanho usadas pela UI. */
export type FotoVariant = 'thumb' | 'preview' | 'full'
const VARIANT_TRANSFORM: Record<FotoVariant, { width: number; quality?: number; resize?: 'cover' | 'contain' }> = {
  // Grid virtualizado (96px alto). 240 dá margem pra retina/zoom sem inchar.
  thumb: { width: 240, quality: 70, resize: 'cover' },
  // Hover preview (~280px largura) + thumbs do cluster.
  preview: { width: 480, quality: 75, resize: 'cover' },
  // Lightbox fullscreen — usa contain pra preservar aspect ratio.
  full: { width: 1600, quality: 85, resize: 'contain' }
}

export function useFotosInfinite(
  obraId: string | null | undefined,
  filtros: FotosListarFiltros = {}
) {
  return useInfiniteQuery({
    queryKey: ['acompanhamento', 'fotos', obraId, filtros],
    enabled: !!obraId,
    initialPageParam: 0,
    staleTime: 30 * 1000,
    queryFn: async ({ pageParam }) => {
      // URLs in-place pedidas como thumb (grid usa 96px). Lightbox/hover refazem
      // o pedido sob demanda via getSignedUrls(ids, 'full' | 'preview').
      return await adminApi.acompanhamentoFotosListar({
        obra_id: obraId!,
        filtros,
        page: pageParam as number,
        page_size: PAGE,
        with_urls: true,
        url_transform: VARIANT_TRANSFORM.thumb
      })
    },
    getNextPageParam: (last: FotosListarResposta, all) => {
      const carregado = all.reduce((s, p) => s + p.fotos.length, 0)
      return carregado < last.total ? all.length : undefined
    }
  })
}

/** Subset georreferenciado para mini-mapa do dashboard. Sem URLs. */
export function useFotosGeo(
  obraId: string | null | undefined,
  limit = 500
): ReturnType<typeof useQuery<FotoEnriquecida[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'fotos-geo', obraId, limit],
    enabled: !!obraId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const r = await adminApi.acompanhamentoFotosListar({
        obra_id: obraId!,
        filtros: { somente_geo: true },
        page: 0,
        page_size: limit,
        with_urls: false
      })
      return r.fotos
    }
  })
}

/**
 * Cache em memória de signed URLs com TTL ~50min. Hook resolve uma lista de
 * foto_ids — usa o que já tem em cache, busca em batch o restante. Debounce
 * 100ms para coalescer requests vindos do virtualizador.
 *
 * Variants sao cacheadas separadamente — thumb (240px) nao colide com full (1600px).
 */
interface SignedEntry { url: string; expires: number }
const urlCache = new Map<string, SignedEntry>() // key = `${variant}:${id}`
type PendingMap = Map<FotoVariant, { ids: Set<string>; resolvers: Array<() => void>; timer: ReturnType<typeof setTimeout> | null }>
const pendingByVariant: PendingMap = new Map()

function cacheKey(variant: FotoVariant, id: string): string { return `${variant}:${id}` }

async function flushPendingFor(variant: FotoVariant): Promise<void> {
  const entry = pendingByVariant.get(variant)
  if (!entry) return
  const ids = Array.from(entry.ids)
  const resolvers = entry.resolvers
  pendingByVariant.delete(variant)
  const transform = VARIANT_TRANSFORM[variant]
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100)
    try {
      const r = await adminApi.acompanhamentoFotoSignedUrlsBatch({ foto_ids: slice, transform })
      const now = Date.now()
      const ttlMs = (r.ttl_seconds ?? 900) * 1000
      for (const u of r.urls) {
        if (!u.url) continue
        const expires = u.expires_at ? new Date(u.expires_at).getTime() - 60_000 : now + ttlMs - 60_000
        urlCache.set(cacheKey(variant, u.foto_id), { url: u.url, expires })
      }
    } catch { /* swallow */ }
  }
  for (const r of resolvers) r()
}

function scheduleFlush(variant: FotoVariant): void {
  const entry = pendingByVariant.get(variant)
  if (!entry || entry.timer) return
  entry.timer = setTimeout(() => { void flushPendingFor(variant) }, 100)
}

export async function getSignedUrls(
  ids: string[],
  variant: FotoVariant = 'thumb'
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const missing: string[] = []
  const now = Date.now()
  for (const id of ids) {
    const c = urlCache.get(cacheKey(variant, id))
    if (c && c.expires > now) out[id] = c.url
    else missing.push(id)
  }
  if (missing.length === 0) return out
  await new Promise<void>((resolve) => {
    let entry = pendingByVariant.get(variant)
    if (!entry) {
      entry = { ids: new Set(), resolvers: [], timer: null }
      pendingByVariant.set(variant, entry)
    }
    for (const id of missing) entry.ids.add(id)
    entry.resolvers.push(resolve)
    scheduleFlush(variant)
  })
  for (const id of missing) {
    const c = urlCache.get(cacheKey(variant, id))
    if (c) out[id] = c.url
  }
  return out
}

/** Mutation: marca fotos como excluidas (god/adm) + remove do bucket. */
export function useDeleteFotos(): ReturnType<typeof useMutation<
  { ok: boolean; removidas: number; ja_excluidas: number; warnings?: string[] },
  Error,
  { fotoIds: string[] }
>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ fotoIds }) => {
      return await adminApi.acompanhamentoFotoDelete({ foto_ids: fotoIds })
    },
    onSuccess: (_data, { fotoIds }) => {
      // Limpa URLs assinadas em cache pra essas fotos (todas as variants)
      const variants: FotoVariant[] = ['thumb', 'preview', 'full']
      for (const id of fotoIds) {
        for (const v of variants) urlCache.delete(cacheKey(v, id))
      }
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'fotos'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'fotos-geo'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'signed-urls'] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'dashboard-resumo'] })
    }
  })
}

export function useSignedUrls(ids: string[]): {
  urls: Record<string, string>
  loading: boolean
} {
  const refIds = useRef(ids)
  refIds.current = ids
  const qc = useQueryClient()
  const key = ['acompanhamento', 'signed-urls', ids.sort().join('|')]
  const { data, isFetching } = useQuery({
    queryKey: key,
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => await getSignedUrls(refIds.current)
  })
  // Re-fetch quando os ids mudam (debounce já está no getSignedUrls)
  useEffect(() => {
    if (ids.length > 0) {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'signed-urls'] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join('|')])
  return { urls: data ?? {}, loading: isFetching }
}
