import type { AppRouter } from './router'

/**
 * Registro das instâncias de router vivas (uma por aba montada). O `TabPane`
 * registra o router da aba ao montar e remove ao desmontar; o chrome e a
 * tabs-store usam `getTabRouter(id)` para navegar a aba certa sem hooks de
 * router (o chrome vive fora de qualquer `RouterProvider`).
 *
 * A chave é só o `tabId`: como apenas o router do escopo (obra) atual fica
 * montado, há no máximo um router por aba registrado a cada instante.
 */
const registry = new Map<string, AppRouter>()

export function registerTabRouter(id: string, router: AppRouter): void {
  registry.set(id, router)
}

export function unregisterTabRouter(id: string, router: AppRouter): void {
  if (registry.get(id) === router) registry.delete(id)
}

export function getTabRouter(id: string): AppRouter | undefined {
  return registry.get(id)
}
