import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { Equipe } from '@/types/planejamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export function useEquipes(
  obraId: string | null | undefined,
  opts: { incluirInativas?: boolean } = {}
): ReturnType<typeof useQuery<Equipe[]>> {
  return useQuery({
    queryKey: ['planejamento', 'equipes', obraId, opts.incluirInativas ?? false],
    enabled: !!obraId,
    queryFn: async (): Promise<Equipe[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      let q = supabase.from('equipe').select('*').eq('obra_id', obraId!).order('nome')
      if (!opts.incluirInativas) q = q.eq('ativo', true)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as Equipe[]
    }
  })
}

export interface CreateEquipeInput {
  obra_id: string
  nome: string
  tipo: string
  cor?: string
}

export function useCreateEquipe(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateEquipeInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('equipe')
        .insert({
          obra_id: body.obra_id,
          nome: body.nome.trim(),
          tipo: body.tipo.trim(),
          cor: body.cor ?? '#3b82f6'
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'equipes', vars.obra_id] })
    }
  })
}

export interface UpdateEquipeInput {
  id: string
  obra_id: string
  nome?: string
  tipo?: string
  cor?: string
  ativo?: boolean
}

export function useUpdateEquipe(): ReturnType<typeof useMutation<void, Error, UpdateEquipeInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, obra_id: _o, ...rest }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('equipe').update(rest).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'equipes', vars.obra_id] })
    }
  })
}

export function useDeleteEquipe(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('equipe').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'equipes', vars.obra_id] })
    }
  })
}
