import { create } from 'zustand'
import type { FichaCabecalho, ViagemLocal } from '@/core/db/entities'
import { uuidv7 } from '@/lib/uuidv7'
import { hojeLocal } from '@/lib/datas'

/**
 * Ficha de viagens em edição (cabeçalho do caminhão no dia + viagens). Várias fichas podem ficar em andamento: cada
 * mudança é salva como rascunho no Dexie (draftCarreteiroRepo) e a ficha sobrevive a recarregar o app.
 */
export interface FichaEmEdicao extends FichaCabecalho {
  viagens: ViagemLocal[]
}

interface CarreteiroStore {
  ficha: FichaEmEdicao | null
  nova: (obraId: string, obraCodigo: string) => void
  abrir: (f: FichaEmEdicao) => void
  setCabecalho: (patch: Partial<FichaCabecalho>) => void
  salvarViagem: (v: ViagemLocal) => void
  removerViagem: (id: string) => void
  fechar: () => void
}

export const useCarreteiroStore = create<CarreteiroStore>((set) => ({
  ficha: null,
  nova: (obraId, obraCodigo) =>
    set({
      ficha: {
        id: uuidv7(),
        obraId,
        obraCodigo,
        dt: hojeLocal(),
        veiculoId: null,
        veiculoNome: null,
        motorista: null,
        encarregadoId: null,
        encarregadoNome: null,
        equipeId: null,
        equipeNome: null,
        kmInicial: null,
        kmFinal: null,
        obs: null,
        viagens: [],
      },
    }),
  abrir: (f) => set({ ficha: { ...f, viagens: f.viagens.slice() } }),
  setCabecalho: (patch) => set((s) => (s.ficha ? { ficha: { ...s.ficha, ...patch } } : {})),
  salvarViagem: (v) =>
    set((s) => {
      if (!s.ficha) return {}
      const i = s.ficha.viagens.findIndex((x) => x.id === v.id)
      const viagens = s.ficha.viagens.slice()
      if (i < 0) viagens.push(v)
      else viagens[i] = v
      return { ficha: { ...s.ficha, viagens } }
    }),
  removerViagem: (id) =>
    set((s) =>
      s.ficha ? { ficha: { ...s.ficha, viagens: s.ficha.viagens.filter((v) => v.id !== id) } } : {},
    ),
  fechar: () => set({ ficha: null }),
}))
