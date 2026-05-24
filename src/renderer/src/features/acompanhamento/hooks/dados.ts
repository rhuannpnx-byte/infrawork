import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export interface DadosResumo {
  producao_total: number
  fotos_total: number
  fotos_geo: number
  data_min: string | null
  data_max: string | null
}

export function useDadosResumo(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<DadosResumo>> {
  return useQuery({
    queryKey: ['acompanhamento', 'dados-resumo', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<DadosResumo> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()

      const [prodCount, fotosCount, fotosGeoCount, range] = await Promise.all([
        supabase
          .from('acompanhamento_producao')
          .select('id', { count: 'exact', head: true })
          .eq('obra_id', obraId!),
        supabase
          .from('acompanhamento_foto')
          .select('id', { count: 'exact', head: true })
          .eq('obra_id', obraId!),
        supabase
          .from('acompanhamento_foto')
          .select('id', { count: 'exact', head: true })
          .eq('obra_id', obraId!)
          .not('lat', 'is', null)
          .not('lng', 'is', null),
        supabase
          .from('acompanhamento_producao')
          .select('data')
          .eq('obra_id', obraId!)
          .order('data', { ascending: true })
          .limit(1)
          .then(async (first) => {
            const last = await supabase!
              .from('acompanhamento_producao')
              .select('data')
              .eq('obra_id', obraId!)
              .order('data', { ascending: false })
              .limit(1)
            return {
              min: (first.data?.[0]?.data ?? null) as string | null,
              max: (last.data?.[0]?.data ?? null) as string | null
            }
          })
      ])

      return {
        producao_total: prodCount.count ?? 0,
        fotos_total: fotosCount.count ?? 0,
        fotos_geo: fotosGeoCount.count ?? 0,
        data_min: range.min,
        data_max: range.max
      }
    }
  })
}
