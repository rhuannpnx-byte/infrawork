import { create } from 'zustand'

interface SettingsStore {
  zoom: number
  setZoom: (z: number) => void
  showCriticalPath: boolean
  setShowCriticalPath: (v: boolean) => void
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  zoom: 100,
  setZoom: (zoom) => set({ zoom }),
  showCriticalPath: true,
  setShowCriticalPath: (showCriticalPath) => set({ showCriticalPath })
}))
