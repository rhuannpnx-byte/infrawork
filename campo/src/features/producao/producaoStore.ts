import { create } from 'zustand'
import type { ServicoDto } from '@/types/dtos'
import { uuidv7 } from '@/lib/uuidv7'
import { hojeLocal } from '@/lib/datas'

/**
 * Sessão de produção em construção (Setup → Session): dia, encarregado, equipe e os apontamentos (um por serviço).
 * Quem persiste é o outbox (`out_producao`) ao finalizar.
 */
export interface ApontamentoDraft {
  id: string // uuid — vira o app_uuid no servidor
  servico: ServicoDto
  qtd: number | null
  localId: string | null
  localNome: string | null
  estacaInicial: string
  estacaFinal: string
  posicaoInicioM: number | null
  posicaoFimM: number | null
  materialQtd: number | null
  obs: string | null
}

export interface ProducaoSessionState {
  obraId: string | null
  obraCodigo: string
  dt: string
  equipeId: string | null
  equipeNome: string | null
  encarregadoId: string | null
  encarregadoNome: string | null
  itens: ApontamentoDraft[]
}

interface ProducaoStore extends ProducaoSessionState {
  setObra: (id: string, codigo: string) => void
  setEncarregado: (id: string | null, nome: string | null) => void
  setEquipe: (id: string | null, nome: string | null) => void
  setDt: (dt: string) => void
  setItens: (itens: ApontamentoDraft[]) => void
  addOrUpdateItem: (item: ApontamentoDraft) => void
  removeItem: (id: string) => void
  reset: () => void
}

const initial = (): ProducaoSessionState => ({
  obraId: null,
  obraCodigo: '',
  dt: hojeLocal(),
  equipeId: null,
  equipeNome: null,
  encarregadoId: null,
  encarregadoNome: null,
  itens: [],
})

export const useProducaoStore = create<ProducaoStore>((set) => ({
  ...initial(),
  setObra: (id, codigo) =>
    set((s) =>
      s.obraId === id
        ? { obraCodigo: codigo }
        : {
            obraId: id,
            obraCodigo: codigo,
            equipeId: null,
            equipeNome: null,
            encarregadoId: null,
            encarregadoNome: null,
          },
    ),
  setEncarregado: (id, nome) => set({ encarregadoId: id, encarregadoNome: nome }),
  setEquipe: (id, nome) => set({ equipeId: id, equipeNome: nome }),
  setDt: (dt) => set({ dt }),
  setItens: (itens) => set({ itens }),
  addOrUpdateItem: (item) =>
    set((s) => {
      const i = s.itens.findIndex((x) => x.id === item.id)
      if (i < 0) return { itens: [...s.itens, item] }
      const next = s.itens.slice()
      next[i] = item
      return { itens: next }
    }),
  removeItem: (id) => set((s) => ({ itens: s.itens.filter((i) => i.id !== id) })),
  reset: () => set(initial()),
}))

export function novoApontamento(servico: ServicoDto): ApontamentoDraft {
  return {
    id: uuidv7(),
    servico,
    qtd: null,
    localId: null,
    localNome: null,
    estacaInicial: '',
    estacaFinal: '',
    posicaoInicioM: null,
    posicaoFimM: null,
    materialQtd: null,
    obs: null,
  }
}
