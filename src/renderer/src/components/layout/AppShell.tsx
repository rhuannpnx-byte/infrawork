import { type ReactNode } from 'react'
import { useLocation } from '@tanstack/react-router'
import { TopTabBar } from './TopTabBar'
import { MenuBar } from './MenuBar'
import { PrimaryRail } from './PrimaryRail'
import { SecondarySidebar } from './SecondarySidebar'
import { StatusBar } from './StatusBar'
import { useUIStore } from '@/stores/ui-store'
import { getModuleByRoute } from '@/config/modules'

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const location = useLocation()

  // Em rotas que não pertencem a nenhum módulo (ex.: home `/`), a sidebar
  // não tem conteúdo — colapsa a coluna pra o main usar a largura cheia.
  const inModule = !!getModuleByRoute(location.pathname)
  const showSidebar = sidebarOpen && inModule
  const gridTemplateColumns = showSidebar ? '44px 268px 1fr' : '44px 0 1fr'

  return (
    <div
      className="h-screen w-screen grid"
      style={{
        gridTemplateRows: '34px 30px 1fr 22px',
        gridTemplateColumns,
        gridTemplateAreas:
          '"tabs tabs tabs" "menu menu menu" "rail sidebar main" "status status status"',
        transition: 'grid-template-columns 140ms ease-out'
      }}
    >
      <TopTabBar />
      <MenuBar />
      <PrimaryRail />
      <SecondarySidebar />
      <main style={{ gridArea: 'main' }} className="bg-bg overflow-auto relative">
        {children}
      </main>
      <StatusBar />
    </div>
  )
}
