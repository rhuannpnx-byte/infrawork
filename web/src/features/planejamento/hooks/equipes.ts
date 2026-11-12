import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { Equipe } from '@/types/planejamento'

export function useEquipes(
  obraId: string | null | undefined,
  opts: { incluirInativas?: boolean; incluirSistema?: boolean } = {}
): ReturnType<typeof useQuery<Equipe[]>> {
  const incluirSistema = opts.incluirSistema ?? false
  return useQuery({
    queryKey: ['planejamento', 'equipes', obraId, opts.incluirInativas ?? false, incluirSistema],
    enabled: !!obraId,
    queryFn: async (): Promise<Equipe[]> => {
      let q = supabase
        .from('equipe')
        .select('*')
        .eq('obra_id', obraId!)
        .order('ordem')
        .order('nome')
      if (!opts.incluirInativas) q = q.eq('ativo', true)
      if (!incluirSistema) q = q.eq('is_sistema', false)
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
  encarregado_id?: string | null
}

export function useCreateEquipe(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateEquipeInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      const { data, error } = await supabase
        .from('equipe')
        .insert({
          obra_id: body.obra_id,
          nome: body.nome.trim(),
          tipo: body.tipo.trim(),
          cor: body.cor ?? '#3b82f6',
          encarregado_id: body.encarregado_id ?? null
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
  encarregado_id?: string | null
}

export function useUpdateEquipe(): ReturnType<typeof useMutation<void, Error, UpdateEquipeInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, obra_id: _o, ...rest }) => {
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
      const { error } = await supabase.from('equipe').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'equipes', vars.obra_id] })
    }
  })
}

// ─── Ordem das lanes ──────────────────────────────────────────────────────
export function useReorderEquipes(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; ids: string[] }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids }) => {
      const results = await Promise.all(
        ids.map((id, idx) => supabase.from('equipe').update({ ordem: idx }).eq('id', id))
      )
      const err = results.find((r) => r.error)?.error
      if (err) throw err
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'equipes', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas'] })
    }
  })
}

/** Equipes do encarregado: as marcadas passam a ser dele (saindo de outro, se for o caso); as desmarcadas ficam sem. */
export function useVincularEquipesEncarregado(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; encarregado_id: string; equipe_ids: string[] }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, encarregado_id, equipe_ids }) => {
      let solta = supabase
        .from('equipe')
        .update({ encarregado_id: null })
        .eq('obra_id', obra_id)
        .eq('encarregado_id', encarregado_id)
        .eq('ativo', true)
      if (equipe_ids.length) solta = solta.not('id', 'in', `(${equipe_ids.join(',')})`)
      const r1 = await solta
      if (r1.error) throw r1.error
      if (!equipe_ids.length) return
      const r2 = await supabase
        .from('equipe')
        .update({ encarregado_id })
        .eq('obra_id', obra_id)
        .in('id', equipe_ids)
      if (r2.error) throw r2.error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'equipes', vars.obra_id] })
    }
  })
}
