import { db } from '@/core/db/dexie'
import { syncEndpoints } from '@/core/api/endpoints'
import { ApiError } from '@/core/api/fetchClient'
import { sessionStore } from '@/core/auth/SessionStore'
import type { OutProducao } from '@/core/db/entities'
import type { ProducaoRegistroDto } from '@/types/dtos'

/**
 * Envio das linhas pendentes de `out_producao` para `campo_sync_producao` (lote ≤ 200, upsert por app_uuid).
 * Resposta granular: aceitos → SYNCED; recusados → REJEITADA com o motivo do banco (o operador corrige e reenvia);
 * erro de rede → voltam a PENDING sem consumir tentativa.
 */
const MAX_BATCH = 200
let runningPromise: Promise<PushSummary> | null = null

export interface PushSummary {
  attempted: number
  accepted: number
  rejected: number
  reasons: string[]
  networkError?: string
}

export async function pushProducaoOutbox(): Promise<PushSummary> {
  if (runningPromise) return runningPromise
  runningPromise = doPush().finally(() => {
    runningPromise = null
  })
  return runningPromise
}

async function doPush(): Promise<PushSummary> {
  const summary: PushSummary = { attempted: 0, accepted: 0, rejected: 0, reasons: [] }
  // linhas presas em SYNCING (aba fechada no meio do envio) voltam para PENDING
  await db.out_producao.where('syncStatus').equals('SYNCING').modify({ syncStatus: 'PENDING' })
  const pending = await db.out_producao
    .where('syncStatus')
    .anyOf('PENDING', 'FAILED')
    .limit(MAX_BATCH)
    .toArray()
  if (pending.length === 0) return summary
  summary.attempted = pending.length
  await db.out_producao.bulkUpdate(
    pending.map((p) => ({ key: p.id, changes: { syncStatus: 'SYNCING' as const } })),
  )
  try {
    const res = await syncEndpoints.producao(pending.map(paraDto))
    const now = Date.now()
    const aceitos = new Set(res.aceitos)
    const recusados = new Map(res.rejeitados.map((r) => [r.app_uuid, r.motivo]))
    await db.out_producao.bulkUpdate(
      pending.map((p) =>
        aceitos.has(p.id)
          ? {
              key: p.id,
              changes: { syncStatus: 'SYNCED' as const, lastSyncAttempt: now, failureReason: null },
            }
          : {
              key: p.id,
              changes: {
                syncStatus: 'REJEITADA' as const,
                lastSyncAttempt: now,
                failureReason: recusados.get(p.id) ?? 'Recusado pelo servidor',
                retryCount: (p.retryCount ?? 0) + 1,
              },
            },
      ),
    )
    // exclusões aceitas saem da fila local
    const excluidas = pending.filter((p) => p.excluir && aceitos.has(p.id)).map((p) => p.id)
    if (excluidas.length) await db.out_producao.bulkDelete(excluidas)
    summary.accepted = res.aceitos.length
    summary.rejected = res.rejeitados.length
    summary.reasons = [...new Set(res.rejeitados.map((r) => r.motivo))]
    return summary
  } catch (err) {
    const now = Date.now()
    if (err instanceof ApiError && err.isUnauthorized) sessionStore.markTokenExpired()
    await db.out_producao.bulkUpdate(
      pending.map((p) => ({
        key: p.id,
        changes: {
          syncStatus: 'PENDING' as const,
          lastSyncAttempt: now,
          failureReason: err instanceof Error ? err.message : 'erro desconhecido',
        },
      })),
    )
    summary.networkError = err instanceof Error ? err.message : String(err)
    return summary
  }
}

function paraDto(o: OutProducao): ProducaoRegistroDto {
  return {
    app_uuid: o.id,
    obra_id: o.obraId,
    data: o.dt,
    item_orcamentario_id: o.servicoId,
    equipe_id: o.equipeId,
    encarregado_id: o.encarregadoId,
    quantidade: o.quantidade,
    trecho_id: o.localId,
    posicao_inicio_m: o.posicaoInicioM,
    posicao_fim_m: o.posicaoFimM,
    estaca_inicial: o.estacaInicial,
    estaca_final: o.estacaFinal,
    frente: null,
    obs: o.obs,
    material_qtd: o.materialQtd,
    ...(o.excluir ? { excluir: true } : {}),
  }
}
