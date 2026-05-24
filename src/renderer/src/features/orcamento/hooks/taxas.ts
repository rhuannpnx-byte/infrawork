import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { TaxaRegime } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const TAXA_COLUNAS =
  'id, obra_id, nome, iss_perc, pis_perc, cofins_perc, csll_perc, irpj_perc, ' +
  'cprb_perc, outros_perc, total_perc_calc, vigencia_inicio, vigencia_fim, ' +
  'ativo, created_at'

export function useTaxas(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<TaxaRegime[]>> {
  return useQuery({
    queryKey: ['orcamento', 'taxas', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<TaxaRegime[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('encargos_sociais_regime')
        .select(TAXA_COLUNAS)
        .eq('obra_id', obraId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as TaxaRegime[]
    }
  })
}

/**
 * Retorna a taxa vigente da obra (ativa, com vigencia incluindo hoje, ou
 * a mais recente caso não haja explicitamente uma "ativa").
 * Usada pelo cálculo de lucro (deflator de receita).
 */
export function useTaxaVigente(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<TaxaRegime | null>> {
  return useQuery({
    queryKey: ['orcamento', 'taxa-vigente', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<TaxaRegime | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const hoje = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('encargos_sociais_regime')
        .select(TAXA_COLUNAS)
        .eq('obra_id', obraId!)
        .eq('ativo', true)
        .or(`vigencia_inicio.is.null,vigencia_inicio.lte.${hoje}`)
        .or(`vigencia_fim.is.null,vigencia_fim.gte.${hoje}`)
        .order('vigencia_inicio', { ascending: false, nullsFirst: false })
        .limit(1)
      if (error) throw error
      return ((data ?? [])[0] ?? null) as unknown as TaxaRegime | null
    }
  })
}

export interface CreateTaxaInput {
  obra_id: string
  nome: string
  iss_perc?: number
  pis_perc?: number
  cofins_perc?: number
  csll_perc?: number
  irpj_perc?: number
  cprb_perc?: number
  outros_perc?: number
  vigencia_inicio?: string
}

export function useCreateTaxa(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateTaxaInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('encargos_sociais_regime')
        .insert({
          obra_id: body.obra_id,
          nome: body.nome.trim(),
          iss_perc: body.iss_perc ?? 0,
          pis_perc: body.pis_perc ?? 0,
          cofins_perc: body.cofins_perc ?? 0,
          csll_perc: body.csll_perc ?? 0,
          irpj_perc: body.irpj_perc ?? 0,
          cprb_perc: body.cprb_perc ?? 0,
          outros_perc: body.outros_perc ?? 0,
          vigencia_inicio: body.vigencia_inicio ?? null,
          ativo: true
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'taxas', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'taxa-vigente', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade', vars.obra_id] })
    }
  })
}

export function useToggleAtivoTaxa(): ReturnType<
  typeof useMutation<void, Error, { id: string; ativo: boolean; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ativo }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('encargos_sociais_regime')
        .update({ ativo })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'taxas', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'taxa-vigente', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade', vars.obra_id] })
    }
  })
}
