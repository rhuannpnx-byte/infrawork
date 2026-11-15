import { create } from 'zustand'
import { storageKey } from '@/lib/storage-keys'

export type ModalKey = 'commandPalette' | 'projectSwitcher' | 'export' | 'settings' | 'shortcuts'

/** Preferência da barra de módulos: sempre aberta, sempre só ícones ou abre ao passar o mouse (padrão). */
export type ModoBarra = 'expandida' | 'recolhida' | 'hover'

interface UIStore {
  modoBarra: ModoBarra
  setModoBarra: (modo: ModoBarra) => void

  /** Gaveta do menu em tela estreita (celular). */
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

const CHAVE_MODO_BARRA = storageKey('ui.modoBarra')

function lerModoBarra(): ModoBarra {
  try {
    const v = window.localStorage.getItem(CHAVE_MODO_BARRA)
    return v === 'expandida' || v === 'recolhida' ? v : 'hover'
  } catch {
    return 'hover'
  }
}
// A mesma chave de public/theme-boot.js, que aplica a densidade antes da primeira pintura.
const CHAVE_DENSIDADE = 'infrawork.ui.density'

function lerDensidade(): 'compact' | 'normal' {
  try {
    return window.localStorage.getItem(CHAVE_DENSIDADE) === 'compact' ? 'compact' : 'normal'
  } catch {
    return 'normal'
  }
}

function aplicarDensidade(d: 'compact' | 'normal'): void {
  if (d === 'compact') document.documentElement.dataset.density = 'compact'
  else delete document.documentElement.dataset.density
}

export const useUIStore = create<UIStore>((set) => ({
  modoBarra: lerModoBarra(),
  setModoBarra: (modo) => {
    try {
      window.localStorage.setItem(CHAVE_MODO_BARRA, modo)
    } catch {
      // sem armazenamento: vale só para esta sessão
    }
    set({ modoBarra: modo })
  },

  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

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

  density: lerDensidade(),
  setDensity: (density) => {
    try {
      window.localStorage.setItem(CHAVE_DENSIDADE, density)
    } catch {
      // sem armazenamento: vale só para esta sessão
    }
    aplicarDensidade(density)
    set({ density })
  }
}))
