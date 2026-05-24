import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { DependenciaTipo, PlanejamentoDependencia } from '@/types/planejamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export function useDependencias(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<PlanejamentoDependencia[]>> {
  return useQuery({
    queryKey: ['planejamento', 'dependencias', planejamentoId],
    enabled: !!planejamentoId,
    queryFn: async (): Promise<PlanejamentoDependencia[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento_dependencia')
        .select('*')
        .eq('planejamento_id', planejamentoId!)
      if (error) throw error
      return (data ?? []) as unknown as PlanejamentoDependencia[]
    }
  })
}

export interface AddDependenciaInput {
  planejamento_id: string
  predecessora_id: string
  sucessora_id: string
  tipo?: DependenciaTipo
  lag_dias?: number
}

export function useAddDependencia(): ReturnType<
  typeof useMutation<{ id: string }, Error, AddDependenciaInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento_dependencia')
        .insert({
          planejamento_id: body.planejamento_id,
          predecessora_id: body.predecessora_id,
          sucessora_id: body.sucessora_id,
          tipo: body.tipo ?? 'FS',
          lag_dias: body.lag_dias ?? 0
        })
        .select('id')
        .single()
      if (error) {
        const msg = error.message.includes('unique')
          ? 'Já existe dependência entre estas tarefas.'
          : error.message
        throw new Error(msg)
      }
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ['planejamento', 'dependencias', vars.planejamento_id]
      })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}

export function useUpdateDependencia(): ReturnType<
  typeof useMutation<
    void,
    Error,
    {
      id: string
      planejamento_id: string
      tipo?: DependenciaTipo
      lag_dias?: number
    }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, planejamento_id: _p, ...rest }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento_dependencia').update(rest).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ['planejamento', 'dependencias', vars.planejamento_id]
      })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}

export function useDeleteDependencia(): ReturnType<
  typeof useMutation<void, Error, { id: string; planejamento_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento_dependencia').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ['planejamento', 'dependencias', vars.planejamento_id]
      })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}
