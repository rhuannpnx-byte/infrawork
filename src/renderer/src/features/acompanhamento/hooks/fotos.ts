import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { adminApi } from '@/lib/supabase/functions'
import type { FotosListarFiltros, FotoEnriquecida } from '@/types/acompanhamento'

/** Máximo aceito pela edge function de listagem por chamada. */
const PAGE = 200
/** Páginas buscadas em paralelo depois da primeira. */
const CONCORRENCIA = 4

/** Variants de tamanho usadas pela UI. */
export type FotoVariant = 'thumb' | 'preview' | 'full'
const VARIANT_TRANSFORM: Record<FotoVariant, { width: number; height?: number; quality?: number; resize?: 'cover' | 'contain' }> = {
  // Foto INTEIRA dentro de uma caixa (contain). Com só `width` + cover o Storage
  // mantém a altura original e recorta uma faixa do centro — a miniatura virava
  // um zoom no meio da foto.
  // Grid (células de até 260px).
  thumb: { width: 320, height: 320, quality: 70, resize: 'contain' },
  // Hover preview (~280px) + thumbs do cluster. ≤ 480 → URL de longa duração.
  preview: { width: 480, height: 480, quality: 75, resize: 'contain' },
  // Lightbox fullscreen — usa contain pra preservar aspect ratio.
  full: { width: 1600, quality: 85, resize: 'contain' }
}

/**
 * Lista TODAS as fotos do filtro, só metadados (sem URLs — miniaturas e prévias
 * são assinadas sob demanda pelo que está visível). A 1ª página traz o total;
 * as demais vão em paralelo. Assim o mapa recebe todos os pontos de uma vez em
 * vez de esperar ~20 páginas sequenciais.
 */
export async function listarTodasFotos(
  obraId: string,
  filtros: FotosListarFiltros = {}
): Promise<{ fotos: FotoEnriquecida[]; total: number }> {
  const pagina = (page: number): Promise<FotoEnriquecida[]> =>
    adminApi
      .acompanhamentoFotosListar({ obra_id: obraId, filtros, page, page_size: PAGE, with_urls: false })
      .then((r) => r.fotos)
  const primeira = await adminApi.acompanhamentoFotosListar({
    obra_id: obraId, filtros, page: 0, page_size: PAGE, with_urls: false
  })
  const nPaginas = Math.ceil(primeira.total / PAGE)
  const paginas: FotoEnriquecida[][] = [primeira.fotos]
  let proxima = 1
  await Promise.all(
    Array.from({ length: Math.min(CONCORRENCIA, Math.max(0, nPaginas - 1)) }, async () => {
      while (proxima < nPaginas) {
        const p = proxima++
        paginas[p] = await pagina(p)
      }
    })
  )
  // Uma foto sincronizada no meio da busca desloca as páginas — evita duplicata.
  const vistos = new Set<string>()
  const fotos = paginas.flat().filter((f) => (vistos.has(f.id) ? false : (vistos.add(f.id), true)))
  return { fotos, total: primeira.total }
}

export function useFotosTodas(
  obraId: string | null | undefined,
  filtros: FotosListarFiltros = {}
): ReturnType<typeof useQuery<{ fotos: FotoEnriquecida[]; total: number }>> {
  return useQuery({
    queryKey: ['acompanhamento', 'fotos', obraId, filtros],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: () => listarTodasFotos(obraId!, filtros)
  })
}

/** Fotos georreferenciadas para o mini-mapa do dashboard. Sem URLs. */
export function useFotosGeo(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<FotoEnriquecida[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'fotos-geo', obraId],
    enabled: !!obraId,
    staleTime: 60 * 1000,
    queryFn: async () => (await listarTodasFotos(obraId!, { somente_geo: true })).fotos
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

// Miniaturas e prévias pedem URLs de 7 dias e ficam salvas entre sessões: a URL
// assinada é a chave do cache em disco do navegador, então reaproveitá-la evita
// baixar (e redimensionar no Storage) a mesma imagem de novo a cada abertura.
// Foto cheia (lightbox) segue com o TTL curto padrão e não é persistida.
const TTL_PERSISTENTE = 7 * 24 * 3600
const VARIANTES_PERSISTIDAS: FotoVariant[] = ['thumb', 'preview']
const STORAGE_KEY = 'infrawork.fotos.urls.v2' // v2: miniaturas 'contain' (v1 eram recortadas)
const MAX_PERSISTIDAS = 4000

;(function carregarCachePersistido(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const agora = Date.now()
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, SignedEntry>)) {
      if (v && typeof v.url === 'string' && v.expires > agora) urlCache.set(k, v)
    }
  } catch { /* cache é só otimização */ }
})()

let salvarTimer: ReturnType<typeof setTimeout> | null = null
function agendarPersistencia(): void {
  if (salvarTimer) return
  salvarTimer = setTimeout(() => {
    salvarTimer = null
    try {
      const agora = Date.now()
      const entradas = [...urlCache.entries()]
        .filter(([k, v]) => v.expires > agora && VARIANTES_PERSISTIDAS.some((p) => k.startsWith(p + ':')))
        .sort((a, b) => b[1].expires - a[1].expires)
        .slice(0, MAX_PERSISTIDAS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entradas)))
    } catch { /* quota cheia etc. — ignora */ }
  }, 1500)
}
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
      const persistir = VARIANTES_PERSISTIDAS.includes(variant)
      const r = await adminApi.acompanhamentoFotoSignedUrlsBatch({
        foto_ids: slice,
        transform,
        ...(persistir ? { ttl_seconds: TTL_PERSISTENTE } : {})
      })
      const now = Date.now()
      const ttlMs = (r.ttl_seconds ?? 900) * 1000
      for (const u of r.urls) {
        if (!u.url) continue
        const expires = u.expires_at ? new Date(u.expires_at).getTime() - 60_000 : now + ttlMs - 60_000
        urlCache.set(cacheKey(variant, u.foto_id), { url: u.url, expires })
      }
    } catch { /* swallow */ }
  }
  if (VARIANTES_PERSISTIDAS.includes(variant)) agendarPersistencia()
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
