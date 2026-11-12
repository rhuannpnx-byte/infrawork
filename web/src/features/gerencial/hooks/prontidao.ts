import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

export type SituacaoEtapa = 'ok' | 'pendente' | 'aviso' | 'opcional'

export interface ItemPendente {
  id: string
  codigo?: string
  descricao: string
  planejado?: number
  orcado?: number
}

export interface EtapaProntidao {
  chave: string
  titulo: string
  situacao: SituacaoEtapa
  resumo: string
  rota: string
  itens: ItemPendente[]
}

export interface ProntidaoObra {
  etapas: EtapaProntidao[]
  pendentes: number
  avisos: number
}

/** O que falta para a obra ter previsto e realizado (obra_prontidao). Sempre relido ao abrir a tela. */
export function useProntidaoObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ProntidaoObra>> {
  return useQuery({
    queryKey: ['prontidao', obraId],
    enabled: !!obraId,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('obra_prontidao', { _obra_id: obraId! })
      if (error) throw error
      return data as ProntidaoObra
    }
  })
}
