import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type { ObraAcompanhamentoLink, SigaProjeto } from '@/types/acompanhamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const LINK_COLS =
  'id, obra_id, siga_projeto_id, siga_projeto_codigo, siga_projeto_nome, ativo, ' +
  'ultimo_sync_em, ultimo_sync_status, ultimo_sync_erro, ultimo_sync_stats, ' +
  'criado_por, criado_em, updated_at'

export function useAcompanhamentoLink(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ObraAcompanhamentoLink | null>> {
  return useQuery({
    queryKey: ['acompanhamento', 'link', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<ObraAcompanhamentoLink | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('obra_acompanhamento_link')
        .select(LINK_COLS)
        .eq('obra_id', obraId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as ObraAcompanhamentoLink | null
    },
    refetchInterval: (q) => {
      const link = q.state.data as ObraAcompanhamentoLink | null | undefined
      return link?.ultimo_sync_status === 'rodando' ? 5000 : false
    }
  })
}

export function useListarProjetosSiga(): ReturnType<
  typeof useQuery<SigaProjeto[]>
> {
  return useQuery({
    queryKey: ['acompanhamento', 'projetos-siga'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SigaProjeto[]> => {
      const r = await adminApi.acompanhamentoListarProjetosSiga()
      return r.projetos
    }
  })
}

export interface CriarVinculoInput {
  obra_id: string
  siga_projeto_id: number
  siga_projeto_codigo: string
  siga_projeto_nome?: string
}

export function useCriarVinculo(): ReturnType<
  typeof useMutation<{ id: string }, Error, CriarVinculoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: existente } = await supabase
        .from('obra_acompanhamento_link')
        .select('id')
        .eq('obra_id', body.obra_id)
        .maybeSingle()

      if (existente) {
        const { error } = await supabase
          .from('obra_acompanhamento_link')
          .update({
            siga_projeto_id: body.siga_projeto_id,
            siga_projeto_codigo: body.siga_projeto_codigo,
            siga_projeto_nome: body.siga_projeto_nome ?? null,
            ativo: true,
            ultimo_sync_status: null,
            ultimo_sync_erro: null
          })
          .eq('id', existente.id)
        if (error) throw error
        return { id: existente.id as string }
      }

      const { data, error } = await supabase
        .from('obra_acompanhamento_link')
        .insert({
          obra_id: body.obra_id,
          siga_projeto_id: body.siga_projeto_id,
          siga_projeto_codigo: body.siga_projeto_codigo,
          siga_projeto_nome: body.siga_projeto_nome ?? null,
          ativo: true
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'link', vars.obra_id] })
    }
  })
}

export function useDesvincular(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('obra_acompanhamento_link')
        .update({ ativo: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'link', vars.obra_id] })
    }
  })
}

export function useReativarVinculo(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('obra_acompanhamento_link')
        .update({ ativo: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'link', vars.obra_id] })
    }
  })
}
