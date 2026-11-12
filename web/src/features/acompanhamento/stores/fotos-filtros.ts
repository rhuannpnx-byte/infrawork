import { create } from 'zustand'

export type FotosViewMode = 'split' | 'grid' | 'mapa'

export interface FotosFiltros {
  data_de: string | null
  data_ate: string | null
  /** item_orcamentario_id dos serviços filtrados */
  item_ids: string[]
  equipe_ids: string[]
  encarregado_ids: string[]
  frente: string | null
  somente_geo: boolean
  view_mode: FotosViewMode
}

interface FotosFiltrosStore extends FotosFiltros {
  setDataRange: (de: string | null, ate: string | null) => void
  toggleServico: (id: string) => void
  setServicos: (ids: string[]) => void
  toggleEquipe: (id: string) => void
  setEquipes: (ids: string[]) => void
  toggleEncarregado: (id: string) => void
  setEncarregados: (ids: string[]) => void
  setFrente: (f: string | null) => void
  setSomenteGeo: (v: boolean) => void
  setViewMode: (m: FotosViewMode) => void
  reset: () => void
}

const initial: FotosFiltros = {
  data_de: null,
  data_ate: null,
  item_ids: [],
  equipe_ids: [],
  encarregado_ids: [],
  frente: null,
  somente_geo: false,
  view_mode: 'split'
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export const useFotosFiltrosStore = create<FotosFiltrosStore>((set) => ({
  ...initial,
  setDataRange: (de, ate) => set({ data_de: de, data_ate: ate }),
  toggleServico: (id) => set((s) => ({ item_ids: toggle(s.item_ids, id) })),
  setServicos: (ids) => set({ item_ids: ids }),
  toggleEquipe: (id) => set((s) => ({ equipe_ids: toggle(s.equipe_ids, id) })),
  setEquipes: (ids) => set({ equipe_ids: ids }),
  toggleEncarregado: (id) => set((s) => ({ encarregado_ids: toggle(s.encarregado_ids, id) })),
  setEncarregados: (ids) => set({ encarregado_ids: ids }),
  setFrente: (f) => set({ frente: f }),
  setSomenteGeo: (v) => set({ somente_geo: v }),
  setViewMode: (m) => set({ view_mode: m }),
  reset: () => set(initial)
}))
