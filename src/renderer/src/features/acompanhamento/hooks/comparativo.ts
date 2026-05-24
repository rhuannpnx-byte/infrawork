import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { PrevistoRealizadoItem, CurvaSPonto } from '@/types/acompanhamento'

function notReady(): never { throw new Error('Supabase não configurado.') }

export function usePrevistoXRealizado(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<PrevistoRealizadoItem[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'previsto-realizado', obraId],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('vw_acompanhamento_previsto_x_realizado')
        .select('*')
        .eq('obra_id', obraId!)
        .order('codigo')
      if (error) throw error
      return (data ?? []) as unknown as PrevistoRealizadoItem[]
    }
  })
}

export function useCurvaS(
  obraId: string | null | undefined,
  diasAtras = 60
): ReturnType<typeof useQuery<CurvaSPonto[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'curva-s', obraId, diasAtras],
    enabled: !!obraId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const limite = new Date()
      limite.setDate(limite.getDate() - diasAtras)
      const { data, error } = await supabase
        .from('vw_acompanhamento_curva_s')
        .select('data, planejado_acumulado, realizado_acumulado, servico_grupo_codigo, item_orcamentario_id')
        .eq('obra_id', obraId!)
        .gte('data', limite.toISOString().slice(0, 10))
        .order('data')
        .limit(10000)
      if (error) throw error
      return (data ?? []) as unknown as CurvaSPonto[]
    }
  })
}
