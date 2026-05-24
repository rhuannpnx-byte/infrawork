/**
 * Wrapper around the Electron preload bridge.
 * Safe to call even when not running inside Electron (no-op).
 */

interface WindowBridge {
  openNew: (route: string) => Promise<void>
  minimize: () => void
  maximize: () => void
  close: () => void
}

interface SettingsBridge {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

function api(): { window: WindowBridge; settings: SettingsBridge } | null {
  if (typeof window === 'undefined') return null
  return (window.infrawork ?? null) as { window: WindowBridge; settings: SettingsBridge } | null
}

export const desktopWindow: WindowBridge = {
  openNew: async (route) => api()?.window.openNew(route) ?? Promise.resolve(),
  minimize: () => api()?.window.minimize(),
  maximize: () => api()?.window.maximize(),
  close: () => api()?.window.close()
}

export const desktopSettings: SettingsBridge = {
  get: async (key) => api()?.settings.get(key) ?? undefined,
  set: async (key, value) => api()?.settings.set(key, value) ?? Promise.resolve()
}
