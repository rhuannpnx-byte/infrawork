import { create } from 'zustand'
import { getModuleByKey, getModuleByRoute } from '@/config/modules'
import { getTabRouter } from '@/app/tab-routers'

/**
 * Aba de documento (estilo VSCode), com keep-alive: uma aba por módulo, cada
 * uma com sua própria instância de router (history em memória). Alternar entre
 * abas apenas troca a visibilidade — o estado de cada aba (rota, zoom, mapa,
 * rolagem) é preservado porque a árvore continua montada.
 */
export interface DocumentTab {
  id: string
  moduleKey: string // 'home' | 'gerencial' | 'orcamento' | 'planejamento' | 'acompanhamento'
  title: string
  icon: string
  location: string // pathname (+search) — posição viva da aba
  pinned?: boolean // Home é fixa / não-fechável
}

interface TabsStore {
  tabs: DocumentTab[]
  activeTabId: string | null
  /** Abas já ativadas pelo menos uma vez → montadas e mantidas vivas (keep-alive). */
  mountedTabIds: string[]
  recentlyClosed: DocumentTab[]

  /** Foca a aba do módulo (preservando seu estado) ou cria uma nova. Se `to` for
   *  passado (deep link), navega o router da aba até lá. */
  openModule: (moduleKey: string, to?: string) => void
  setActive: (id: string) => void
  /** Atualiza a localização lembrada de uma aba (chamado pelo router da aba). */
  setTabLocation: (id: string, location: string) => void
  closeTab: (id: string) => void
  reorderTabs: (from: number, to: number) => void
  reopenLastClosed: () => void
  cycleActive: (delta: number) => void
}

const HOME_TAB_ID = 'tab-home'

let counter = 0
const genId = (): string => `tab-${Date.now()}-${counter++}`

const addId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids : [...ids, id])

function homeTab(): DocumentTab {
  return {
    id: HOME_TAB_ID,
    moduleKey: 'home',
    title: 'Início',
    icon: 'home',
    location: '/',
    pinned: true
  }
}

/** Localização padrão (landing) de um módulo. */
function defaultLocation(moduleKey: string): string {
  if (moduleKey === 'home') return '/'
  return getModuleByKey(moduleKey)?.routePrefix ?? '/'
}

function tabMeta(moduleKey: string): { title: string; icon: string } {
  if (moduleKey === 'home') return { title: 'Início', icon: 'home' }
  const mod = getModuleByKey(moduleKey)
  return { title: mod?.title ?? moduleKey, icon: mod?.icon ?? 'square' }
}

/** Resolve o módulo de uma localização (rota). 'home' para '/'. */
export function moduleKeyForLocation(pathname: string): string | undefined {
  if (pathname === '/') return 'home'
  return getModuleByRoute(pathname)?.key
}

// ─── Persistência (localStorage), no padrão do ui-store ────────────────────
const STORAGE_KEY = 'infrawork.tabs.state'

interface PersistedState {
  tabs: DocumentTab[]
  activeTabId: string | null
}

function loadPersisted(): PersistedState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedState
    if (!parsed || !Array.isArray(parsed.tabs)) return null
    return parsed
  } catch {
    return null
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(state: PersistedState): void {
  if (typeof window === 'undefined') return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* quota/serialização — ignora */
    }
  }, 250)
}

/** Garante a aba Home no índice 0. */
function withHome(tabs: DocumentTab[]): DocumentTab[] {
  if (tabs.some((t) => t.moduleKey === 'home')) return tabs
  return [homeTab(), ...tabs]
}

function initialState(): Pick<TabsStore, 'tabs' | 'activeTabId' | 'mountedTabIds'> {
  const persisted = loadPersisted()
  if (persisted) {
    const tabs = withHome(persisted.tabs)
    const activeTabId = tabs.find((t) => t.id === persisted.activeTabId)?.id ?? tabs[0]?.id ?? null
    // Lazy: no boot só a aba ativa é montada; as demais montam ao serem ativadas.
    return { tabs, activeTabId, mountedTabIds: activeTabId ? [activeTabId] : [] }
  }
  const tabs = [homeTab()]
  return { tabs, activeTabId: tabs[0].id, mountedTabIds: [tabs[0].id] }
}

export const useTabsStore = create<TabsStore>((set, get) => {
  const persist = (): void => {
    const { tabs, activeTabId } = get()
    schedulePersist({ tabs, activeTabId })
  }

  return {
    ...initialState(),
    recentlyClosed: [],

    openModule: (moduleKey, to) => {
      const existing = get().tabs.find((t) => t.moduleKey === moduleKey)
      if (existing) {
        if (to && to !== existing.location) {
          const router = getTabRouter(existing.id)
          if (router) {
            void router.navigate({ to })
          } else {
            // Aba ainda não montada: semeia a localização para o router inicial.
            set((s) => ({
              tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, location: to } : t))
            }))
          }
        }
        set((s) => ({
          activeTabId: existing.id,
          mountedTabIds: addId(s.mountedTabIds, existing.id)
        }))
        persist()
        return
      }
      const location = to ?? defaultLocation(moduleKey)
      const meta = tabMeta(moduleKey)
      const newTab: DocumentTab = {
        id: moduleKey === 'home' ? HOME_TAB_ID : genId(),
        moduleKey,
        title: meta.title,
        icon: meta.icon,
        location,
        pinned: moduleKey === 'home'
      }
      set((s) => ({
        tabs: [...s.tabs, newTab],
        activeTabId: newTab.id,
        mountedTabIds: addId(s.mountedTabIds, newTab.id)
      }))
      persist()
    },

    setActive: (id) => {
      set((s) => ({ activeTabId: id, mountedTabIds: addId(s.mountedTabIds, id) }))
      persist()
    },

    setTabLocation: (id, location) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || tab.location === location) return
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, location } : t)) }))
      persist()
    },

    closeTab: (id) => {
      const state = get()
      const idx = state.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return
      const closed = state.tabs[idx]
      if (closed.pinned) return // Home não fecha
      const remaining = state.tabs.filter((t) => t.id !== id)
      const wasActive = state.activeTabId === id
      const nextActiveId = wasActive
        ? (remaining[Math.min(idx, remaining.length - 1)]?.id ?? null)
        : state.activeTabId
      let mounted = state.mountedTabIds.filter((x) => x !== id)
      if (nextActiveId) mounted = addId(mounted, nextActiveId)
      set({
        tabs: remaining,
        activeTabId: nextActiveId,
        mountedTabIds: mounted,
        recentlyClosed: [closed, ...state.recentlyClosed].slice(0, 10)
      })
      persist()
    },

    reorderTabs: (from, to) => {
      set((s) => {
        const tabs = [...s.tabs]
        const [m] = tabs.splice(from, 1)
        tabs.splice(to, 0, m)
        return { tabs }
      })
      persist()
    },

    reopenLastClosed: () => {
      const [first, ...rest] = get().recentlyClosed
      if (!first) return
      set((s) => ({
        tabs: [...s.tabs, first],
        activeTabId: first.id,
        mountedTabIds: addId(s.mountedTabIds, first.id),
        recentlyClosed: rest
      }))
      persist()
    },

    cycleActive: (delta) => {
      const { tabs, activeTabId } = get()
      if (tabs.length === 0) return
      const i = Math.max(
        0,
        tabs.findIndex((t) => t.id === activeTabId)
      )
      const id = tabs[(i + delta + tabs.length) % tabs.length].id
      set((s) => ({ activeTabId: id, mountedTabIds: addId(s.mountedTabIds, id) }))
      persist()
    }
  }
})

/** Aba ativa (objeto), para o chrome derivar layout/realce sem hooks de router. */
export function useActiveTab(): DocumentTab | undefined {
  return useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
}

/** Localização viva da aba ativa (para realce de itens na sidebar). */
export function useActiveLocation(): string {
  return useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.location ?? '/')
}
