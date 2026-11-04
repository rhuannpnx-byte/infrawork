import type { StoreApi, UseBoundStore } from 'zustand'
import { db } from '@/core/db/dexie'
import type { DraftFicha } from '@/core/db/entities'
import type { FichaEmEdicao } from './carreteiroStore'

/**
 * Rascunhos das fichas de viagens: cada mudança da ficha em edição é gravada (com debounce) em `draft_ficha`.
 * Ao gravar a ficha na fila, o rascunho sai.
 */
let ligado = false

export function bootstrapAutoSave(
  store: UseBoundStore<StoreApi<{ ficha: FichaEmEdicao | null }>>,
): void {
  if (ligado) return
  ligado = true
  let timer: ReturnType<typeof setTimeout> | null = null
  store.subscribe((s, anterior) => {
    if (!s.ficha || s.ficha === anterior.ficha) return
    const f = s.ficha
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      // ficha vazia (sem viagens e sem veículo) não vira rascunho
      if (!f.viagens.length && !f.veiculoId) return
      const d: DraftFicha = { ...f, lastUpdatedAt: Date.now() }
      void db.draft_ficha.put(d).catch((e) => console.warn('[draftFicha] falhou:', e))
    }, 300)
  })
}

export async function excluirRascunho(id: string): Promise<void> {
  await db.draft_ficha.delete(id)
}
