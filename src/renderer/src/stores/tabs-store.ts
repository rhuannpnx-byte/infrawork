import { create } from 'zustand'

export interface DocumentTab {
  id: string
  title: string
  icon: string
  route: string
  entityType?: 'composicao' | 'tarefa' | 'insumo' | 'rdo' | 'bm' | 'fornecedor'
  entityId?: string
}

interface TabsStore {
  tabs: DocumentTab[]
  activeTabId: string | null
  recentlyClosed: DocumentTab[]
  openTab: (tab: Omit<DocumentTab, 'id'> | DocumentTab) => string
  closeTab: (id: string) => void
  setActive: (id: string) => void
  reorderTabs: (from: number, to: number) => void
  reopenLastClosed: () => void
  cycleActive: (delta: number) => void
}

let counter = 0
const genId = (): string => `tab-${Date.now()}-${counter++}`

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  recentlyClosed: [],

  openTab: (tab) => {
    const existing = get().tabs.find((t) => t.route === tab.route)
    if (existing) {
      set({ activeTabId: existing.id })
      return existing.id
    }
    const newTab: DocumentTab = { ...(tab as DocumentTab), id: (tab as DocumentTab).id ?? genId() }
    set((s) => ({ tabs: [...s.tabs, newTab], activeTabId: newTab.id }))
    return newTab.id
  },

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const closed = s.tabs[idx]
      const remaining = s.tabs.filter((t) => t.id !== id)
      const wasActive = s.activeTabId === id
      const nextActive = wasActive
        ? remaining[Math.min(idx, remaining.length - 1)]?.id ?? null
        : s.activeTabId
      return {
        tabs: remaining,
        activeTabId: nextActive,
        recentlyClosed: [closed, ...s.recentlyClosed].slice(0, 10)
      }
    }),

  setActive: (id) => set({ activeTabId: id }),

  reorderTabs: (from, to) =>
    set((s) => {
      const tabs = [...s.tabs]
      const [m] = tabs.splice(from, 1)
      tabs.splice(to, 0, m)
      return { tabs }
    }),

  reopenLastClosed: () =>
    set((s) => {
      const [first, ...rest] = s.recentlyClosed
      if (!first) return s
      return {
        tabs: [...s.tabs, first],
        activeTabId: first.id,
        recentlyClosed: rest
      }
    }),

  cycleActive: (delta) => {
    const { tabs, activeTabId } = get()
    if (tabs.length === 0) return
    const i = Math.max(0, tabs.findIndex((t) => t.id === activeTabId))
    const next = (i + delta + tabs.length) % tabs.length
    set({ activeTabId: tabs[next].id })
  }
}))
