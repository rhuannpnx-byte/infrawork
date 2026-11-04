import { moduleKeyForLocation, useTabsStore } from '@/stores/tabs-store'

/**
 * Navegação ciente de abas: resolve o módulo do destino e foca/cria a aba desse
 * módulo, navegando o router dela até `to`. Usado pelo chrome e pelos modais,
 * que vivem fora dos `RouterProvider` das abas.
 */
export function navigateActiveTab(to: string): void {
  const moduleKey = moduleKeyForLocation(to) ?? 'home'
  useTabsStore.getState().openModule(moduleKey, to)
}
