import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { PrevistoRealizadoItem, CurvaSPonto } from '@/types/acompanhamento'

function notReady(): never { throw new Error('Supabase não configurado.') }

// O Cliente não tem RLS direto nas views (que dependeriam das tabelas de
// orçamento e vazariam preço). Em vez disso lê via funções SECURITY DEFINER
// (cliente_*), que retornam só colunas seguras filtradas por obra concedida.
const CURVA_S_COLS =
  'data, planejado_acumulado, realizado_acumulado, planejado_dia, realizado_dia, servico_grupo_codigo, item_orcamentario_id'

export function usePrevistoXRealizado(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<PrevistoRealizadoItem[]>> {
  const isCliente = useAuthStore((s) => s.profile?.role === 'cliente')
  return useQuery({
    queryKey: ['acompanhamento', 'previsto-realizado', obraId, isCliente],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const q = isCliente
        ? supabase.rpc('cliente_previsto_realizado', { _obra_id: obraId! }).select('*').order('codigo')
        : supabase
            .from('vw_acompanhamento_previsto_x_realizado')
            .select('*')
            .eq('obra_id', obraId!)
            .order('codigo')
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as PrevistoRealizadoItem[]
    }
  })
}

export function useCurvaS(
  obraId: string | null | undefined,
  diasAtras = 60
): ReturnType<typeof useQuery<CurvaSPonto[]>> {
  const isCliente = useAuthStore((s) => s.profile?.role === 'cliente')
  return useQuery({
    queryKey: ['acompanhamento', 'curva-s', obraId, diasAtras, isCliente],
    enabled: !!obraId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const limite = new Date()
      limite.setDate(limite.getDate() - diasAtras)
      const desde = limite.toISOString().slice(0, 10)
      const q = isCliente
        ? supabase.rpc('cliente_curva_s', { _obra_id: obraId! })
            .select(CURVA_S_COLS)
            .gte('data', desde)
            .order('data')
            .limit(10000)
        : supabase
            .from('vw_acompanhamento_curva_s')
            .select(CURVA_S_COLS)
            .eq('obra_id', obraId!)
            .gte('data', desde)
            .order('data')
            .limit(10000)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as CurvaSPonto[]
    }
  })
}
