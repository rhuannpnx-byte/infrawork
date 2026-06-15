import { type ReactNode } from 'react'
import { Settings, HelpCircle, Home } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { Icon } from './IconRenderer'
import { MODULES } from '@/config/modules'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useTabsStore, useActiveTab } from '@/stores/tabs-store'
import { cn } from '@/lib/utils'

/**
 * Ordem do rail:
 *   1. módulos de engenharia (topo) — Orçamento, Planejamento, etc.
 *   2. spacer flex-1
 *   3. separador
 *   4. módulos de sistema/admin (Gerencial) + ajuda + configurações
 */
export function PrimaryRail(): ReactNode {
  const openModal = useUIStore((s) => s.openModal)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const openModule = useTabsStore((s) => s.openModule)
  const active = useActiveTab()?.moduleKey

  const visibleModules = MODULES.filter(
    (m) => !m.requiredRoles || (role && m.requiredRoles.includes(role))
  )

  const engineeringModules = visibleModules.filter(
    (m) => (m.category ?? 'engineering') === 'engineering'
  )
  const systemModules = visibleModules.filter((m) => m.category === 'system')

  const handleModuleClick = (modKey: string): void => {
    if (active === modKey && !sidebarOpen) {
      setSidebarOpen(true)
      return
    }
    if (active !== modKey && !sidebarOpen) {
      setSidebarOpen(true)
    }
    // Foca/cria a aba do módulo (preservando seu estado / rota lembrada).
    openModule(modKey)
  }

  const renderModuleButton = (mod: (typeof visibleModules)[number]): ReactNode => {
    const isActive = active === mod.key
    const tooltipContent =
      isActive && !sidebarOpen ? `${mod.title} (clique para reabrir o painel)` : mod.title
    return (
      <Tooltip
        key={mod.key}
        content={tooltipContent}
        shortcut={mod.shortcut.toUpperCase()}
        side="right"
      >
        <button
          type="button"
          aria-label={mod.title}
          onClick={() => handleModuleClick(mod.key)}
          className={cn(
            'relative w-8 h-8 rounded flex items-center justify-center transition-colors',
            isActive
              ? 'bg-accent-glow text-accent'
              : 'text-text-muted hover:text-text hover:bg-bg-hover'
          )}
        >
          {isActive ? <span className="nav-item-active-bar" /> : null}
          <Icon name={mod.icon} size={16} strokeWidth={1.8} />
        </button>
      </Tooltip>
    )
  }

  return (
    <nav
      aria-label="Módulos"
      className="row-start-3 col-start-1 bg-bg-rail border-r border-border flex flex-col items-center py-2"
      style={{ gridArea: 'rail' }}
    >
      <div className="w-full flex flex-col items-center gap-0.5 pb-1.5 mb-1 border-b border-border">
        <Tooltip content="Início" side="right">
          <button
            type="button"
            aria-label="Início"
            onClick={() => openModule('home', '/')}
            className={cn(
              'relative w-8 h-8 rounded flex items-center justify-center transition-colors',
              active === 'home'
                ? 'bg-accent-glow text-accent'
                : 'text-text-muted hover:text-text hover:bg-bg-hover'
            )}
          >
            {active === 'home' ? <span className="nav-item-active-bar" /> : null}
            <Home size={16} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>
      <div className="w-full flex flex-col items-center py-1.5 gap-0.5">
        {engineeringModules.map(renderModuleButton)}
      </div>

      <div className="flex-1" />

      <div className="w-full flex flex-col items-center gap-0.5 border-t border-border pt-2">
        {systemModules.map(renderModuleButton)}
        <Tooltip content="Atalhos de teclado" shortcut="?" side="right">
          <button
            type="button"
            onClick={() => openModal('shortcuts')}
            className="w-8 h-8 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-hover"
            aria-label="Atalhos"
          >
            <HelpCircle size={16} strokeWidth={1.8} />
          </button>
        </Tooltip>
        <Tooltip content="Configurações" side="right">
          <button
            type="button"
            onClick={() => openModal('settings')}
            className="w-8 h-8 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-hover"
            aria-label="Configurações"
          >
            <Settings size={16} strokeWidth={1.8} />
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}
