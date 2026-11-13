import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { Lock, Search } from 'lucide-react'
import { Icon } from '@/components/layout/IconRenderer'
import { useCamadaModal } from '@/components/ui/camada-modal'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useObraStore } from '@/stores/obra-store'
import { useThemeStore } from '@/stores/theme-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { MODULES } from '@/config/modules'
import { visibleFor } from '@/types/module'

const GRUPO =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-text-dim'
const ITEM =
  'flex items-center gap-2.5 px-2 h-9 rounded text-sm text-text cursor-pointer data-[selected=true]:bg-accent-glow-strong data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-text-dim'

/** Busca do app (Ctrl+K): páginas do menu, obras e ações. */
export function CommandPalette(): ReactNode {
  const open = useUIStore((s) => s.activeModals.has('commandPalette'))
  const close = (): void => useUIStore.getState().closeModal('commandPalette')
  const openModal = useUIStore((s) => s.openModal)
  const signOut = useAuthStore((s) => s.signOut)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const setObraId = useObraStore((s) => s.setObraId)
  const tema = useThemeStore((s) => s.tema)
  const setPreferencia = useThemeStore((s) => s.setPreferencia)
  const { obraId, obrasNaEmpresa } = useCurrentScope()
  const [value, setValue] = useState('')
  const caixa = useRef<HTMLDivElement>(null)
  useCamadaModal(open, caixa, { aoFechar: close, focoInicial: false })

  useEffect(() => {
    if (!open) setValue('')
  }, [open])

  if (!open) return null

  const executar = (fn: () => void): void => {
    close()
    fn()
  }
  const modulos = visibleFor(MODULES, role)
  const podeLancar = !!role && role !== 'cliente'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Buscar páginas, obras e ações"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="absolute inset-0 bg-[color:var(--veu)] animate-fade-in pointer-events-none" />
      <div ref={caixa} className="relative w-full max-w-xl mx-4">
        <Command
          className="rounded-md border border-border-strong bg-bg-panel shadow-[var(--sombra-flutuante)] animate-slide-up overflow-hidden"
          shouldFilter
          value={value}
          onValueChange={setValue}
          loop
        >
          <div className="flex items-center gap-2 px-3 border-b border-border">
            <Search size={15} className="text-text-dim shrink-0" />
            <Command.Input
              placeholder="Buscar páginas, obras e ações"
              className="h-11 w-full bg-transparent text-md text-text placeholder:text-text-dim focus:outline-none"
              autoFocus
            />
            <kbd className="text-2xs text-text-dim border border-border rounded px-1.5 py-0.5">
              Esc
            </kbd>
          </div>

          <Command.List className="max-h-[min(460px,60vh)] overflow-y-auto p-1.5">
            <Command.Empty className="py-8 text-center text-sm text-text-muted">
              Nada encontrado. Tente o nome da página ou o código da obra.
            </Command.Empty>

            <Command.Group heading="Páginas" className={GRUPO}>
              <Command.Item
                value="Início painel da obra"
                onSelect={() => executar(() => navigateActiveTab('/'))}
                className={ITEM}
              >
                <Icon name="home" size={14} className="text-text-dim shrink-0" strokeWidth={1.8} />
                <span className="flex-1">Início</span>
                <kbd className="text-2xs text-text-dim">G H</kbd>
              </Command.Item>
              {modulos.flatMap((m) =>
                visibleFor(m.sections, role).flatMap((secao) =>
                  visibleFor(secao.items, role).map((item) => {
                    const bloqueado = !!item.requiresObra && !obraId
                    return (
                      <Command.Item
                        key={item.route}
                        value={`${item.label} ${m.title} ${item.route}`}
                        disabled={bloqueado}
                        onSelect={() => executar(() => navigateActiveTab(item.route))}
                        className={ITEM}
                      >
                        <Icon
                          name={item.icon}
                          size={14}
                          className="text-text-dim shrink-0"
                          strokeWidth={1.8}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        <span className="text-xs text-text-dim shrink-0">{m.title}</span>
                        {bloqueado ? (
                          <Lock
                            size={12}
                            className="text-text-dim shrink-0"
                            aria-label="Pede obra"
                          />
                        ) : null}
                      </Command.Item>
                    )
                  })
                )
              )}
            </Command.Group>

            {obrasNaEmpresa.length > 1 || !obraId ? (
              <Command.Group heading="Obras" className={GRUPO}>
                {obrasNaEmpresa.map((o) => (
                  <Command.Item
                    key={o.id}
                    value={`obra ${o.codigo} ${o.nome}`}
                    onSelect={() => executar(() => setObraId(o.id))}
                    className={ITEM}
                  >
                    <Icon
                      name="folder"
                      size={14}
                      className="text-text-dim shrink-0"
                      strokeWidth={1.8}
                    />
                    <span className="tabular font-semibold text-accent shrink-0">{o.codigo}</span>
                    <span className="flex-1 truncate">{o.nome}</span>
                    {o.id === obraId ? (
                      <span className="text-xs text-text-dim shrink-0">em uso</span>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            <Command.Group heading="Ações" className={GRUPO}>
              {podeLancar ? (
                <Command.Item
                  value="Lançar produção apontar"
                  disabled={!obraId}
                  onSelect={() => executar(() => navigateActiveTab('/acompanhamento/lancar'))}
                  className={ITEM}
                >
                  <Icon name="clipboard-pen" size={14} className="text-text-dim shrink-0" />
                  <span className="flex-1">Lançar produção</span>
                </Command.Item>
              ) : null}
              <Command.Item
                value="Trocar de obra ou de empresa"
                onSelect={() => executar(() => openModal('projectSwitcher'))}
                className={ITEM}
              >
                <Icon name="folder-open" size={14} className="text-text-dim shrink-0" />
                <span className="flex-1">Trocar de obra ou de empresa</span>
              </Command.Item>
              <Command.Item
                value="Tema claro escuro aparência"
                onSelect={() => executar(() => setPreferencia(tema === 'dark' ? 'light' : 'dark'))}
                className={ITEM}
              >
                <Icon name="sliders-horizontal" size={14} className="text-text-dim shrink-0" />
                <span className="flex-1">
                  {tema === 'dark' ? 'Usar o tema claro' : 'Usar o tema escuro'}
                </span>
              </Command.Item>
              <Command.Item
                value="Configurações preferências"
                onSelect={() => executar(() => openModal('settings'))}
                className={ITEM}
              >
                <Icon name="settings" size={14} className="text-text-dim shrink-0" />
                <span className="flex-1">Configurações</span>
              </Command.Item>
              <Command.Item
                value="Atalhos de teclado ajuda"
                onSelect={() => executar(() => openModal('shortcuts'))}
                className={ITEM}
              >
                <Icon name="keyboard" size={14} className="text-text-dim shrink-0" />
                <span className="flex-1">Atalhos de teclado</span>
                <kbd className="text-2xs text-text-dim">?</kbd>
              </Command.Item>
              <Command.Item
                value="Sair encerrar sessão logout"
                onSelect={() => executar(() => void signOut())}
                className={ITEM}
              >
                <Icon name="log-out" size={14} className="text-text-dim shrink-0" />
                <span className="flex-1">Sair</span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          <div className="flex items-center gap-4 px-3 py-2 border-t border-border text-xs text-text-dim">
            <span>↑ ↓ para navegar</span>
            <span>Enter para abrir</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
