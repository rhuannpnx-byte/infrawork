import { type ReactNode } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { X, Info, AlertTriangle, CheckCircle2, Lock } from 'lucide-react'
import { Icon } from './IconRenderer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getModuleByRoute } from '@/config/modules'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { visibleFor } from '@/types/module'
import { cn } from '@/lib/utils'

const INFO_ICONS = { info: Info, warn: AlertTriangle, success: CheckCircle2 }

export function SecondarySidebar(): ReactNode {
  const location = useLocation()
  const navigate = useNavigate()
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const openModal = useUIStore((s) => s.openModal)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const { obraId } = useCurrentScope()

  const mod = getModuleByRoute(location.pathname)
  // Quando fechada, não renderiza — o grid template do AppShell colapsa a
  // coluna de 268px → 0 e o main expande automaticamente.
  if (!mod || !sidebarOpen) return null

  const InfoIcon = mod.infoCard ? INFO_ICONS[mod.infoCard.variant ?? 'info'] : null
  const infoColor = mod.infoCard?.variant === 'warn' ? 'warn' : mod.infoCard?.variant === 'success' ? 'success' : 'accent'

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
        <IconButton
          size="sm"
          aria-label="Fechar painel"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={12} />
        </IconButton>
      </div>

      {/* Pills */}
      {mod.pills && mod.pills.length > 0 ? (
        <div className="px-3 py-2 flex gap-1 border-b border-border overflow-x-auto">
          {visibleFor(mod.pills, role).map((p) => {
            const isActive = location.pathname === p.route || location.pathname.startsWith(p.route + '/')
            return (
              <button
                key={p.route}
                type="button"
                onClick={() => navigate({ to: p.route })}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-sm text-2xs font-medium border whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-accent-glow text-accent border-accent-line'
                    : 'border-border bg-transparent text-text-muted hover:text-text hover:bg-bg-hover'
                )}
              >
                <Icon name={p.icon} size={11} strokeWidth={2} />
                {p.label}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Info card */}
      {mod.infoCard && InfoIcon ? (
        <div
          className={cn(
            'mx-3 mt-3 mb-1 p-2 rounded border text-2xs',
            infoColor === 'warn'
              ? 'border-warn/30 bg-warn/10 text-warn'
              : infoColor === 'success'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-accent-line bg-accent-glow text-accent'
          )}
        >
          <div className="flex items-start gap-1.5">
            <InfoIcon size={12} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">{mod.infoCard.title}</div>
              <div className="opacity-80 leading-snug">{mod.infoCard.description}</div>
            </div>
          </div>
        </div>
      ) : null}

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
                const isActive = location.pathname === item.route
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
                    onClick={() => navigate({ to: item.route })}
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
                    {item.badge !== undefined ? (
                      <Badge variant={item.status === 'warn' ? 'warn' : item.status === 'danger' ? 'danger' : 'default'}>
                        {item.badge}
                      </Badge>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </ScrollArea>

      {/* Actions footer */}
      {mod.actions && mod.actions.length > 0 ? (
        <div className="px-3 py-2 border-t border-border flex items-center gap-2">
          {mod.actions.map((a) => (
            <Button
              key={a.label}
              variant={a.primary ? 'default' : 'secondary'}
              size="sm"
              className="flex-1"
              onClick={() => {
                if (a.onClick) {
                  // Map common command actions to modals
                  const mapping: Record<string, string> = {
                    'new-task': 'newTask',
                    'new-rdo': 'newRDO',
                    'new-bm': 'newBM',
                    'new-order': 'newOrder',
                    'new-employee': 'newEmployee',
                    'export-report': 'export',
                    'export-bm': 'export'
                  }
                  const modalKey = mapping[a.onClick]
                  if (modalKey) openModal(modalKey as never)
                }
              }}
            >
              {a.icon ? <Icon name={a.icon} size={11} strokeWidth={2} /> : null}
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
