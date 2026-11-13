import { db } from '@/core/db/dexie'
import { sessionStore } from '@/core/auth/SessionStore'
import { uuidv7 } from '@/lib/uuidv7'
import type { OutFoto } from '@/core/db/entities'
import { pushFotoOutbox, type PushSummary } from '@/core/sync/fotoSync'
import { triggerForegroundSync } from '@/core/sync/foregroundSync'

/** Grava uma foto (marca d'água queimada e GPS no EXIF) na fila e tenta enviar. */
export interface SaveFotoInput {
  obraId: string
  obraCodigo: string
  /** lançamento do app a que a foto pertence (uuid), se houver */
  producaoId: string | null
  servicoId: string | null
  servicoNome: string | null
  encarregadoId: string | null
  encarregadoNome: string | null
  equipeId: string | null
  equipeNome: string | null
  lat: number | null
  lng: number | null
  accuracy: number | null
  /** quando a foto foi tirada (ISO); sem valor = agora */
  capturedAt?: string
  fileBlob: Blob
  width: number | null
  height: number | null
  obs: string | null
}

export async function saveFoto(
  input: SaveFotoInput,
): Promise<{ id: string; pushResult: PushSummary | null }> {
  const user = sessionStore.current()
  if (!user) throw new Error('Sem sessão de usuário')
  const obra = await db.cat_obra.get(input.obraId)
  const empresaId = obra?.empresa_id ?? user.empresaId
  if (!empresaId)
    throw new Error('Obra sem empresa. Conecte-se à internet para atualizar os dados da obra.')
  const id = uuidv7()
  const fileData = await input.fileBlob.arrayBuffer()
  const entity: OutFoto = {
    id,
    obraId: input.obraId,
    obraCodigo: input.obraCodigo,
    empresaId,
    producaoId: input.producaoId,
    servicoId: input.servicoId,
    servicoNome: input.servicoNome,
    encarregadoId: input.encarregadoId,
    encarregadoNome: input.encarregadoNome,
    equipeId: input.equipeId,
    equipeNome: input.equipeNome,
    lat: input.lat,
    lng: input.lng,
    accuracy: input.accuracy,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    fileData,
    fileBlob: null,
    mime: input.fileBlob.type || 'image/jpeg',
    sizeBytes: input.fileBlob.size,
    width: input.width,
    height: input.height,
    obs: input.obs,
    cadastradorNome: user.userNome,
    syncStatus: 'PENDING',
  }
  await db.out_foto.add(entity)
  let pushResult: PushSummary | null = null
  try {
    pushResult = await pushFotoOutbox()
  } catch (e) {
    console.warn('[fotoRepo] envio falhou; fica na fila:', e)
  }
  void triggerForegroundSync('post-save-foto', { ignoreCooldown: true })
  return { id, pushResult }
}

/** Exclui uma foto ainda não enviada (PENDING/FAILED). */
export async function deleteFoto(id: string): Promise<void> {
  const foto = await db.out_foto.get(id)
  if (!foto) return
  if (foto.syncStatus === 'SYNCING') throw new Error('Foto em envio, aguarde')
  if (foto.syncStatus === 'SYNCED') throw new Error('Foto já enviada: exclua pelo InfraWork Web.')
  await db.out_foto.delete(id)
}
