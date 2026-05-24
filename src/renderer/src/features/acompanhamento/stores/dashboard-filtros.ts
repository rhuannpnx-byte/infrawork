import { create } from 'zustand'

export type PeriodoPreset = '7d' | '30d' | '90d' | 'custom'

export interface DashboardFiltros {
  periodo: PeriodoPreset
  /** Custom range — usado quando periodo='custom' */
  data_de: string | null
  data_ate: string | null
  trecho: string | null
  /** ID do item_orcamentario (servico_grupo) selecionado para drill-down */
  servico_item_id: string | null
}

interface DashboardFiltrosStore extends DashboardFiltros {
  setPeriodo: (p: PeriodoPreset) => void
  setCustomRange: (de: string | null, ate: string | null) => void
  setTrecho: (t: string | null) => void
  setServicoItem: (id: string | null) => void
  reset: () => void
}

const initial: DashboardFiltros = {
  periodo: '30d',
  data_de: null,
  data_ate: null,
  trecho: null,
  servico_item_id: null
}

export const useDashboardFiltrosStore = create<DashboardFiltrosStore>((set) => ({
  ...initial,
  setPeriodo: (p) =>
    set((s) => ({
      periodo: p,
      // mantém custom range se selecionar custom; senão limpa
      data_de: p === 'custom' ? s.data_de : null,
      data_ate: p === 'custom' ? s.data_ate : null
    })),
  setCustomRange: (de, ate) => set({ periodo: 'custom', data_de: de, data_ate: ate }),
  setTrecho: (t) => set({ trecho: t }),
  setServicoItem: (id) => set({ servico_item_id: id }),
  reset: () => set(initial)
}))

export function periodoDias(p: PeriodoPreset): number {
  switch (p) {
    case '7d': return 7
    case '30d': return 30
    case '90d': return 90
    default: return 30
  }
}
