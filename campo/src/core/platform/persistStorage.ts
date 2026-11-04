/**
 * Solicita storage persistente — IndexedDB (Dexie) sobrevive a memory pressure.
 *
 * Sem isto, o browser pode evictar IndexedDB quando precisa de espaço — perdendo
 * fotos e produção pendentes no outbox. Cenário típico: device Android com pouca
 * memória, operador no campo o dia todo, várias abas/apps abertos.
 *
 * Comportamento por browser:
 *  - **Chrome Android/Desktop**: aceita automaticamente se o PWA está instalado,
 *    se o site é frequentemente visitado, ou se push notifications foram
 *    permitidas. Sem prompt visível ao usuário.
 *  - **Firefox**: pede prompt explícito ao usuário.
 *  - **iOS Safari**: API existe mas comportamento é menos confiável; chamamos
 *    mesmo assim — não dá erro.
 *
 * Idempotente: chamar várias vezes não causa efeito colateral. Resultado é
 * logado pra diagnóstico.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false
  }
  try {
    // Se já é persistente, evita re-prompt em Firefox
    const already = await navigator.storage.persisted?.()
    if (already) {
      console.info('[storage] já persistente')
      return true
    }
    const granted = await navigator.storage.persist()
    console.info(`[storage] persist() → ${granted}`)
    return granted
  } catch (err) {
    console.warn('[storage] persist() falhou:', err)
    return false
  }
}
