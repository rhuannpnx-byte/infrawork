import { db } from '@/core/db/dexie'
import { syncEndpoints } from '@/core/api/endpoints'
import { ApiError } from '@/core/api/fetchClient'
import { sessionStore } from '@/core/auth/SessionStore'
import type { OutFoto } from '@/core/db/entities'
import type { FotoMetaDto } from '@/types/dtos'
import { photoStorage } from '@/core/storage'
import { handleFromFoto } from '@/core/storage/handleFromFoto'

/**
 * Envio das fotos pendentes: upload direto ao bucket do InfraWork Web (`<empresa>/<obra>/<producao|avulsa>/<id>.jpg`,
 * a política de storage confere a obra) e registro idempotente (`campo_registrar_foto`, por app_uuid).
 * Mais antigas primeiro; com rede boa a fila drena em ciclos seguidos.
 */
const MAX_PER_RUN = 8
/** espera antes de tentar de novo uma foto recusada: 1, 2, 4… min, até 6 h */
export function esperaFalhaMs(tentativas: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, tentativas - 1), 6 * 3_600_000)
}
let runningPromise: Promise<PushSummary> | null = null

export interface PushSummary {
  attempted: number
  accepted: number
  failed: number
  errors: string[]
}

export function storageKeyDaFoto(
  f: Pick<OutFoto, 'id' | 'empresaId' | 'obraId' | 'producaoId'>,
): string {
  return `${f.empresaId}/${f.obraId}/${f.producaoId ? 'campo' : 'avulsa'}/${f.id}.jpg`
}

export async function pushFotoOutbox(): Promise<PushSummary> {
  if (runningPromise) return runningPromise
  runningPromise = doPush().finally(() => {
    runningPromise = null
  })
  return runningPromise
}

async function doPush(): Promise<PushSummary> {
  const summary: PushSummary = { attempted: 0, accepted: 0, failed: 0, errors: [] }
  await db.out_foto.where('syncStatus').equals('SYNCING').modify({ syncStatus: 'PENDING' })
  // foto já registrada no servidor não precisa ocupar o aparelho
  await db.out_foto
    .where('syncStatus')
    .equals('SYNCED')
    .filter((f) => f.fileBlob != null || f.fileData != null)
    .modify({ fileBlob: null, fileData: null })
  const agora = Date.now()
  // a foto de um lançamento só sobe depois que o lançamento chega ao servidor (o registro liga pelo app_uuid);
  // lançamento que nunca foi finalizado ou foi excluído não segura a foto por mais de um dia
  const prodEnviadas = new Set(
    (await db.out_producao.where('syncStatus').equals('SYNCED').primaryKeys()) as string[],
  )
  const espera = (f: { producaoId: string | null; capturedAt: string }): boolean =>
    !!f.producaoId &&
    !prodEnviadas.has(f.producaoId) &&
    agora - new Date(f.capturedAt).getTime() < 24 * 3600_000
  const pending = (
    await db.out_foto.where('syncStatus').anyOf('PENDING', 'FAILED').sortBy('capturedAt')
  )
    .filter((f) => !espera(f))
    // recusada: espera crescente entre as tentativas (antes reenviava a cada ciclo de 60 s)
    .filter(
      (f) =>
        f.syncStatus !== 'FAILED' ||
        agora - (f.lastSyncAttempt ?? 0) >= esperaFalhaMs(f.retryCount ?? 1),
    )
    .slice(0, MAX_PER_RUN)
  if (pending.length === 0) return summary
  summary.attempted = pending.length

  for (const foto of pending) {
    await db.out_foto.update(foto.id, { syncStatus: 'SYNCING' })
    try {
      const handle = handleFromFoto(foto)
      if (!handle) throw new Error('Arquivo da foto não está mais no aparelho')
      const blob = await photoStorage().read(handle)
      await syncEndpoints.foto(meta(foto), blob)
      await db.out_foto.update(foto.id, {
        syncStatus: 'SYNCED',
        failureReason: null,
        lastSyncAttempt: Date.now(),
        fileBlob: null,
        fileData: null,
      })
      summary.accepted += 1
    } catch (err) {
      const e = err instanceof ApiError ? err : null
      const rede = !!e && (e.isOffline || e.isUnauthorized)
      if (e?.isUnauthorized) sessionStore.markTokenExpired()
      const motivo = err instanceof Error ? err.message : String(err)
      await db.out_foto.update(foto.id, {
        syncStatus: rede ? 'PENDING' : 'FAILED',
        failureReason: motivo,
        lastSyncAttempt: Date.now(),
        retryCount: (foto.retryCount ?? 0) + 1,
      })
      summary.failed += 1
      summary.errors.push(motivo)
      if (rede) break
    }
  }
  // drenagem contínua com rede boa
  if (summary.accepted === MAX_PER_RUN) {
    const resto = await db.out_foto.where('syncStatus').anyOf('PENDING', 'FAILED').count()
    if (resto > 0) setTimeout(() => void pushFotoOutbox(), 0)
  }
  return summary
}

function meta(f: OutFoto): FotoMetaDto {
  return {
    app_uuid: f.id,
    obra_id: f.obraId,
    producao_app_uuid: f.producaoId,
    item_orcamentario_id: f.servicoId,
    encarregado_id: f.encarregadoId,
    lat: f.lat,
    lng: f.lng,
    captured_at: f.capturedAt,
    storage_key: storageKeyDaFoto(f),
    mime: f.mime,
    size_bytes: f.sizeBytes,
    width: f.width,
    height: f.height,
    obs: f.obs,
  }
}
