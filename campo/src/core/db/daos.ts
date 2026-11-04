import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './dexie'
import type {
  CatCatalogo,
  CatObra,
  DraftFicha,
  OutFicha,
  OutFoto,
  OutProducao,
  SyncStatus,
} from './entities'
import type { ServicoDto } from '@/types/dtos'

/** Consultas reativas ao banco local (Dexie + useLiveQuery): as telas re-renderizam quando os dados mudam. */

export function useObras(): CatObra[] | undefined {
  return useLiveQuery(() => db.cat_obra.orderBy('codigo').toArray(), [])
}

export function useObra(id: string | null | undefined): CatObra | undefined {
  return useLiveQuery(async () => (id ? db.cat_obra.get(id) : undefined), [id])
}

/** Snapshot do catálogo da obra (`null` = ainda não baixado). */
export function useCatalogo(obraId: string | null | undefined): CatCatalogo | null | undefined {
  return useLiveQuery(
    async () => (obraId ? ((await db.cat_catalogo.get(obraId)) ?? null) : null),
    [obraId],
  )
}

export function servicosPorModo(
  c: CatCatalogo | null | undefined,
  modo: ServicoDto['modo_lancamento'],
): ServicoDto[] {
  return (c?.servicos ?? []).filter((s) => s.modo_lancamento === modo)
}

// ─── produção ─────────────────────────────────────────────────────────────────
export interface SessaoProducao {
  key: string
  obraId: string
  obraCodigo: string
  dt: string
  encarregadoId: string | null
  encarregadoNome: string | null
  equipeId: string | null
  equipeNome: string | null
  itens: OutProducao[]
  total: number
  pendentes: number
  recusados: number
  ultimoCapturedAt: string
  statusDominante: SyncStatus
}

/** Sessões (dia + encarregado + equipe) com algo ainda não enviado ou recusado. */
export function useSessoesDaObra(obraId: string | null | undefined): SessaoProducao[] | undefined {
  return useLiveQuery(async (): Promise<SessaoProducao[]> => {
    if (!obraId) return []
    const rows = (await db.out_producao.where('obraId').equals(obraId).toArray()).filter(
      (r) => !r.excluir,
    )
    const map = new Map<string, SessaoProducao>()
    for (const r of rows) {
      const k = `${r.dt}|${r.encarregadoId ?? ''}|${r.equipeId ?? ''}`
      const s = map.get(k)
      if (s) s.itens.push(r)
      else
        map.set(k, {
          key: k,
          obraId: r.obraId,
          obraCodigo: r.obraCodigo,
          dt: r.dt,
          encarregadoId: r.encarregadoId,
          encarregadoNome: r.encarregadoNome,
          equipeId: r.equipeId,
          equipeNome: r.equipeNome,
          itens: [r],
          total: 0,
          pendentes: 0,
          recusados: 0,
          ultimoCapturedAt: r.capturedAt,
          statusDominante: r.syncStatus,
        })
    }
    const out: SessaoProducao[] = []
    for (const s of map.values()) {
      s.total = s.itens.length
      s.pendentes = s.itens.filter((i) => i.syncStatus !== 'SYNCED').length
      s.recusados = s.itens.filter((i) => i.syncStatus === 'REJEITADA').length
      s.ultimoCapturedAt = s.itens.reduce(
        (a, i) => (i.capturedAt > a ? i.capturedAt : a),
        s.itens[0]!.capturedAt,
      )
      s.statusDominante = s.itens.some((i) => i.syncStatus === 'REJEITADA')
        ? 'REJEITADA'
        : s.itens.some((i) => i.syncStatus === 'FAILED')
          ? 'FAILED'
          : s.itens.some((i) => i.syncStatus === 'SYNCING')
            ? 'SYNCING'
            : s.itens.some((i) => i.syncStatus === 'PENDING')
              ? 'PENDING'
              : 'SYNCED'
      if (s.pendentes > 0) out.push(s)
    }
    return out.sort((a, b) =>
      a.dt !== b.dt
        ? b.dt.localeCompare(a.dt)
        : (a.encarregadoNome ?? '').localeCompare(b.encarregadoNome ?? ''),
    )
  }, [obraId])
}

/** Lançamentos do dia já feitos neste aparelho (para avisar duplicidade). */
export function useProducaoDoDia(
  obraId: string | null | undefined,
  dt: string,
): OutProducao[] | undefined {
  return useLiveQuery(
    async () => (obraId ? db.out_producao.where('[obraId+dt]').equals([obraId, dt]).toArray() : []),
    [obraId, dt],
  )
}

// ─── viagens ──────────────────────────────────────────────────────────────────
export function useFichasDaObra(
  obraId: string | null | undefined,
): { drafts: DraftFicha[]; enviadas: OutFicha[] } | undefined {
  return useLiveQuery(async () => {
    if (!obraId) return { drafts: [], enviadas: [] }
    const [drafts, enviadas] = await Promise.all([
      db.draft_ficha.where('obraId').equals(obraId).reverse().sortBy('lastUpdatedAt'),
      db.out_ficha.where('obraId').equals(obraId).reverse().sortBy('capturedAt'),
    ])
    return { drafts, enviadas: enviadas.filter((f) => !f.excluir).slice(0, 50) }
  }, [obraId])
}

// ─── fotos ────────────────────────────────────────────────────────────────────
export interface FotosFeed {
  /** fotos ainda não enviadas (o foco do app é o que falta enviar) */
  pending: OutFoto[]
  syncedCount: number
}

export function useFotosDaObra(obraId: string | null | undefined): FotosFeed | undefined {
  return useLiveQuery(async (): Promise<FotosFeed> => {
    if (!obraId) return { pending: [], syncedCount: 0 }
    const all = await db.out_foto.where('obraId').equals(obraId).toArray()
    const pending = all.filter((f) => f.syncStatus !== 'SYNCED')
    pending.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    return { pending, syncedCount: all.length - pending.length }
  }, [obraId])
}

// ─── filas ────────────────────────────────────────────────────────────────────
export interface OutboxCounts {
  producao: number
  fichas: number
  fotos: number
  recusados: number
  total: number
}

/** Pendências de envio (o que ainda não chegou ao servidor). Recusados contam à parte: esperam correção. */
export function useOutboxCounts(): OutboxCounts | undefined {
  return useLiveQuery(async () => {
    const [p, f, fo, rp, rf] = await Promise.all([
      db.out_producao.where('syncStatus').anyOf('PENDING', 'SYNCING', 'FAILED').count(),
      db.out_ficha.where('syncStatus').anyOf('PENDING', 'SYNCING', 'FAILED').count(),
      db.out_foto.where('syncStatus').anyOf('PENDING', 'SYNCING', 'FAILED').count(),
      db.out_producao.where('syncStatus').equals('REJEITADA').count(),
      db.out_ficha.where('syncStatus').equals('REJEITADA').count(),
    ])
    return { producao: p, fichas: f, fotos: fo, recusados: rp + rf, total: p + f + fo }
  }, [])
}

export async function contarNaoEnviados(): Promise<number> {
  const [p, f, fo] = await Promise.all([
    db.out_producao.where('syncStatus').notEqual('SYNCED').count(),
    db.out_ficha.where('syncStatus').notEqual('SYNCED').count(),
    db.out_foto.where('syncStatus').notEqual('SYNCED').count(),
  ])
  return p + f + fo
}
