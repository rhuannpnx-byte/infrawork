import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { ComentarioItem } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const COLS =
  'id, item_id, obra_id, autor_id, texto, resolvido, resolvido_por, resolvido_em, created_at, updated_at, autor:autor_id(id, nome)'

export function useComentariosDoItem(
  itemId: string | null | undefined
): ReturnType<typeof useQuery<ComentarioItem[]>> {
  return useQuery({
    queryKey: ['orcamento', 'comentarios', itemId],
    enabled: !!itemId,
    queryFn: async (): Promise<ComentarioItem[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('comentario_item')
        .select(COLS)
        .eq('item_id', itemId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as ComentarioItem[]
    }
  })
}

export function useAddComentario(): ReturnType<
  typeof useMutation<{ id: string }, Error, { item_id: string; texto: string }>
> {
  const qc = useQueryClient()
  const callerId = useAuthStore((s) => s.profile?.id ?? null)
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      if (!callerId) throw new Error('Sem usuário autenticado')
      const { data, error } = await supabase
        .from('comentario_item')
        .insert({
          item_id: body.item_id,
          texto: body.texto.trim(),
          autor_id: callerId
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'comentarios', vars.item_id] })
    }
  })
}

export function useResolverComentario(): ReturnType<
  typeof useMutation<void, Error, { id: string; item_id: string; resolvido: boolean }>
> {
  const qc = useQueryClient()
  const callerId = useAuthStore((s) => s.profile?.id ?? null)
  return useMutation({
    mutationFn: async ({ id, resolvido }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('comentario_item')
        .update({
          resolvido,
          resolvido_por: resolvido ? callerId : null,
          resolvido_em: resolvido ? new Date().toISOString() : null
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'comentarios', vars.item_id] })
    }
  })
}

export function useDeleteComentario(): ReturnType<
  typeof useMutation<void, Error, { id: string; item_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('comentario_item').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'comentarios', vars.item_id] })
    }
  })
}
