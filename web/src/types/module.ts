import type { Capacidade } from '@/config/capacidades'
import type { Role } from './auth'

export interface ModuleNavItem {
  icon: string
  label: string
  route: string
  /** Se omitido, é visível para todos os papéis autenticados. */
  requiredRoles?: Role[]
  /**
   * Se true, o item depende de uma obra selecionada no escopo. Quando não
   * houver obra ativa, o item é renderizado desabilitado com tooltip.
   */
  requiresObra?: boolean
  /** Só aparece para empresa com esta capacidade ligada (web/src/config/capacidades.ts). */
  requer?: Capacidade
}

export interface ModuleSection {
  title: string
  items: ModuleNavItem[]
  requiredRoles?: Role[]
}

export type ModuleCategory = 'engineering' | 'system'

export interface ModuleConfig {
  key: string
  title: string
  icon: string
  shortcut: string
  routePrefix: string
  sections: ModuleSection[]
  /** Se omitido, o módulo é visível para todos os papéis autenticados. */
  requiredRoles?: Role[]
  /** Bolinha sobre o ícone na barra de módulos: de onde vem a pendência (só alertas da obra, por ora). */
  alerta?: 'alertas-da-obra'
  /** Fora do ar para todos: aparece apagado e sem clique. */
  desabilitado?: boolean
  /**
   * Categoria do módulo no PrimaryRail. `engineering` (default) vai na parte
   * superior do rail; `system` vai na parte inferior (próximo a configurações).
   */
  category?: ModuleCategory
}

/**
 * Filtra um array por `requiredRoles`. Retorna tudo quando role for `null`
 * (não autenticado ou ainda carregando) — a página em si decide o que fazer.
 */
export function visibleFor<T extends { requiredRoles?: Role[]; requer?: Capacidade }>(
  items: T[],
  role: Role | null,
  capacidades?: Partial<Record<Capacidade, boolean>> | null
): T[] {
  // o que depende de capacidade só aparece com ela ligada (enquanto carrega, fica fora)
  const habilitados = items.filter((it) => !it.requer || capacidades?.[it.requer] === true)
  if (!role) return habilitados
  return habilitados.filter((it) => !it.requiredRoles || it.requiredRoles.includes(role))
}
