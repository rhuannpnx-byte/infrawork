import { useEffect, useState, type ReactNode } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { buildTabRouter, type AppRouter } from './router'
import { registerTabRouter, unregisterTabRouter } from './tab-routers'
import { TabVisibleContext } from './tab-visible'
import { useTabsStore, type DocumentTab } from '@/stores/tabs-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'

/**
 * Conteúdo principal do shell: monta UM router por aba já ativada (keep-alive),
 * exibindo apenas a aba ativa via `display`. As inativas continuam montadas,
 * preservando todo o estado em memória.
 *
 * `scopeKey` (obra atual) entra na `key` do `TabPane`: ao trocar de obra, cada
 * aba remonta numa instância nova de router na sua rota lembrada, zerando estado
 * obra-específico (planId, filtros) sem fechar a aba.
 */
export function TabViewport(): ReactNode {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const mountedTabIds = useTabsStore((s) => s.mountedTabIds)
  const scope = useCurrentScope()
  const scopeKey = scope.obraId ?? 'none'

  const mounted = tabs.filter((t) => mountedTabIds.includes(t.id))

  return (
    <>
      {mounted.map((tab) => (
        <TabPane key={`${tab.id}::${scopeKey}`} tab={tab} active={tab.id === activeTabId} />
      ))}
    </>
  )
}

function TabPane({ tab, active }: { tab: DocumentTab; active: boolean }): ReactNode {
  const setTabLocation = useTabsStore((s) => s.setTabLocation)
  // Cria o router uma única vez (por montagem desta aba/escopo), semeado na
  // localização lembrada da aba.
  const [router] = useState<AppRouter>(() => buildTabRouter(tab.location))

  // Mantém a localização lembrada em sincronia com a navegação dentro da aba.
  useEffect(() => {
    const unsub = router.subscribe('onResolved', () => {
      const loc = router.state.location.pathname + router.state.location.searchStr
      setTabLocation(tab.id, loc)
    })
    return unsub
  }, [router, tab.id, setTabLocation])

  // Registra o router para que chrome/store possam navegá-lo (fora do provider).
  useEffect(() => {
    registerTabRouter(tab.id, router)
    return () => unregisterTabRouter(tab.id, router)
  }, [router, tab.id])

  return (
    <TabVisibleContext.Provider value={active}>
      <div className="h-full w-full overflow-auto" style={{ display: active ? 'block' : 'none' }}>
        <RouterProvider router={router} />
      </div>
    </TabVisibleContext.Provider>
  )
}
