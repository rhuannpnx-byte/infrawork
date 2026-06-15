import { useEffect, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { Search } from 'lucide-react'
import { Icon } from '@/components/layout/IconRenderer'
import { useUIStore } from '@/stores/ui-store'
import { useTabsStore } from '@/stores/tabs-store'
import { useAuthStore } from '@/stores/auth-store'
import { MODULES } from '@/config/modules'
import { visibleFor } from '@/types/module'

export function CommandPalette(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('commandPalette'))
  const close = (): void => useUIStore.getState().closeModal('commandPalette')
  const openModal = useUIStore((s) => s.openModal)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const recentTabs = useTabsStore((s) => s.tabs)
  const openModule = useTabsStore((s) => s.openModule)
  const signOut = useAuthStore((s) => s.signOut)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  // Esconde módulos que o papel não acessa (ex.: cliente só vê Acompanhamento).
  const modulosVisiveis = visibleFor(MODULES, role)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!open) setValue('')
  }, [open])

  if (!open) return null

  const runAndClose = (fn: () => void): void => {
    fn()
    close()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      // mousedown fecha mais cedo que onClick (que espera mouseup) — ESC e click-out instantâneos
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="absolute inset-0 bg-black/70 animate-fade-in" />
      <Command
        className="relative w-full max-w-xl mx-4 rounded-md border border-border-strong bg-bg-panel shadow-2xl animate-slide-up overflow-hidden"
        shouldFilter
        value={value}
        onValueChange={setValue}
        loop
        onKeyDown={(e) => {
          // Atalho mais direto que o handler global — o cmdk não cancela esse evento.
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search size={13} className="text-text-dim" />
          <Command.Input
            placeholder="Digite um comando ou pesquise…"
            className="h-10 w-full bg-transparent text-sm text-text placeholder:text-text-dim focus:outline-none"
            autoFocus
          />
          <span className="font-mono text-2xs text-text-faint">esc</span>
        </div>

        <Command.List className="max-h-[420px] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-xs text-text-muted">
            Nenhum resultado encontrado.
          </Command.Empty>

          <Command.Group
            heading="Ir para"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-dim"
          >
            {modulosVisiveis.map((m) => (
              <Command.Item
                key={m.key}
                value={`ir ${m.title} ${m.shortcut}`}
                onSelect={() => runAndClose(() => { setSidebarOpen(true); openModule(m.key) })}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-text cursor-pointer aria-selected:bg-bg-hover data-[selected=true]:bg-bg-hover"
              >
                <Icon name={m.icon} size={12} className="text-accent" strokeWidth={1.8} />
                <span className="flex-1">{m.title}</span>
                <span className="font-mono text-2xs text-text-faint uppercase">{m.shortcut}</span>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group
            heading="Ações"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-dim [&_[cmdk-group-heading]]:mt-2"
          >
            <Command.Item
              value="trocar obra projeto"
              onSelect={() => runAndClose(() => openModal('projectSwitcher'))}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-text cursor-pointer aria-selected:bg-bg-hover data-[selected=true]:bg-bg-hover"
            >
              <Icon name="folder-open" size={12} className="text-accent" />
              <span className="flex-1">Trocar de obra</span>
            </Command.Item>
            <Command.Item
              value="configurações settings"
              onSelect={() => runAndClose(() => openModal('settings'))}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-text cursor-pointer aria-selected:bg-bg-hover data-[selected=true]:bg-bg-hover"
            >
              <Icon name="settings" size={12} className="text-accent" />
              <span className="flex-1">Configurações</span>
            </Command.Item>
            <Command.Item
              value="atalhos teclado"
              onSelect={() => runAndClose(() => openModal('shortcuts'))}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-text cursor-pointer aria-selected:bg-bg-hover data-[selected=true]:bg-bg-hover"
            >
              <Icon name="keyboard" size={12} className="text-accent" />
              <span className="flex-1">Atalhos de teclado</span>
              <span className="font-mono text-2xs text-text-faint">?</span>
            </Command.Item>
            <Command.Item
              value="sair logout"
              onSelect={() => runAndClose(() => void signOut())}
              className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-text cursor-pointer aria-selected:bg-bg-hover data-[selected=true]:bg-bg-hover"
            >
              <Icon name="log-out" size={12} className="text-danger" />
              <span className="flex-1">Sair</span>
            </Command.Item>
          </Command.Group>

          {recentTabs.length > 0 ? (
            <Command.Group
              heading="Abas abertas"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-text-dim [&_[cmdk-group-heading]]:mt-2"
            >
              {recentTabs.slice(0, 6).map((t) => (
                <Command.Item
                  key={t.id}
                  value={`aba ${t.title}`}
                  onSelect={() => runAndClose(() => useTabsStore.getState().setActive(t.id))}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-text cursor-pointer aria-selected:bg-bg-hover data-[selected=true]:bg-bg-hover"
                >
                  <Icon name={t.icon} size={12} className="text-text-muted" strokeWidth={1.8} />
                  <span className="flex-1 truncate">{t.title}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-2xs text-text-dim font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ navegar</span>
            <span>↵ selecionar</span>
            <span>esc fechar</span>
          </div>
          <span>cmdk</span>
        </div>
      </Command>
    </div>
  )
}
