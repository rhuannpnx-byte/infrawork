import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { MemoriaCalculoItem } from '@/types/orcamento'

const COLS =
  'id, item_id, obra_id, body_md, estaca_inicio, estaca_fim, autor_id, created_at, updated_at'

export function useMemoriaDoItem(
  itemId: string | null | undefined
): ReturnType<typeof useQuery<MemoriaCalculoItem | null>> {
  return useQuery({
    queryKey: ['orcamento', 'memoria', itemId],
    enabled: !!itemId,
    queryFn: async (): Promise<MemoriaCalculoItem | null> => {
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
