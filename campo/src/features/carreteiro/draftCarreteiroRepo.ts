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
    // ficha fechada (gravada ou abandonada): a gravação pendente não pode recriar o rascunho que acabou de sair
    if (!s.ficha) {
      if (timer) clearTimeout(timer)
      timer = null
      return
    }
    if (s.ficha === anterior.ficha) return
    // abrir uma ficha (nova, rascunho ou já gravada) não é mudança: só o que o operador alterar vira rascunho
    if (anterior.ficha?.id !== s.ficha.id) return
    const f = s.ficha
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (store.getState().ficha?.id !== f.id) return
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
