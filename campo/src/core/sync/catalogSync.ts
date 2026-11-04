import { db } from '@/core/db/dexie'
import { catalogEndpoints } from '@/core/api/endpoints'
import { sessionStore } from '@/core/auth/SessionStore'

/**
 * Catálogos do InfraWork Web: as obras liberadas ao usuário e, por obra, o snapshot de `campo_catalogo` (serviços
 * parametrizados, equipes, encarregados, locais, frota, origens/destinos, rotas). O snapshot só é regravado quando a
 * `versao` (hash do conteúdo) muda. Erro de rede não apaga nada: o app segue com o que tem guardado.
 */
let running: Promise<void> | null = null

export async function refreshObras(): Promise<void> {
  const obras = await catalogEndpoints.obras()
  await db.transaction('rw', db.cat_obra, db.cat_catalogo, async () => {
    const ids = new Set(obras.map((o) => o.id))
    const antigas = (await db.cat_obra.toArray()).filter((o) => !ids.has(o.id)).map((o) => o.id)
    if (antigas.length) {
      await db.cat_obra.bulkDelete(antigas)
      await db.cat_catalogo.bulkDelete(antigas)
    }
    await db.cat_obra.bulkPut(obras)
  })
}

export async function refreshCatalogo(obraId: string): Promise<boolean> {
  const c = await catalogEndpoints.catalogo(obraId)
  const atual = await db.cat_catalogo.get(obraId)
  if (atual?.versao === c.versao) {
    await db.cat_catalogo.update(obraId, { fetchedAt: Date.now() })
    return false
  }
  await db.cat_catalogo.put({ ...c, obraId, fetchedAt: Date.now() })
  return true
}

/** Obras + catálogo da obra atual (e das demais, para o operador trocar de obra sem sinal). */
export async function refreshAllCatalogs(): Promise<void> {
  if (running) return running
  running = (async () => {
    await refreshObras()
    const atual = sessionStore.current()?.obraAtualId ?? null
    const obras = await db.cat_obra.toArray()
    const ordem = [...obras.map((o) => o.id)].sort((a, b) =>
      a === atual ? -1 : b === atual ? 1 : 0,
    )
    for (const id of ordem) {
      try {
        await refreshCatalogo(id)
      } catch (e) {
        console.warn('[catalogSync] catálogo da obra', id, 'falhou:', e)
      }
    }
  })().finally(() => {
    running = null
  })
  return running
}
