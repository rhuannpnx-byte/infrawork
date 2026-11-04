import { db } from '@/core/db/dexie'
import { catalogEndpoints } from '@/core/api/endpoints'
import { sessionStore } from '@/core/auth/SessionStore'
import { podeVerPainel } from '@/features/painel/papel'

/**
 * Visão estratégica: último retrato da obra (`campo_painel`) guardado no aparelho. Só regrava quando a `versao`
 * (hash do conteúdo) muda; erro de rede não apaga nada — a tela mostra o retrato guardado com a data dele.
 * Recusa do servidor (perdeu o acesso / papel mudou) apaga o retrato daquela obra.
 */
export const PAINEL_INTERVALO_MS = 5 * 60_000

const emAndamento = new Map<string, Promise<boolean>>()

function recusaDeAcesso(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /visão estratégica|sem acesso/i.test(msg)
}

/** Busca o retrato. `true` = mudou. `seMaisAntigoQueMs` pula se o guardado é mais novo que isso. */
export async function refreshPainel(
  obraId: string,
  opts?: { seMaisAntigoQueMs?: number },
): Promise<boolean> {
  const atual = emAndamento.get(obraId)
  if (atual) return atual
  const p = (async () => {
    const guardado = await db.cat_painel.get(obraId)
    if (
      opts?.seMaisAntigoQueMs &&
      guardado &&
      Date.now() - guardado.fetchedAt < opts.seMaisAntigoQueMs
    )
      return false
    let novo
    try {
      novo = await catalogEndpoints.painel(obraId)
    } catch (e) {
      if (recusaDeAcesso(e)) await db.cat_painel.delete(obraId)
      throw e
    }
    if (guardado?.versao === novo.versao) {
      await db.cat_painel.update(obraId, { fetchedAt: Date.now() })
      return false
    }
    await db.cat_painel.put({ ...novo, obraId, fetchedAt: Date.now() })
    return true
  })().finally(() => emAndamento.delete(obraId))
  emAndamento.set(obraId, p)
  return p
}

/** Ciclo em primeiro plano: só para quem vê o painel e só a obra atual. */
export async function refreshPainelDaObraAtual(forcar: boolean): Promise<void> {
  const s = sessionStore.current()
  if (!s?.obraAtualId || !podeVerPainel(s.role)) return
  await refreshPainel(s.obraAtualId, { seMaisAntigoQueMs: forcar ? 0 : PAINEL_INTERVALO_MS })
}
