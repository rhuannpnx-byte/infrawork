import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { Indireto, IndiretoTipo } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export function useIndireto(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Indireto[]>> {
  return useQuery({
    queryKey: ['orcamento', 'indireto', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Indireto[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('indireto_item')
        .select(
          'id, obra_id, parent_id, codigo, descricao, tipo, valor_total, distribuicao_perc, ordem, created_at'
        )
        .eq('obra_id', obraId!)
        .order('ordem')
        .order('codigo')
      if (error) throw error
      return (data ?? []) as Indireto[]
    }
  })
}

export interface UpsertIndiretoInput {
  id?: string
  obra_id: string
  parent_id?: string | null
  codigo: string
  descricao: string
  tipo: IndiretoTipo
  valor_total: number
  distribuicao_perc?: number
  ordem?: number
}

export function useUpsertIndireto(): ReturnType<
  typeof useMutation<{ id: string }, Error, UpsertIndiretoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const payload = {
        obra_id: body.obra_id,
        parent_id: body.parent_id ?? null,
        codigo: body.codigo.trim(),
        descricao: body.descricao.trim(),
        tipo: body.tipo,
        valor_total: body.valor_total,
        distribuicao_perc: body.distribuicao_perc ?? 1.0,
        ordem: body.ordem ?? 0
      }
      if (id) {
        const { error } = await supabase.from('indireto_item').update(payload).eq('id', id)
        if (error) throw error
        return { id }
      }
      const { data, error } = await supabase
        .from('indireto_item')
        .insert(payload)
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'indireto', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade', vars.obra_id] })
    }
  })
}

export function useDeleteIndireto(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('indireto_item').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'indireto', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'lucratividade', vars.obra_id] })
    }
  })
}

/** Total ponderado de indireto (valor_total × distribuicao_perc). */
export function totalIndireto(items: Indireto[]): number {
  return items.reduce(
    (acc, i) => acc + Number(i.valor_total ?? 0) * Number(i.distribuicao_perc ?? 1),
    0
  )
}
