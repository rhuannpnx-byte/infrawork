import { useState, type MouseEvent, type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { Icon } from './IconRenderer'
import { Tooltip } from '@/components/ui/tooltip'
import { Dropdown, DropdownLabel, DropdownRadioItem } from '@/components/ui/dropdown'
import { GRUPOS_BARRA, MODULES, MODULO_INICIO } from '@/config/modules'
import { useUIStore, type ModoBarra } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { moduleKeyForLocation, useActiveLocation, useTabsStore } from '@/stores/tabs-store'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { useResumoAlertas } from '@/features/acompanhamento/hooks/alertas'
import { visibleFor, type ModuleConfig } from '@/types/module'
import { cn } from '@/lib/utils'

const MODOS: { valor: ModoBarra; rotulo: string }[] = [
  { valor: 'expandida', rotulo: 'Expandida' },
  { valor: 'recolhida', rotulo: 'Recolhida' },
  { valor: 'hover', rotulo: 'Expandir ao passar o mouse' }
]

const LARGURA_RECOLHIDA = 'w-12' // 48 px
const LARGURA_EXPANDIDA = 'w-52' // 208 px

// Item: 32 px de altura, 6 px nas laterais. Com os 8 px do grupo, o ícone fica a 14 px da borda nos dois estados
// (centrado nos 48 px), e o rótulo está sempre presente: a barra só corta o que não cabe.
const CLASSE_ITEM = cn(
  'relative flex h-8 w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg px-1.5',
  'text-base text-text-muted transition-colors',
  'hover:bg-bg-hover hover:text-text',
  'aria-[current=page]:bg-bg-active aria-[current=page]:font-medium aria-[current=page]:text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50'
)

const atalhoLegivel = (s?: string): string | undefined => s?.toUpperCase()

/**
 * Barra de módulos (nível 1, padrão Supabase). Duas camadas: a de fora reserva o espaço no layout (48 px, ou 208 px
 * no modo "expandida"); a de dentro é absoluta e tem fundo, borda e itens. No modo "ao passar o mouse" só a de dentro
 * cresce, por cima do menu do módulo e do conteúdo, sem empurrar nada. O estado vai no atributo `data-state`.
 */
export function BarraModulos(): ReactNode {
  const modo = useUIStore((s) => s.modoBarra)
  const setModo = useUIStore((s) => s.setModoBarra)
  const openModal = useUIStore((s) => s.openModal)
  const [passando, setPassando] = useState(false)
  const expandida = modo === 'expandida' || (modo === 'hover' && passando)

  const pathname = useActiveLocation().split('?')[0]
  const ativo = moduleKeyForLocation(pathname) ?? 'home'
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const tabs = useTabsStore((s) => s.tabs)
  const { obraId } = useCurrentScope()
  const alertas = useResumoAlertas(obraId, role !== 'cliente')

  const porChave = new Map<string, ModuleConfig>([
    [MODULO_INICIO.key, MODULO_INICIO],
    ...MODULES.filter((m) => !m.requiredRoles || (role && m.requiredRoles.includes(role))).map(
      (m) => [m.key, m] as const
    )
  ])
  const grupos = GRUPOS_BARRA.map((g) => ({
    ...g,
    modulos: g.modulos.flatMap((k) => (porChave.has(k) ? [porChave.get(k)!] : []))
  })).filter((g) => g.modulos.length > 0)

  // Volta à última página aberta no módulo (cada módulo guarda a sua aba); na primeira vez, à primeira página.
  const destino = (m: ModuleConfig): string => {
    if (m.key === 'home') return '/'
    const aba = tabs.find((t) => t.moduleKey === m.key)
    if (aba) return aba.location
    const primeira = visibleFor(m.sections, role).flatMap((s) => visibleFor(s.items, role))[0]
    return primeira?.route ?? m.routePrefix
  }
  const abrir = (e: MouseEvent, m: ModuleConfig): void => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    const aba = tabs.find((t) => t.moduleKey === m.key)
    if (aba) useTabsStore.getState().openModule(m.key)
    else navigateActiveTab(destino(m))
  }

  const alertaDe = (m: ModuleConfig): 'erro' | 'aviso' | null =>
    m.alerta === 'alertas-da-obra' ? alertas : null

  const comMouse = modo === 'hover'
  // Recolhida: o nome só aparece na dica, que sai na hora. Aberta (ou abrindo ao passar o mouse): espera 1 s.
  const atrasoDica = modo === 'recolhida' ? 0 : 1000
  return (
    <div
      className={cn(
        'relative h-full shrink-0 transition-[width] duration-100 ease-linear',
        modo === 'expandida' ? LARGURA_EXPANDIDA : LARGURA_RECOLHIDA
      )}
    >
      <nav
        aria-label="Módulos"
        data-state={expandida ? 'expanded' : 'collapsed'}
        onMouseEnter={comMouse ? () => setPassando(true) : undefined}
        onMouseLeave={comMouse ? () => setPassando(false) : undefined}
        onFocus={comMouse ? () => setPassando(true) : undefined}
        onBlur={
          comMouse
            ? (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPassando(false)
              }
            : undefined
        }
        className={cn(
          'group/barra absolute inset-y-0 left-0 z-30 flex flex-col border-r border-border bg-bg-menu',
          'transition-[width] duration-100 ease-linear',
          LARGURA_RECOLHIDA,
          'data-[state=expanded]:w-52',
          // por cima do conteúdo: sombra só quando sobrepõe
          comMouse && 'data-[state=expanded]:shadow-[var(--sombra-flutuante)]'
        )}
      >
        <div className="min-h-0 flex-1 overflow-hidden group-data-[state=expanded]/barra:overflow-y-auto">
          {grupos.map((g, i) => (
            <div key={g.key}>
              {i > 0 ? <div aria-hidden className="mx-2 h-px bg-border" /> : null}
              <ul className="space-y-0.5 p-2">
                {g.modulos.map((m) => {
                  const alerta = alertaDe(m)
                  return (
                    <li key={m.key}>
                      <Tooltip
                        side="right"
                        content={m.title}
                        shortcut={atalhoLegivel(m.shortcut)}
                        delay={atrasoDica}
                      >
                        <a
                          href={destino(m)}
                          aria-current={ativo === m.key ? 'page' : undefined}
                          aria-disabled={m.desabilitado || undefined}
                          onClick={(e) => abrir(e, m)}
                          className={CLASSE_ITEM}
                        >
                          <Icon name={m.icon} size={20} strokeWidth={1.5} className="shrink-0" />
                          <span className="min-w-0 truncate">{m.title}</span>
                          {alerta ? (
                            <>
                              <span
                                aria-hidden
                                className={cn(
                                  'pointer-events-none absolute left-[20px] top-1 size-2 rounded-full ring-2 ring-[color:var(--bg-menu)]',
                                  alerta === 'erro' ? 'bg-danger' : 'bg-warn'
                                )}
                              />
                              <span className="sr-only">
                                {alerta === 'erro' ? ', com alerta crítico' : ', com aviso'}
                              </span>
                            </>
                          ) : null}
                        </a>
                      </Tooltip>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          <div aria-hidden className="mx-2 h-px bg-border" />
          <ul className="space-y-0.5 p-2">
            <li>
              <Tooltip side="right" content="Atalhos de teclado" shortcut="?" delay={atrasoDica}>
                <button
                  type="button"
                  onClick={() => openModal('shortcuts')}
                  className={CLASSE_ITEM}
                >
                  <Icon name="keyboard" size={20} strokeWidth={1.5} className="shrink-0" />
                  <span className="min-w-0 truncate">Atalhos de teclado</span>
                </button>
              </Tooltip>
            </li>
            <li>
              <Tooltip side="right" content="Configurações" delay={atrasoDica}>
                <button type="button" onClick={() => openModal('settings')} className={CLASSE_ITEM}>
                  <Icon name="settings" size={20} strokeWidth={1.5} className="shrink-0" />
                  <span className="min-w-0 truncate">Configurações</span>
                </button>
              </Tooltip>
            </li>
          </ul>
        </div>

        <div className="shrink-0 border-t border-border p-2">
          <Dropdown
            trigger={
              <button
                type="button"
                aria-haspopup="menu"
                aria-label="Controle da sidebar"
                title="Controle da sidebar"
                className={cn(CLASSE_ITEM, 'w-8 group-data-[state=expanded]/barra:w-8')}
              >
                <PanelLeft size={20} strokeWidth={1.5} className="shrink-0" />
              </button>
            }
          >
            <DropdownLabel>Controle da sidebar</DropdownLabel>
            {MODOS.map((m) => (
              <DropdownRadioItem
                key={m.valor}
                marcado={modo === m.valor}
                onClick={() => {
                  setModo(m.valor)
                  setPassando(false)
                }}
              >
                {m.rotulo}
              </DropdownRadioItem>
            ))}
          </Dropdown>
        </div>
      </nav>
    </div>
  )
}
