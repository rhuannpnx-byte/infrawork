import { moduleKeyForLocation, useTabsStore } from '@/stores/tabs-store'
import { navigateActiveTab } from './navigateActiveTab'

/**
 * Espelha a aba ativa (routers em memória, um por aba) na URL do browser:
 *
 *  - `bootTabsFromUrl()` — no boot, se a URL aponta para uma rota conhecida,
 *    abre/foca a aba desse módulo nela (deep link / F5).
 *  - `installUrlSync()` — assina a tabs-store: toda mudança de aba ativa ou de
 *    localização dentro dela vira `history.pushState`; `popstate` (Back/Forward)
 *    navega a aba correspondente.
 *
 * Parâmetros de query reservados (ex.: `?empresa=slug`) são preservados pelo
 * resolvedor de marca antes deste módulo rodar.
 */

function currentUrlLocation(): string {
  return window.location.pathname + window.location.search
}

function activeLocation(): string | null {
  const s = useTabsStore.getState()
  return s.tabs.find((t) => t.id === s.activeTabId)?.location ?? null
}

export function bootTabsFromUrl(): void {
  const loc = currentUrlLocation()
  const pathname = window.location.pathname
  if (pathname === '/' || pathname === '') return
  const moduleKey = moduleKeyForLocation(pathname)
  if (!moduleKey) return
  useTabsStore.getState().openModule(moduleKey, loc)
}

export function installUrlSync(): () => void {
  let suppress = false

  const pushIfChanged = (): void => {
    if (suppress) return
    const loc = activeLocation()
    if (!loc) return
    if (loc === currentUrlLocation()) return
    window.history.pushState({ infrawork: true }, '', loc)
  }

  // Primeira sincronização (sem empilhar entrada nova).
  const first = activeLocation()
  if (first && first !== currentUrlLocation()) {
    window.history.replaceState({ infrawork: true }, '', first)
  }

  const unsubscribe = useTabsStore.subscribe(pushIfChanged)

  const onPop = (): void => {
    suppress = true
    try {
      navigateActiveTab(currentUrlLocation())
    } finally {
      // libera no próximo tick: a navegação do router dispara `setTabLocation`
      // de forma assíncrona.
      setTimeout(() => {
        suppress = false
      }, 0)
    }
  }
  window.addEventListener('popstate', onPop)

  return () => {
    unsubscribe()
    window.removeEventListener('popstate', onPop)
  }
}
