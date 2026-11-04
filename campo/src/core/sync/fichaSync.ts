import { db } from '@/core/db/dexie'
import { syncEndpoints } from '@/core/api/endpoints'
import { ApiError } from '@/core/api/fetchClient'
import { sessionStore } from '@/core/auth/SessionStore'
import type { OutFicha } from '@/core/db/entities'
import type { FichaDto } from '@/types/dtos'

/**
 * Envio das fichas de viagens (`campo_sync_ficha`): uma ficha por chamada, numa transação no banco. Idempotente
 * pelos ids gerados no aparelho — reenviar a mesma ficha atualiza, não duplica (no SIGA do Monito não era, por isso
 * lá o carreteiro ficava fora do replay). Recusa do banco → REJEITADA com o motivo; erro de rede → PENDING.
 */
let runningPromise: Promise<PushSummary> | null = null

export interface PushSummary {
  attempted: number
  accepted: number
  rejected: number
  networkError?: string
}

export async function pushFichaOutbox(): Promise<PushSummary> {
  if (runningPromise) return runningPromise
  runningPromise = doPush().finally(() => {
    runningPromise = null
  })
  return runningPromise
}

async function doPush(): Promise<PushSummary> {
  const summary: PushSummary = { attempted: 0, accepted: 0, rejected: 0 }
  await db.out_ficha.where('syncStatus').equals('SYNCING').modify({ syncStatus: 'PENDING' })
  const pending = await db.out_ficha
    .where('syncStatus')
    .anyOf('PENDING', 'FAILED')
    .sortBy('capturedAt')
  for (const f of pending) {
    summary.attempted++
    await db.out_ficha.update(f.id, { syncStatus: 'SYNCING' })
    try {
      await syncEndpoints.ficha(paraDto(f))
      if (f.excluir) await db.out_ficha.delete(f.id)
      else
        await db.out_ficha.update(f.id, {
          syncStatus: 'SYNCED',
          lastSyncAttempt: Date.now(),
          failureReason: null,
        })
      summary.accepted++
    } catch (err) {
      const e = err instanceof ApiError ? err : null
      if (e?.isOffline || e?.isUnauthorized || !e) {
        if (e?.isUnauthorized) sessionStore.markTokenExpired()
        await db.out_ficha.update(f.id, {
          syncStatus: 'PENDING',
          lastSyncAttempt: Date.now(),
          failureReason: err instanceof Error ? err.message : String(err),
        })
        summary.networkError = err instanceof Error ? err.message : String(err)
        break // sem rede: não adianta tentar as próximas agora
      }
      await db.out_ficha.update(f.id, {
        syncStatus: 'REJEITADA',
        lastSyncAttempt: Date.now(),
        failureReason: e.message,
        retryCount: (f.retryCount ?? 0) + 1,
      })
      summary.rejected++
    }
  }
  return summary
}

function paraDto(f: OutFicha): FichaDto {
  return {
    id: f.id,
    obra_id: f.obraId,
    data: f.dt,
    veiculo_id: f.veiculoId,
    motorista: f.motorista,
    encarregado_id: f.encarregadoId,
    equipe_id: f.equipeId,
    km_inicial: f.kmInicial,
    km_final: f.kmFinal,
    obs: f.obs,
    origem: 'campo',
    viagens: f.viagens.map((v) => ({
      id: v.id,
      item_orcamentario_id: v.servicoId,
      origem_id: v.origemId,
      destino_id: v.destinoId,
      hora_carga: v.horaCarga,
      hora_descarga: v.horaDescarga,
      quantidade: v.quantidade,
      material_qtd: v.materialQtd,
      dmt_km: v.dmtKm,
      nf_ticket: v.nfTicket,
      trecho_id: v.trechoId,
      posicao_inicio_m: v.posicaoM,
      posicao_fim_m: v.posicaoM,
      obs: v.obs,
      carregador_id: v.carregadorId ?? null,
    })),
    ...(f.excluir ? { excluir: true } : {}),
  }
}
