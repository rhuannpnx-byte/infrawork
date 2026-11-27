import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LayoutDashboard } from 'lucide-react'
import { TitleBar, ScopePill, UserMenu } from './TitleBar'
import { Sidebar } from './Sidebar'
import { BarraModulos } from './BarraModulos'
import { MenuModulo } from './MenuModulo'
import infraworkIcon from '@/assets/infrawork-icon.png'
import { useUIStore } from '@/stores/ui-store'
import { useActiveTab } from '@/stores/tabs-store'
import { MODULES, getModuleByRoute, isBareRoute } from '@/config/modules'
import { useCamadaModal } from '@/components/ui/camada-modal'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { iniciarColunasAjustaveis } from '@/lib/tabelas/colunas-ajustaveis'

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

  // largura das colunas ajustável em todas as tabelas (telas, diálogos e painéis)
  useEffect(() => iniciarColunasAjustaveis(), [])

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

  // Três colunas: barra de módulos, menu do módulo e conteúdo. O conteúdo isola o próprio empilhamento (mapas e
  // gráficos usam z-index alto) para a barra aberta por cima dele não ficar atrás. Em tela estreita (celular) o menu
  // é uma gaveta por cima do conteúdo, que fecha ao escolher a página.
  return (
    <div className="h-dvh w-screen flex flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        {estreito ? null : (
          <>
            <BarraModulos />
            <MenuModulo />
          </>
        )}
        <main className="relative isolate min-w-0 flex-1 overflow-hidden bg-bg">{children}</main>
      </div>
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
        <Sidebar aoNavegar={aoFechar} />
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
        onClick={() => navigateActiveTab('/acompanhamento/producao')}
        className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded border border-border-strong bg-bg-panel text-sm text-text-muted hover:text-text hover:border-border-accent"
        title="Abrir o app completo"
      >
        <LayoutDashboard size={13} /> App completo
      </button>
      <UserMenu />
    </div>
  )
}
