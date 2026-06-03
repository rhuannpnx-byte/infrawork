import { type ReactNode } from 'react'
import { TitleBar } from './TitleBar'
import { TabBar } from './TabBar'
import { PrimaryRail } from './PrimaryRail'
import { SecondarySidebar } from './SecondarySidebar'
import { StatusBar } from './StatusBar'
import { useUIStore } from '@/stores/ui-store'
import { useActiveTab } from '@/stores/tabs-store'

/**
 * Chrome do app (fora dos routers das abas). A localização "atual" para fins de
 * layout vem da aba ativa (tabs-store), não de um hook de router — o chrome não
 * está sob nenhum `RouterProvider`. O conteúdo (`children` = TabViewport) traz
 * um router por aba, cada um com sua própria rolagem; por isso `<main>` é
 * `overflow-hidden` e o ErrorBoundary vive dentro de cada aba.
 */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const activeTab = useActiveTab()

  // Home (e rotas sem módulo) não têm sidebar: colapsa a coluna.
  const inModule = !!activeTab && activeTab.moduleKey !== 'home'
  const showSidebar = sidebarOpen && inModule
  const gridTemplateColumns = showSidebar ? '44px 268px 1fr' : '44px 0 1fr'

  return (
    <div
      className="h-screen w-screen grid"
      style={{
        gridTemplateRows: '40px 28px 1fr 22px',
        gridTemplateColumns,
        gridTemplateAreas:
          '"title title title" "tabs tabs tabs" "rail sidebar main" "status status status"',
        transition: 'grid-template-columns 140ms ease-out'
      }}
    >
      <TitleBar />
      <TabBar />
      <PrimaryRail />
      <SecondarySidebar />
      <main style={{ gridArea: 'main' }} className="bg-bg overflow-hidden relative">
        {children}
      </main>
      <StatusBar />
    </div>
  )
}
