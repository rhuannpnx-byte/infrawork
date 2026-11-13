import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, HelpCircle, Home, Lock, Settings } from 'lucide-react'
import { Icon } from './IconRenderer'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MODULES } from '@/config/modules'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { moduleKeyForLocation, useActiveLocation } from '@/stores/tabs-store'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { visibleFor } from '@/types/module'
import { storageKey } from '@/lib/storage-keys'
import { cn } from '@/lib/utils'

const CHAVE_GRUPOS = storageKey('ui.menuGrupos')

function lerGrupos(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(CHAVE_GRUPOS) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

const frase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/**
 * Menu único do app: Início e, abaixo, um grupo por módulo com as suas páginas. O grupo do módulo em uso abre
 * sozinho; os outros abrem e fecham no cabeçalho, e a escolha fica guardada.
 */
export function Sidebar({
  aoNavegar,
  gaveta
}: { aoNavegar?: () => void; gaveta?: boolean } = {}): ReactNode {
  const pathname = useActiveLocation().split('?')[0]
  const openModal = useUIStore((s) => s.openModal)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const { obraId } = useCurrentScope()
  const ativo = moduleKeyForLocation(pathname)
  const [grupos, setGrupos] = useState<Record<string, boolean>>(lerGrupos)
  const ir = (rota: string): void => {
    navigateActiveTab(rota)
    aoNavegar?.()
  }

  useEffect(() => {
    if (!ativo || ativo === 'home') return
    setGrupos((g) => (g[ativo] ? g : { ...g, [ativo]: true }))
  }, [ativo])

  const alternar = (key: string, aberto: boolean): void => {
    const next = { ...grupos, [key]: !aberto }
    setGrupos(next)
    try {
      window.localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(next))
    } catch {
      // sem armazenamento: vale só para esta sessão
    }
  }

  const visiveis = MODULES.filter(
    (m) => !m.requiredRoles || (role && m.requiredRoles.includes(role))
  )
  const modulos = [
    ...visiveis.filter((m) => (m.category ?? 'engineering') === 'engineering'),
    ...visiveis.filter((m) => m.category === 'system')
  ]

  return (
    <nav
      aria-label="Menu"
      style={gaveta ? undefined : { gridArea: 'sidebar' }}
      className={cn(
        'bg-bg-menu border-r border-border flex flex-col min-h-0 overflow-hidden',
        gaveta && 'w-full'
      )}
    >
      <ScrollArea className="flex-1 px-2 py-3">
        <ItemMenu
          rotulo="Início"
          icone={<Home size={14} strokeWidth={1.8} />}
          ativo={ativo === 'home'}
          onClick={() => ir('/')}
        />

        {modulos.map((mod) => {
          const aberto = grupos[mod.key] ?? mod.key === ativo
          return (
            <div key={mod.key} className="mt-3">
              <button
                type="button"
                aria-expanded={aberto}
                onClick={() => alternar(mod.key, aberto)}
                className="w-full h-8 px-2 flex items-center gap-2 rounded text-left text-text hover:bg-bg-hover"
              >
                <span style={{ color: `var(--module-${mod.key}, var(--text-dim))` }}>
                  <Icon name={mod.icon} size={14} strokeWidth={1.8} />
                </span>
                <span className="flex-1 text-2xs font-semibold uppercase tracking-[0.08em]">
                  {mod.title}
                </span>
                {aberto ? (
                  <ChevronDown size={12} className="text-text-dim" />
                ) : (
                  <ChevronRight size={12} className="text-text-dim" />
                )}
              </button>

              {aberto
                ? visibleFor(mod.sections, role).map((section, i) => (
                    <div key={section.title} className={cn(i > 0 && 'mt-1.5')}>
                      {mod.sections.length > 1 ? (
                        <div className="pl-8 pr-2 pt-1 pb-0.5 text-2xs text-text-dim">
                          {frase(section.title)}
                        </div>
                      ) : null}
                      {visibleFor(section.items, role).map((item) => (
                        <ItemMenu
                          key={item.route}
                          rotulo={item.label}
                          recuado
                          ativo={pathname === item.route}
                          bloqueado={!!item.requiresObra && !obraId}
                          onClick={() => ir(item.route)}
                        />
                      ))}
                    </div>
                  ))
                : null}
            </div>
          )
        })}
      </ScrollArea>

      <div className="border-t border-border px-2 py-2">
        <ItemMenu
          rotulo="Atalhos de teclado"
          icone={<HelpCircle size={14} strokeWidth={1.8} />}
          onClick={() => {
            aoNavegar?.()
            openModal('shortcuts')
          }}
        />
        <ItemMenu
          rotulo="Configurações"
          icone={<Settings size={14} strokeWidth={1.8} />}
          onClick={() => {
            aoNavegar?.()
            openModal('settings')
          }}
        />
      </div>
    </nav>
  )
}

function ItemMenu({
  rotulo,
  icone,
  ativo,
  recuado,
  bloqueado,
  onClick
}: {
  rotulo: string
  icone?: ReactNode
  ativo?: boolean
  recuado?: boolean
  bloqueado?: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      disabled={bloqueado}
      aria-current={ativo ? 'page' : undefined}
      title={bloqueado ? 'Selecione uma obra para acessar' : undefined}
      onClick={onClick}
      className={cn(
        'w-full h-8 pr-2 flex items-center gap-2 rounded text-left text-sm transition-colors',
        recuado ? 'pl-8' : 'pl-2',
        ativo
          ? 'bg-accent-glow-strong text-accent font-semibold'
          : 'text-text-muted hover:text-text hover:bg-bg-hover',
        bloqueado && 'cursor-not-allowed opacity-55 hover:bg-transparent hover:text-text-muted'
      )}
    >
      {icone}
      <span className="flex-1 truncate">{rotulo}</span>
      {bloqueado ? <Lock size={12} className="shrink-0" /> : null}
    </button>
  )
}
