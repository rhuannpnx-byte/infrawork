import { useRef, type MouseEvent, type ReactNode } from 'react'
import { getModuleByKey } from '@/config/modules'
import { useAuthStore } from '@/stores/auth-store'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { moduleKeyForLocation, useActiveLocation } from '@/stores/tabs-store'
import { navigateActiveTab } from '@/app/navigateActiveTab'
import { visibleFor, type ModuleConfig } from '@/types/module'
import { cn } from '@/lib/utils'

const frase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/** Rota do menu que corresponde à página aberta: a mais longa que é prefixo do caminho. */
export function rotaAtiva(caminho: string, rotas: readonly string[]): string | null {
  let melhor: string | null = null
  for (const r of rotas)
    if ((caminho === r || caminho.startsWith(`${r}/`)) && r.length > (melhor?.length ?? -1))
      melhor = r
  return melhor
}

/**
 * Menu do módulo (nível 2): as páginas do módulo aberto, em grupos com título. Só aparece em módulo com páginas (o
 * Início não tem); entra e sai abrindo a largura de 0 a 256 px com esmaecimento.
 */
export function MenuModulo(): ReactNode {
  const pathname = useActiveLocation().split('?')[0]
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const { obraId } = useCurrentScope()
  const chave = moduleKeyForLocation(pathname)
  const atual = chave ? getModuleByKey(chave) : undefined
  const secoes = atual
    ? visibleFor(atual.sections, role)
        .map((s) => ({ ...s, items: visibleFor(s.items, role) }))
        .filter((s) => s.items.length > 0)
    : []
  const visivel = secoes.length > 0

  // Ao fechar, o conteúdo do último módulo fica até a coluna terminar de recolher.
  const ultimo = useRef<{ mod: ModuleConfig; secoes: typeof secoes } | null>(null)
  if (visivel && atual) ultimo.current = { mod: atual, secoes }
  const exibido = visivel && atual ? { mod: atual, secoes } : ultimo.current

  const ativa = rotaAtiva(
    pathname,
    secoes.flatMap((s) => s.items.map((i) => i.route))
  )
  const ir = (e: MouseEvent, rota: string): void => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigateActiveTab(rota)
  }

  return (
    <div
      inert={!visivel}
      aria-hidden={!visivel || undefined}
      className={cn(
        'h-full shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out',
        visivel ? 'w-64 opacity-100' : 'w-0 opacity-0'
      )}
    >
      {exibido ? (
        <nav
          aria-label={`Páginas de ${exibido.mod.title}`}
          className="flex h-full w-64 flex-col border-r border-border bg-bg-menu"
        >
          <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
            <h2 className="truncate text-base font-semibold text-text">{exibido.mod.title}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {exibido.secoes.map((s) => (
              <div key={s.title} className="border-t border-border px-2 py-4 first:border-t-0">
                <h3 className="px-2 pb-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-dim">
                  {frase(s.title)}
                </h3>
                <ul className="space-y-0.5">
                  {s.items.map((item) => {
                    const bloqueado = !!item.requiresObra && !obraId
                    return (
                      <li key={item.route}>
                        <a
                          href={item.route}
                          aria-current={item.route === ativa ? 'page' : undefined}
                          aria-disabled={bloqueado || undefined}
                          title={
                            bloqueado ? 'Selecione uma obra para abrir esta página' : undefined
                          }
                          onClick={(e) => (bloqueado ? e.preventDefault() : ir(e, item.route))}
                          className={cn(
                            'flex h-8 items-center truncate rounded-lg px-2 text-sm text-text-muted transition-colors',
                            'hover:bg-bg-hover hover:text-text',
                            'aria-[current=page]:bg-bg-active aria-[current=page]:font-medium aria-[current=page]:text-text',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                            'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent'
                          )}
                        >
                          <span className="truncate">{item.label}</span>
                          {item.selo ? (
                            <span className="ml-1.5 shrink-0 rounded border border-border-strong px-1 text-2xs font-normal text-text-muted">
                              {item.selo}
                            </span>
                          ) : null}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  )
}
