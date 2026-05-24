import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type {
  ObraCalendario,
  ObraCalendarioExcecao,
  ObraProdutividadeMes
} from '@/types/planejamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

// ─── obra_calendario ────────────────────────────────────────────────────
export function useCalendario(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ObraCalendario | null>> {
  return useQuery({
    queryKey: ['planejamento', 'calendario', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<ObraCalendario | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obra_calendario')
        .select('*')
        .eq('obra_id', obraId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as ObraCalendario | null
    }
  })
}

export function useUpdateCalendarioBitmask(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; bitmask: number }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, bitmask }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('obra_calendario')
        .upsert({ obra_id, dias_uteis_bitmask: bitmask }, { onConflict: 'obra_id' })
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'calendario', vars.obra_id] })
    }
  })
}

// ─── obra_calendario_excecao ───────────────────────────────────────────
export function useExcecoes(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ObraCalendarioExcecao[]>> {
  return useQuery({
    queryKey: ['planejamento', 'excecoes', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<ObraCalendarioExcecao[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obra_calendario_excecao')
        .select('*')
        .eq('obra_id', obraId!)
        .order('data', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as ObraCalendarioExcecao[]
    }
  })
}

export interface UpsertExcecaoInput {
  obra_id: string
  data: string
  motivo: string
  eh_util: boolean
}

export function useUpsertExcecao(): ReturnType<
  typeof useMutation<void, Error, UpsertExcecaoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('obra_calendario_excecao')
        .upsert(body, { onConflict: 'obra_id,data' })
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'excecoes', vars.obra_id] })
    }
  })
}

export function useDeleteExcecao(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('obra_calendario_excecao').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'excecoes', vars.obra_id] })
    }
  })
}

// ─── obra_produtividade_mes ────────────────────────────────────────────
export function useFatoresMes(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ObraProdutividadeMes[]>> {
  return useQuery({
    queryKey: ['planejamento', 'fatores-mes', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<ObraProdutividadeMes[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obra_produtividade_mes')
        .select('*')
        .eq('obra_id', obraId!)
        .order('ano_mes', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as ObraProdutividadeMes[]
    }
  })
}

export interface UpsertFatorMesInput {
  obra_id: string
  ano_mes: string
  fator: number
  motivo?: string | null
}

export function useUpsertFatorMes(): ReturnType<
  typeof useMutation<void, Error, UpsertFatorMesInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('obra_produtividade_mes')
        .upsert(
          {
            obra_id: body.obra_id,
            ano_mes: body.ano_mes,
            fator: body.fator,
            motivo: body.motivo ?? null
          },
          { onConflict: 'obra_id,ano_mes' }
        )
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'fatores-mes', vars.obra_id] })
    }
  })
}

export function useDeleteFatorMes(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; ano_mes: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, ano_mes }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('obra_produtividade_mes')
        .delete()
        .eq('obra_id', obra_id)
        .eq('ano_mes', ano_mes)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'fatores-mes', vars.obra_id] })
    }
  })
}
