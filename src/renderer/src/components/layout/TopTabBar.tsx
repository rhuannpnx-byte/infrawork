import { type ReactNode } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { Search, X, Plus } from 'lucide-react'
import { Icon } from './IconRenderer'
import { useUIStore } from '@/stores/ui-store'
import { useTabsStore } from '@/stores/tabs-store'
import { cn } from '@/lib/utils'
import infraworkIcon from '@/assets/infrawork-icon.png'

export function TopTabBar(): ReactNode {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActive = useTabsStore((s) => s.setActive)
  const closeTab = useTabsStore((s) => s.closeTab)
  const openModal = useUIStore((s) => s.openModal)
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div
      style={{ gridArea: 'tabs' }}
      className="drag-region bg-bg-tabs border-b border-border flex items-center gap-2 px-2"
    >
      {/* Brand */}
      <div className="no-drag flex items-center shrink-0 pl-0.5 pr-1" title="InfraWork">
        <img
          src={infraworkIcon}
          alt="InfraWork"
          className="h-5 w-5 select-none"
          draggable={false}
        />
      </div>

      {/* Search */}
      <button
        type="button"
        onClick={() => openModal('commandPalette')}
        className="no-drag flex items-center gap-1.5 w-[180px] h-6 px-2 rounded bg-bg-elevated border border-border-strong text-2xs text-text-dim hover:border-border-accent"
      >
        <Search size={11} />
        <span className="flex-1 text-left">Buscar ou comando…</span>
        <span className="font-mono text-text-faint">⌘K</span>
      </button>

      {/* Document tabs */}
      <div className="no-drag flex items-center gap-px overflow-x-auto flex-1 min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-1.5 h-6 pl-2 pr-1 max-w-[200px] border-r border-border cursor-pointer',
                isActive ? 'bg-bg-panel text-text' : 'bg-bg-tabs text-text-muted hover:text-text'
              )}
              onClick={() => {
                setActive(tab.id)
                if (tab.route !== location.pathname) navigate({ to: tab.route })
              }}
            >
              <Icon name={tab.icon} size={10} strokeWidth={2} className="shrink-0" />
              <span className="text-2xs truncate flex-1">{tab.title}</span>
              <button
                type="button"
                aria-label="Fechar aba"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                className="w-4 h-4 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover opacity-0 group-hover:opacity-100"
              >
                <X size={9} />
              </button>
            </div>
          )
        })}
        <button
          type="button"
          aria-label="Nova aba"
          onClick={() => openModal('commandPalette')}
          className="w-6 h-6 flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover rounded"
        >
          <Plus size={12} />
        </button>
      </div>

    </div>
  )
}
