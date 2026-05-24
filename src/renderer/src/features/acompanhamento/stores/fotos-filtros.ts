import { create } from 'zustand'

export type FotosViewMode = 'split' | 'grid' | 'mapa'

export interface FotosFiltros {
  data_de: string | null
  data_ate: string | null
  servico_ids: number[]
  equipe_match_ids: string[]
  encarregado_nomes: string[]
  frente: string | null
  somente_geo: boolean
  view_mode: FotosViewMode
  /** índice do dia ativo no slider temporal — null = "todos" */
  dia_slider_idx: number | null
  foto_selecionada_id: string | null
}

interface FotosFiltrosStore extends FotosFiltros {
  setDataRange: (de: string | null, ate: string | null) => void
  toggleServico: (id: number) => void
  setServicos: (ids: number[]) => void
  toggleEquipe: (id: string) => void
  setEquipes: (ids: string[]) => void
  toggleEncarregado: (nome: string) => void
  setEncarregados: (nomes: string[]) => void
  setFrente: (f: string | null) => void
  setSomenteGeo: (v: boolean) => void
  setViewMode: (m: FotosViewMode) => void
  setDiaSliderIdx: (i: number | null) => void
  setFotoSelecionada: (id: string | null) => void
  reset: () => void
}

const initial: FotosFiltros = {
  data_de: null,
  data_ate: null,
  servico_ids: [],
  equipe_match_ids: [],
  encarregado_nomes: [],
  frente: null,
  somente_geo: false,
  view_mode: 'split',
  dia_slider_idx: null,
  foto_selecionada_id: null
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export const useFotosFiltrosStore = create<FotosFiltrosStore>((set) => ({
  ...initial,
  setDataRange: (de, ate) => set({ data_de: de, data_ate: ate }),
  toggleServico: (id) => set((s) => ({ servico_ids: toggle(s.servico_ids, id) })),
  setServicos: (ids) => set({ servico_ids: ids }),
  toggleEquipe: (id) => set((s) => ({ equipe_match_ids: toggle(s.equipe_match_ids, id) })),
  setEquipes: (ids) => set({ equipe_match_ids: ids }),
  toggleEncarregado: (nome) => set((s) => ({ encarregado_nomes: toggle(s.encarregado_nomes, nome) })),
  setEncarregados: (nomes) => set({ encarregado_nomes: nomes }),
  setFrente: (f) => set({ frente: f }),
  setSomenteGeo: (v) => set({ somente_geo: v }),
  setViewMode: (m) => set({ view_mode: m }),
  setDiaSliderIdx: (i) => set({ dia_slider_idx: i }),
  setFotoSelecionada: (id) => set({ foto_selecionada_id: id }),
  reset: () => set(initial)
}))
