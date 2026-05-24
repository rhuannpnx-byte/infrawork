import { create } from 'zustand'

interface SettingsStore {
  zoom: number
  setZoom: (z: number) => void
  showCriticalPath: boolean
  setShowCriticalPath: (v: boolean) => void
  defaultBdi: number
  setDefaultBdi: (v: number) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  zoom: 100,
  setZoom: (zoom) => set({ zoom }),
  showCriticalPath: true,
  setShowCriticalPath: (showCriticalPath) => set({ showCriticalPath }),
  defaultBdi: 26.5,
  setDefaultBdi: (defaultBdi) => set({ defaultBdi })
}))
