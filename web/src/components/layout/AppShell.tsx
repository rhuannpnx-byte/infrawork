import { type ReactNode } from 'react'
import { LayoutDashboard } from 'lucide-react'
import { TitleBar, ScopePill, UserMenu } from './TitleBar'
import { TabBar } from './TabBar'
import { PrimaryRail } from './PrimaryRail'
import { SecondarySidebar } from './SecondarySidebar'
import { StatusBar } from './StatusBar'
import infraworkIcon from '@/assets/infrawork-icon.png'
import { useUIStore } from '@/stores/ui-store'
import { useActiveTab } from '@/stores/tabs-store'
import { isBareRoute } from '@/config/modules'
import { navigateActiveTab } from '@/app/navigateActiveTab'

/**
 * Chrome do app (fora dos routers das abas). A localização "atual" para fins de
 * layout vem da aba ativa (tabs-store), não de um hook de router — o chrome não
 * está sob nenhum `RouterProvider`. O conteúdo (`children` = TabViewport) traz
 * um router por aba, cada um com sua própria rolagem; por isso `<main>` é
 * `overflow-hidden` e o ErrorBoundary vive dentro de cada aba.
 *
 * Rotas "bare" (`/lancar`, uso em campo no celular) ganham um chrome mínimo:
 * só logo, obra e usuário — sem rail, sidebar nem abas.
 */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const activeTab = useActiveTab()

  const bare = !!activeTab && isBareRoute(activeTab.location.split('?')[0])
  if (bare) {
    return (
      <div className="h-dvh w-screen flex flex-col bg-bg">
        <BareBar />
        <main className="flex-1 min-h-0 overflow-hidden relative bg-bg">{children}</main>
      </div>
    )
  }

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

function BareBar(): ReactNode {
  return (
    <div className="h-11 shrink-0 bg-bg-tabs border-b border-border flex items-center gap-2 px-2 text-xs">
      <img
        src={infraworkIcon}
        alt="InfraWork"
        className="h-7 w-7 select-none shrink-0"
        draggable={false}
      />
      <div className="min-w-0 flex-1 flex items-center justify-center">
        <ScopePill />
      </div>
      <button
        type="button"
        onClick={() => navigateActiveTab('/acompanhamento/lancar')}
        className="hidden sm:inline-flex items-center gap-1 h-7 px-2 rounded border border-border-strong bg-bg-elevated text-2xs text-text-muted hover:text-text hover:border-border-accent"
        title="Abrir o app completo"
      >
        <LayoutDashboard size={11} /> App completo
      </button>
      <UserMenu />
    </div>
  )
}
