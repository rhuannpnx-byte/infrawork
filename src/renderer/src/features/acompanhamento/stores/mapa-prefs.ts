// Preferências de exibição do mapa de Fotos & Mapa. Persistidas por usuário
// (localStorage) — valem até o usuário mudar e são respeitadas tanto na página
// dedicada quanto no mini-mapa do dashboard.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CorPorMapa = 'equipe' | 'servico'

export interface MapaPrefs {
  // Camadas base (tiles Esri)
  camadaSatelite: boolean
  camadaFronteiras: boolean
  camadaRodovias: boolean
  // Camadas de dados
  mostrarFotos: boolean
  mostrarKmzTrechos: boolean
  mostrarSequenciaAtaque: boolean
  mostrarLegenda: boolean
  // Cor dos marcadores de foto
  corPor: CorPorMapa
}

interface MapaPrefsStore extends MapaPrefs {
  set: <K extends keyof MapaPrefs>(key: K, value: MapaPrefs[K]) => void
  toggle: (key: keyof Omit<MapaPrefs, 'corPor'>) => void
  reset: () => void
}

export const MAPA_PREFS_PADRAO: MapaPrefs = {
  camadaSatelite: true,
  camadaFronteiras: true,
  camadaRodovias: true,
  mostrarFotos: true,
  mostrarKmzTrechos: true,
  mostrarSequenciaAtaque: false,
  mostrarLegenda: true,
  corPor: 'equipe'
}

export const useMapaPrefsStore = create<MapaPrefsStore>()(
  persist(
    (set) => ({
      ...MAPA_PREFS_PADRAO,
      set: (key, value) => set({ [key]: value } as Partial<MapaPrefs>),
      toggle: (key) => set((s) => ({ [key]: !s[key] } as Partial<MapaPrefs>)),
      reset: () => set({ ...MAPA_PREFS_PADRAO })
    }),
    {
      name: 'infrawork.mapa-prefs',
      // Persiste só os dados, não as funções.
      partialize: (s): MapaPrefs => ({
        camadaSatelite: s.camadaSatelite,
        camadaFronteiras: s.camadaFronteiras,
        camadaRodovias: s.camadaRodovias,
        mostrarFotos: s.mostrarFotos,
        mostrarKmzTrechos: s.mostrarKmzTrechos,
        mostrarSequenciaAtaque: s.mostrarSequenciaAtaque,
        mostrarLegenda: s.mostrarLegenda,
        corPor: s.corPor
      })
    }
  )
)
