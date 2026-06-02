import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type { Revisao, RevisaoStatus } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const COLS =
  'id, obra_id, versao, rotulo, status, snapshot, custo_total, venda_total, lucratividade_perc, observacao, criada_por, criada_em, aprovada_por, aprovada_em, homologada_por, homologada_em, cancelada_por, cancelada_em'

export function useRevisoes(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Revisao[]>> {
  return useQuery({
    queryKey: ['orcamento', 'revisoes', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Revisao[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('revisao_orcamento')
        .select(COLS)
        .eq('obra_id', obraId!)
        .order('versao', { ascending: false })
      if (error) throw error
      return (data ?? []) as Revisao[]
    }
  })
}

export function useRevisao(id: string | null | undefined): ReturnType<typeof useQuery<Revisao>> {
  return useQuery({
    queryKey: ['orcamento', 'revisao', id],
    enabled: !!id,
    queryFn: async (): Promise<Revisao> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('revisao_orcamento')
        .select(COLS)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as Revisao
    }
  })
}

export function useCriarRevisao(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<typeof adminApi.criarRevisaoOrcamento>>,
    Error,
    { obra_id: string; rotulo?: string; observacao?: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.criarRevisaoOrcamento(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'revisoes', vars.obra_id] })
    }
  })
}

/**
 * Reset da obra com aproveitamento parcial de uma revisão de origem (ou do zero).
 * Limpa estado live + auto-snapshot de preservação + copia seletivamente.
 */
export function useCopiarRevisaoOrcamento(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<typeof adminApi.copiarRevisaoOrcamento>>,
    Error,
    Parameters<typeof adminApi.copiarRevisaoOrcamento>[0]
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.copiarRevisaoOrcamento(body),
    onSuccess: (_d, vars) => {
      // Invalida tudo da obra — orçamento foi resetado.
      void qc.invalidateQueries({ queryKey: ['orcamento'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'revisoes', vars.obra_id] })
    }
  })
}

export function useTransicionarStatus(): ReturnType<
  typeof useMutation<
    Awaited<ReturnType<typeof adminApi.transicionarStatusRevisao>>,
    Error,
    { revisao_id: string; obra_id: string; novo_status: RevisaoStatus }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) =>
      adminApi.transicionarStatusRevisao({
        revisao_id: body.revisao_id,
        novo_status: body.novo_status
      }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'revisoes', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'revisao', vars.revisao_id] })
    }
  })
}

export function useDeleteRevisao(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('revisao_orcamento').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'revisoes', vars.obra_id] })
    }
  })
}
