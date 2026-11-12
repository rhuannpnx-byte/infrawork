import { create } from 'zustand'
import { storageKey } from '@/lib/storage-keys'

export type ModalKey = 'commandPalette' | 'projectSwitcher' | 'export' | 'settings' | 'shortcuts'

interface UIStore {
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void

  activeModals: Set<ModalKey>
  openModal: (key: ModalKey, payload?: unknown) => void
  closeModal: (key: ModalKey) => void
  modalPayload: Record<string, unknown>

  density: 'compact' | 'normal'
  setDensity: (d: 'compact' | 'normal') => void
}

const SIDEBAR_KEY = storageKey('ui.sidebarOpen')

function readSidebarPref(): boolean {
  if (typeof window === 'undefined') return true
  const v = window.localStorage.getItem(SIDEBAR_KEY)
  return v === null ? true : v === '1'
}

function writeSidebarPref(open: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0')
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: readSidebarPref(),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarOpen
      writeSidebarPref(next)
      return { sidebarOpen: next }
    }),
  setSidebarOpen: (open) => {
    writeSidebarPref(open)
    set({ sidebarOpen: open })
  },

  activeModals: new Set<ModalKey>(),
  modalPayload: {},

  openModal: (key, payload) =>
    set((s) => {
      const next = new Set(s.activeModals)
      next.add(key)
      return {
        activeModals: next,
        modalPayload: payload !== undefined ? { ...s.modalPayload, [key]: payload } : s.modalPayload
      }
    }),

  closeModal: (key) =>
    set((s) => {
      const next = new Set(s.activeModals)
      next.delete(key)
      return { activeModals: next }
    }),

  density: 'normal',
  setDensity: (density) => set({ density })
}))
