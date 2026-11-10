import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import { adminApi } from '@/lib/supabase/functions'
import type { DashboardResumoResposta, ProducaoEnriquecida } from '@/types/acompanhamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export function useDashboardResumo(
  obraId: string | null | undefined,
  periodoDias: number = 30
): ReturnType<typeof useQuery<DashboardResumoResposta>> {
  return useQuery({
    queryKey: ['acompanhamento', 'dashboard', obraId, periodoDias],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const r = await adminApi.acompanhamentoDashboardResumo({
        obra_id: obraId!,
        periodo_dias: periodoDias
      })
      return r
    }
  })
}

/**
 * Produções enriquecidas no período — usadas para agregação "Por encarregado".
 * Filtra opcionalmente por item_orcamentario_id (serviço selecionado).
 */
export function useProducoesDashboard(
  obraId: string | null | undefined,
  dataDe: string,
  dataAte: string,
  filtroItemId?: string | null
): ReturnType<typeof useQuery<ProducaoEnriquecida[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'dashboard-prods', obraId, dataDe, dataAte, filtroItemId ?? null],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<ProducaoEnriquecida[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const sb = supabase
      const data = await lerTodas((de, ate) => {
        let q = sb
          .from('vw_acompanhamento_producao_enriquecida')
          .select(
            'id, obra_id, data, item_orcamentario_id, servico_id, servico_nome, servico_display_nome, ' +
              'equipe_id, equipe_display_nome, equipe_display_cor, ' +
              'encarregado_id, encarregado_display_nome, qtd, qtd_convertida, unidade_plano, frente, fotos_count'
          )
          .eq('obra_id', obraId!)
          .gte('data', dataDe)
          .lte('data', dataAte)
        if (filtroItemId) q = q.eq('item_orcamentario_id', filtroItemId)
        return q.order('data').order('id').range(de, ate)
      })
      return data as unknown as ProducaoEnriquecida[]
    }
  })
}
