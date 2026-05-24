import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type { Planejamento, PlanejamentoStatus } from '@/types/planejamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const COLUNAS =
  'id, obra_id, nome, descricao, is_baseline, status, data_referencia_inicio, ' +
  'criado_por, created_at, updated_at'

export function usePlanejamentos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Planejamento[]>> {
  return useQuery({
    queryKey: ['planejamento', 'lista', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Planejamento[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .select(COLUNAS)
        .eq('obra_id', obraId!)
        .order('is_baseline', { ascending: false })
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Planejamento[]
    }
  })
}

/** Último planejamento não-arquivado (mais recente). */
export function usePlanejamentoAtivo(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Planejamento | null>> {
  return useQuery({
    queryKey: ['planejamento', 'ativo', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Planejamento | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .select(COLUNAS)
        .eq('obra_id', obraId!)
        .neq('status', 'arquivado')
        .order('updated_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return ((data ?? [])[0] ?? null) as unknown as Planejamento | null
    }
  })
}

export function useBaseline(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Planejamento | null>> {
  return useQuery({
    queryKey: ['planejamento', 'baseline', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Planejamento | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .select(COLUNAS)
        .eq('obra_id', obraId!)
        .eq('is_baseline', true)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as Planejamento | null
    }
  })
}

export interface CreatePlanejamentoInput {
  obra_id: string
  nome: string
  descricao?: string
  data_referencia_inicio: string
}

export function useCreatePlanejamento(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreatePlanejamentoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento')
        .insert({
          obra_id: body.obra_id,
          nome: body.nome.trim(),
          descricao: body.descricao?.trim() || null,
          data_referencia_inicio: body.data_referencia_inicio,
          status: 'ativo'
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'lista', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'ativo', vars.obra_id] })
    }
  })
}

export interface UpdatePlanejamentoInput {
  id: string
  obra_id: string
  nome?: string
  descricao?: string | null
  status?: PlanejamentoStatus
  data_referencia_inicio?: string
}

export function useUpdatePlanejamento(): ReturnType<
  typeof useMutation<void, Error, UpdatePlanejamentoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, obra_id: _o, ...rest }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento').update(rest).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'lista', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'ativo', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'baseline', vars.obra_id] })
    }
  })
}

export function useDeletePlanejamento(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'lista', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'ativo', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'baseline', vars.obra_id] })
    }
  })
}

export function useCopiarPlanejamento(): ReturnType<
  typeof useMutation<
    { novo_id: string; tarefas_copiadas: number },
    Error,
    { origem_id: string; nome_novo: string; ajuste_data_inicio?: string; obra_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ origem_id, nome_novo, ajuste_data_inicio }) =>
      adminApi.copiarPlanejamento({ origem_id, nome_novo, ajuste_data_inicio }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'lista', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'ativo', vars.obra_id] })
    }
  })
}

export function usePromoverBaseline(): ReturnType<
  typeof useMutation<
    { baseline_id: string; snapshot_id: string },
    Error,
    { planejamento_id: string; obra_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planejamento_id }) =>
      adminApi.promoverBaseline({ planejamento_id }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'lista', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'baseline', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'ativo', vars.obra_id] })
    }
  })
}
