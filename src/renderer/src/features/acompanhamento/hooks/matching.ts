import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type {
  EquipeMatch,
  EncarregadoMatch,
  ServicoMatch,
  MatchingSugestoesResposta
} from '@/types/acompanhamento'

function notReady(): never { throw new Error('Supabase não configurado.') }

export function useMatchingSugestoes(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<MatchingSugestoesResposta>> {
  return useQuery({
    queryKey: ['acompanhamento', 'matching-sugestoes', obraId],
    enabled: !!obraId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => await adminApi.acompanhamentoMatchingSugerir({ obra_id: obraId! })
  })
}

export function useEquipeMatches(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<EquipeMatch[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'equipe-matches', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('acompanhamento_equipe_match')
        .select('*')
        .eq('obra_id', obraId!)
        .order('siga_equipe_nome')
      if (error) throw error
      return (data ?? []) as EquipeMatch[]
    }
  })
}

export function useEncarregadoMatches(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<EncarregadoMatch[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'encarregado-matches', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('acompanhamento_encarregado_match')
        .select('*')
        .eq('obra_id', obraId!)
        .order('siga_encarregado_nome')
      if (error) throw error
      return (data ?? []) as EncarregadoMatch[]
    }
  })
}

export function useServicoMatches(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ServicoMatch[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'servico-matches', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('acompanhamento_servico_match')
        .select('*')
        .eq('obra_id', obraId!)
        .order('siga_servico_nome')
      if (error) throw error
      return (data ?? []) as ServicoMatch[]
    }
  })
}

export interface ConfirmarMatchInput {
  obra_id: string
  matches: Parameters<typeof adminApi.acompanhamentoMatchingConfirmar>[0]['matches']
  origem?: 'auto' | 'manual'
}

export function useConfirmarMatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: ConfirmarMatchInput) =>
      await adminApi.acompanhamentoMatchingConfirmar(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'matching-sugestoes', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'equipe-matches', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'encarregado-matches', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'servico-matches', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'producao', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'dashboard', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'previsto-realizado', vars.obra_id] })
    }
  })
}
