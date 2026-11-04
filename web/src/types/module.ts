import type { Role } from './auth'

export interface ModuleNavItem {
  icon: string
  label: string
  route: string
  badge?: string | number
  status?: 'ok' | 'warn' | 'danger'
  /** Se omitido, é visível para todos os papéis autenticados. */
  requiredRoles?: Role[]
  /**
   * Se true, o item depende de uma obra selecionada no escopo. Quando não
   * houver obra ativa, o item é renderizado desabilitado com tooltip.
   */
  requiresObra?: boolean
}

export interface ModuleSection {
  title: string
  items: ModuleNavItem[]
  requiredRoles?: Role[]
}

export interface ModulePill {
  icon: string
  label: string
  route: string
  requiredRoles?: Role[]
}

export interface ModuleInfoCard {
  title: string
  description: string
  variant?: 'info' | 'warn' | 'success'
}

export interface ModuleAction {
  label: string
  icon?: string
  primary?: boolean
  onClick?: string
  requiredRoles?: Role[]
}

export type ModuleCategory = 'engineering' | 'system'

export interface ModuleConfig {
  key: string
  title: string
  icon: string
  shortcut: string
  routePrefix: string
  color: string
  pills?: ModulePill[]
  infoCard?: ModuleInfoCard
  sections: ModuleSection[]
  actions?: ModuleAction[]
  /** Se omitido, o módulo é visível para todos os papéis autenticados. */
  requiredRoles?: Role[]
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
export function visibleFor<T extends { requiredRoles?: Role[] }>(
  items: T[],
  role: Role | null
): T[] {
  if (!role) return items
  return items.filter((it) => !it.requiredRoles || it.requiredRoles.includes(role))
}
