import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { MemoriaCalculoItem } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const COLS =
  'id, item_id, obra_id, body_md, estaca_inicio, estaca_fim, autor_id, created_at, updated_at'

export function useMemoriaDoItem(
  itemId: string | null | undefined
): ReturnType<typeof useQuery<MemoriaCalculoItem | null>> {
  return useQuery({
    queryKey: ['orcamento', 'memoria', itemId],
    enabled: !!itemId,
    queryFn: async (): Promise<MemoriaCalculoItem | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('memoria_calculo_item')
        .select(COLS)
        .eq('item_id', itemId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as MemoriaCalculoItem | null
    }
  })
}

export interface UpsertMemoriaInput {
  item_id: string
  body_md: string
  estaca_inicio?: string | null
  estaca_fim?: string | null
}

export function useUpsertMemoria(): ReturnType<
  typeof useMutation<{ id: string }, Error, UpsertMemoriaInput>
> {
  const qc = useQueryClient()
  const callerId = useAuthStore((s) => s.profile?.id ?? null)
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // Upsert por item_id (única). Tenta UPDATE; se 0 linhas, INSERT.
      const { data: exist } = await supabase
        .from('memoria_calculo_item')
        .select('id')
        .eq('item_id', body.item_id)
        .maybeSingle()
      if (exist) {
        const { error } = await supabase
          .from('memoria_calculo_item')
          .update({
            body_md: body.body_md,
            estaca_inicio: body.estaca_inicio ?? null,
            estaca_fim: body.estaca_fim ?? null
          })
          .eq('id', exist.id)
        if (error) throw error
        return { id: exist.id as string }
      }
      const { data, error } = await supabase
        .from('memoria_calculo_item')
        .insert({
          item_id: body.item_id,
          body_md: body.body_md,
          estaca_inicio: body.estaca_inicio ?? null,
          estaca_fim: body.estaca_fim ?? null,
          autor_id: callerId
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'memoria', vars.item_id] })
    }
  })
}

export function useDeleteMemoria(): ReturnType<
  typeof useMutation<void, Error, { item_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ item_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('memoria_calculo_item').delete().eq('item_id', item_id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'memoria', vars.item_id] })
    }
  })
}
