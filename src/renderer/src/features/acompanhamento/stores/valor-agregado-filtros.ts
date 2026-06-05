import { create } from 'zustand'

// Filtros da subpage "Valor Agregado". Default (janela efetiva) = mês atual,
// mas o range é guardado "cru" (pode ficar incompleto durante a seleção no
// DateRangePopover, que faz pick em 2 passos: from→null, depois from→to).

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** [1º dia do mês atual, hoje] em ISO (YYYY-MM-DD). */
export function mesAtualRange(hoje: Date = new Date()): { de: string; ate: string } {
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
  return { de: iso(ini), ate: iso(hoje) }
}

export interface ValorAgregadoFiltros {
  /** Início cru (null = não selecionado → cai no mês atual). */
  data_de: string | null
  /** Fim cru (null = não selecionado → cai no mês atual). */
  data_ate: string | null
  /** ID do item_orcamentario (servico_grupo) — null = todos. */
  servico_item_id: string | null
}

interface ValorAgregadoFiltrosStore extends ValorAgregadoFiltros {
  setRange: (de: string | null, ate: string | null) => void
  setServicoItem: (id: string | null) => void
  reset: () => void
}

const initial: ValorAgregadoFiltros = {
  data_de: null,
  data_ate: null,
  servico_item_id: null
}

export const useValorAgregadoFiltrosStore = create<ValorAgregadoFiltrosStore>((set) => ({
  ...initial,
  // Seta o range cru como veio (inclusive nulls do passo intermediário do picker).
  setRange: (de, ate) => set({ data_de: de, data_ate: ate }),
  setServicoItem: (id) => set({ servico_item_id: id }),
  reset: () => set(initial)
}))

/** Janela efetiva usada nas queries: range completo OU mês atual (default). */
export function janelaEfetiva(de: string | null, ate: string | null): { de: string; ate: string } {
  if (de && ate) return { de, ate }
  return mesAtualRange()
}
