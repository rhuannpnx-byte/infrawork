import { type ReactNode } from 'react'
import { X, Lock } from 'lucide-react'
import { Icon } from './IconRenderer'
import { IconButton } from '@/components/ui/IconButton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getModuleByRoute } from '@/config/modules'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useActiveLocation } from '@/stores/tabs-store'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { visibleFor } from '@/types/module'
import { cn } from '@/lib/utils'

export function SecondarySidebar(): ReactNode {
  const pathname = useActiveLocation().split('?')[0]
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const { obraId } = useCurrentScope()

  const mod = getModuleByRoute(pathname)
  // Quando fechada, não renderiza — o grid template do AppShell colapsa a
  // coluna de 268px → 0 e o main expande automaticamente.
  if (!mod || !sidebarOpen) return null

  return (
    <aside
      style={{ gridArea: 'sidebar' }}
      className="bg-bg-panel border-r border-border flex flex-col"
    >
      {/* Title bar */}
      <div className="h-9 px-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <Icon name={mod.icon} size={14} className="text-accent" strokeWidth={1.8} />
          <h2 className="text-sm font-semibold text-text">{mod.title}</h2>
        </div>
        <IconButton size="sm" aria-label="Fechar painel" onClick={() => setSidebarOpen(false)}>
          <X size={12} />
        </IconButton>
      </div>

      {/* Sections */}
      <ScrollArea className="flex-1 px-2 py-2">
        {visibleFor(mod.sections, role).map((section) => (
          <div key={section.title} className="mb-3">
            <div className="px-2 mb-1 flex items-center gap-1.5">
              <span className="text-2xs font-mono uppercase tracking-wider text-text-dim">
                {section.title}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-px">
              {visibleFor(section.items, role).map((item) => {
                const isActive = pathname === item.route
                const blockedByObra = item.requiresObra && !obraId
                if (blockedByObra) {
                  return (
                    <div
                      key={item.route}
                      title="Selecione uma obra para acessar"
                      className={cn(
                        'w-full flex items-center justify-between gap-2 px-2 py-1 rounded-sm',
                        'text-text-dim cursor-not-allowed opacity-60'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon name={item.icon} size={12} strokeWidth={1.8} className="shrink-0" />
                        <span className="text-xs truncate">{item.label}</span>
                      </div>
                      <Lock size={10} className="shrink-0" />
                    </div>
                  )
                }
                return (
                  <button
                    key={item.route}
                    type="button"
                    onClick={() => navigateActiveTab(item.route)}
                    className={cn(
                      'group w-full flex items-center justify-between gap-2 px-2 py-1 rounded-sm transition-colors text-left',
                      isActive
                        ? 'bg-accent-glow text-accent'
                        : 'text-text-muted hover:text-text hover:bg-bg-hover'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name={item.icon} size={12} strokeWidth={1.8} className="shrink-0" />
                      <span className="text-xs truncate">{item.label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </ScrollArea>
    </aside>
  )
}
