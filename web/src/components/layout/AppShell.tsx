import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LayoutDashboard } from 'lucide-react'
import { TitleBar, ScopePill, UserMenu } from './TitleBar'
import { Sidebar } from './Sidebar'
import infraworkIcon from '@/assets/infrawork-icon.png'
import { useUIStore } from '@/stores/ui-store'
import { useActiveTab } from '@/stores/tabs-store'
import { MODULES, getModuleByRoute, isBareRoute } from '@/config/modules'
import { useCamadaModal } from '@/components/ui/camada-modal'
import { navigateActiveTab } from '@/app/navigateActiveTab'

/**
 * Chrome do app (fora dos routers das abas). A localização "atual" para fins de
 * layout vem da aba ativa (tabs-store), não de um hook de router — o chrome não
 * está sob nenhum `RouterProvider`. O conteúdo (`children` = TabViewport) traz
 * um router por aba, cada um com sua própria rolagem; por isso `<main>` é
 * `overflow-hidden` e o ErrorBoundary vive dentro de cada aba.
 *
 * Rotas "bare" (`/lancar`, uso em campo no celular) ganham um chrome mínimo:
 * só logo, obra e usuário, sem o menu.
 */
export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const estreito = useTelaEstreita()
  const activeTab = useActiveTab()
  const caminho = activeTab?.location.split('?')[0] ?? '/'

  // nome da página na aba do navegador e no histórico
  useEffect(() => {
    const pagina = tituloDaPagina(caminho)
    document.title = pagina ? `${pagina} · InfraWork` : 'InfraWork'
    return () => {
      document.title = 'InfraWork'
    }
  }, [caminho])

  const bare = !!activeTab && isBareRoute(activeTab.location.split('?')[0])
  if (bare) {
    return (
      <div className="h-dvh w-screen flex flex-col bg-bg">
        <BareBar />
        <main className="flex-1 min-h-0 overflow-hidden relative bg-bg">{children}</main>
      </div>
    )
  }

  // Tela estreita (celular): o menu abre por cima do conteúdo e fecha ao escolher a página.
  const fixo = sidebarOpen && !estreito
  return (
    <div
      className="h-dvh w-screen grid"
      style={{
        gridTemplateRows: '48px minmax(0, 1fr)',
        gridTemplateColumns: fixo ? '248px minmax(0, 1fr)' : '0 minmax(0, 1fr)',
        gridTemplateAreas: '"title title" "sidebar main"',
        transition: 'grid-template-columns 140ms ease-out'
      }}
    >
      <TitleBar />
      {fixo ? <Sidebar /> : <span style={{ gridArea: 'sidebar' }} />}
      <main style={{ gridArea: 'main' }} className="bg-bg overflow-hidden relative">
        {children}
      </main>
      {sidebarOpen && estreito ? <GavetaMenu aoFechar={() => setSidebarOpen(false)} /> : null}
    </div>
  )
}

/** Menu por cima do conteúdo, em tela estreita: prende o foco, fecha com Esc, ao escolher a página e no véu. */
function GavetaMenu({ aoFechar }: { aoFechar: () => void }): ReactNode {
  const caixa = useRef<HTMLDivElement>(null)
  useCamadaModal(true, caixa, { aoFechar })
  return (
    <div className="fixed inset-x-0 bottom-0 top-12 z-40 flex">
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        className="w-[min(280px,85vw)] h-full flex shadow-[var(--sombra-flutuante)]"
      >
        <Sidebar gaveta aoNavegar={aoFechar} />
      </div>
      <button
        type="button"
        aria-label="Fechar o menu"
        tabIndex={-1}
        className="flex-1 bg-[color:var(--veu)]"
        onClick={aoFechar}
      />
    </div>
  )
}

function tituloDaPagina(caminho: string): string {
  if (caminho === '/') return 'Início'
  let rota = ''
  let rotulo = ''
  for (const m of MODULES)
    for (const s of m.sections)
      for (const i of s.items)
        if (
          (caminho === i.route || caminho.startsWith(`${i.route}/`)) &&
          i.route.length > rota.length
        ) {
          rota = i.route
          rotulo = i.label
        }
  return rotulo || getModuleByRoute(caminho)?.title || ''
}

function useTelaEstreita(): boolean {
  const consulta = '(max-width: 767px)'
  const [estreito, setEstreito] = useState(() => window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const aoMudar = (): void => setEstreito(mq.matches)
    mq.addEventListener('change', aoMudar)
    return () => mq.removeEventListener('change', aoMudar)
  }, [])
  return estreito
}

function BareBar(): ReactNode {
  return (
    <div className="h-12 shrink-0 bg-bg-menu border-b border-border flex items-center gap-2 px-2 text-sm">
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
        className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded border border-border-strong bg-bg-panel text-sm text-text-muted hover:text-text hover:border-border-accent"
        title="Abrir o app completo"
      >
        <LayoutDashboard size={13} /> App completo
      </button>
      <UserMenu />
    </div>
  )
}
