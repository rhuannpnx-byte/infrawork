import Dexie, { type EntityTable } from 'dexie'
import type { CatCatalogo, CatObra, DraftFicha, OutFicha, OutFoto, OutProducao } from './entities'

/**
 * Banco local do app de campo (IndexedDB). Convenções:
 *  - `&id` = chave primária; `[a+b]` = índice composto
 *  - `syncStatus` indexado nas filas para o motor de envio
 *
 * Migrações: incrementar `version(N)` — nunca apagar dados das filas (o operador pode ter envios pendentes há dias).
 */
class CampoDatabase extends Dexie {
  cat_obra!: EntityTable<CatObra, 'id'>
  cat_catalogo!: EntityTable<CatCatalogo, 'obraId'>
  out_producao!: EntityTable<OutProducao, 'id'>
  out_ficha!: EntityTable<OutFicha, 'id'>
  out_foto!: EntityTable<OutFoto, 'id'>
  draft_ficha!: EntityTable<DraftFicha, 'id'>

  constructor() {
    super('infrawork_campo')
    this.version(1).stores({
      cat_obra: '&id, codigo',
      cat_catalogo: '&obraId',
      out_producao: '&id, syncStatus, obraId, capturedAt, [obraId+dt]',
      out_ficha: '&id, syncStatus, obraId, dt, capturedAt',
      out_foto: '&id, syncStatus, obraId, capturedAt, producaoId',
      draft_ficha: '&id, obraId, dt, lastUpdatedAt',
    })
  }
}

export const db = new CampoDatabase()

/** Apaga o banco inteiro — usado no logout (depois de `sessionStore.clear()`). */
export async function deleteDatabase(): Promise<void> {
  await db.delete()
  await db.open()
}
