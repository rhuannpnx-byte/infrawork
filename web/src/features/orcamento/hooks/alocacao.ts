import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { invalidarCadeia } from '@/lib/query/cadeia'
import { supabase } from '@/lib/supabase/client'
import type { CriterioRateio } from '@/types/orcamento'

function invalidar(qc: QueryClient, _obraId: string): void {
  invalidarCadeia(qc)
}

/** Cria um serviço (agrupador) vazio — o vínculo com a composição vem depois. */
export function useCriarServico(): ReturnType<
  typeof useMutation<{ id: string; codigo: string }, Error, { obra_id: string; descricao: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, descricao }) => {
      const { data, error } = await supabase
        .from('item_orcamentario')
        .insert({
          obra_id,
          tipo: 'servico_grupo',
          descricao: descricao.trim(),
          qtd_ref_modo: 'soma_filhos',
          quantidade_referencia: 0
        })
        .select('id, codigo')
        .single()
      if (error) throw error
      return { id: data.id as string, codigo: data.codigo as string }
    },
    onSuccess: (_d, v) => invalidar(qc, v.obra_id)
  })
}

/** Exclui um serviço. As receitas dele ficam livres (saldo/sem agrupamento). */
export function useExcluirServico(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('item_orcamentario').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidar(qc, v.obra_id)
  })
}

/** Aloca receitas a um serviço: 100% ou o saldo de um rateio percentual. */
export function useAlocarReceitas(): ReturnType<
  typeof useMutation<
    { alocadas: number; avisos: string[] },
    Error,
    { obra_id: string; grupo_id: string; receita_ids: string[] }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ grupo_id, receita_ids }) => {
      const { data, error } = await supabase.rpc('alocar_receitas', {
        _grupo_id: grupo_id,
        _receita_ids: receita_ids
      })
      if (error) throw error
      const r = data as { alocadas: number; avisos: string[] | null }
      return { alocadas: r.alocadas, avisos: r.avisos ?? [] }
    },
    onSuccess: (_d, v) => invalidar(qc, v.obra_id)
  })
}

export interface DestinoRateio {
  grupo_id: string
  /** percentual: %; peso: quantidade física; venda: null. */
  valor: number | null
  compoe_qtd: boolean
}

/** Substitui todas as alocações de uma receita pelo rateio informado. */
export function useSalvarRateio(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { obra_id: string; receita_id: string; criterio: CriterioRateio; destinos: DestinoRateio[] }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ receita_id, criterio, destinos }) => {
      const { error } = await supabase.rpc('salvar_rateio_receita', {
        _receita_id: receita_id,
        _criterio: criterio,
        _destinos: destinos
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidar(qc, v.obra_id)
  })
}

/** Remove alocações (por id). */
export function useRemoverAlocacoes(): ReturnType<
  typeof useMutation<number, Error, { obra_id: string; ids: string[] }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids }) => {
      const { data, error } = await supabase.rpc('remover_alocacoes', { _ids: ids })
      if (error) throw error
      return Number(data ?? 0)
    },
    onSuccess: (_d, v) => invalidar(qc, v.obra_id)
  })
}

/** Liga/desliga "compõe a quantidade" de uma alocação. */
export function useSetCompoe(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; id: string; compoe: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, compoe }) => {
      const { error } = await supabase.rpc('set_alocacao_compoe', { _id: id, _compoe: compoe })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidar(qc, v.obra_id)
  })
}
