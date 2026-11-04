/**
 * Prefixo único das chaves de localStorage/sessão do app. Configurável por
 * build (`VITE_STORAGE_PREFIX`) para que dois produtos whitelabel no mesmo
 * domínio não colidam.
 */
export const APP_KEY: string = import.meta.env.VITE_STORAGE_PREFIX || 'infrawork'

export function storageKey(suffix: string): string {
  return `${APP_KEY}.${suffix}`
}
