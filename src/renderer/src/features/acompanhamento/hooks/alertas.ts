import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type { AcompanhamentoAlerta, AlertaSeveridade, AlertaStatus, AlertaTipo } from '@/types/acompanhamento'

function notReady(): never { throw new Error('Supabase não configurado.') }

export interface AlertasFiltros {
  status?: AlertaStatus[]
  severidade?: AlertaSeveridade[]
  tipo?: AlertaTipo[]
}

export function useAlertas(
  obraId: string | null | undefined,
  filtros: AlertasFiltros = {}
): ReturnType<typeof useQuery<AcompanhamentoAlerta[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'alertas', obraId, filtros],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      let q = supabase
        .from('acompanhamento_alerta')
        .select('*')
        .eq('obra_id', obraId!)
        .order('severidade')
        .order('criado_em', { ascending: false })
        .limit(1000)
      const statuses = filtros.status?.length ? filtros.status : ['aberto']
      q = q.in('status', statuses)
      if (filtros.severidade?.length) q = q.in('severidade', filtros.severidade)
      if (filtros.tipo?.length) q = q.in('tipo', filtros.tipo)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as AcompanhamentoAlerta[]
    }
  })
}

/** Contagem de alertas críticos abertos — polling 60s para badge sidebar. */
export function useContagemAlertasCriticos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<number>> {
  return useQuery({
    queryKey: ['acompanhamento', 'alertas-criticos-count', obraId],
    enabled: !!obraId,
    refetchInterval: 60 * 1000,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { count, error } = await supabase
        .from('acompanhamento_alerta')
        .select('id', { count: 'exact', head: true })
        .eq('obra_id', obraId!)
        .eq('status', 'aberto')
        .eq('severidade', 'critical')
      if (error) throw error
      return count ?? 0
    }
  })
}

export function useRecalcularAlertas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { obra_id: string }) =>
      await adminApi.acompanhamentoAlertasRecalcular({ obra_id: vars.obra_id }),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas-criticos-count', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'dashboard', vars.obra_id] })
    }
  })
}

export function useSilenciarAlerta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, dias = 7 }: { id: string; obra_id: string; dias?: number }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const ate = new Date(); ate.setDate(ate.getDate() + dias)
      const { error } = await supabase
        .from('acompanhamento_alerta')
        .update({ status: 'silenciado', silenciado_ate: ate.toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas-criticos-count', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'dashboard', vars.obra_id] })
    }
  })
}

export function useResolverAlerta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; obra_id: string }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('acompanhamento_alerta')
        .update({ status: 'resolvido', resolvido_em: new Date().toISOString(), resolvido_automaticamente: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas-criticos-count', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'dashboard', vars.obra_id] })
    }
  })
}

export function useReabrirAlerta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; obra_id: string }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('acompanhamento_alerta')
        .update({ status: 'aberto', silenciado_ate: null, resolvido_em: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'alertas-criticos-count', vars.obra_id] })
    }
  })
}
