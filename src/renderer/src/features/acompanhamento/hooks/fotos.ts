import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { adminApi } from '@/lib/supabase/functions'
import type {
  FotosListarFiltros,
  FotosListarResposta,
  FotoEnriquecida
} from '@/types/acompanhamento'

const PAGE = 50

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
      return await adminApi.acompanhamentoFotosListar({
        obra_id: obraId!,
        filtros,
        page: pageParam as number,
        page_size: PAGE,
        with_urls: true
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
 */
interface SignedEntry { url: string; expires: number }
const urlCache = new Map<string, SignedEntry>()
let pending: Set<string> = new Set()
let pendingResolvers: Array<() => void> = []
let pendingTimer: ReturnType<typeof setTimeout> | null = null

async function flushPending(): Promise<void> {
  const ids = Array.from(pending)
  pending = new Set()
  const resolvers = pendingResolvers
  pendingResolvers = []
  pendingTimer = null
  // Chunks de 100 (limite da EF)
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100)
    try {
      const r = await adminApi.acompanhamentoFotoSignedUrlsBatch({ foto_ids: slice })
      const now = Date.now()
      for (const u of r.urls) {
        if (u.url && u.expires_at) {
          urlCache.set(u.foto_id, {
            url: u.url,
            expires: new Date(u.expires_at).getTime() - 60_000 // refresh 60s antes
          })
        }
      }
      const ttlMs = (r.ttl_seconds ?? 900) * 1000
      // proteção contra urls sem expires_at: marca expirar em ttl_seconds
      for (const u of r.urls) {
        if (u.url && !u.expires_at) urlCache.set(u.foto_id, { url: u.url, expires: now + ttlMs - 60_000 })
      }
    } catch { /* swallow */ }
  }
  for (const r of resolvers) r()
}

function scheduleFlush(): void {
  if (pendingTimer) return
  pendingTimer = setTimeout(() => { void flushPending() }, 100)
}

export async function getSignedUrls(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const missing: string[] = []
  const now = Date.now()
  for (const id of ids) {
    const c = urlCache.get(id)
    if (c && c.expires > now) out[id] = c.url
    else missing.push(id)
  }
  if (missing.length === 0) return out
  await new Promise<void>((resolve) => {
    for (const id of missing) pending.add(id)
    pendingResolvers.push(resolve)
    scheduleFlush()
  })
  for (const id of missing) {
    const c = urlCache.get(id)
    if (c) out[id] = c.url
  }
  return out
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
