// Busca em lote os cpu_snapshot por id — usado pelo Histograma planejado para
// expandir os recursos das composições congeladas em cada item orçamentário.

import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { CpuSnapshot } from '@/types/orcamento'

/**
 * Carrega `cpu_snapshot` (id, produção/dia raiz e payload) para os ids dados,
 * numa única query, e devolve um Map<id, CpuSnapshot>. O payload traz os itens
 * (legado) ou as CPUs vinculadas com fator (agregador).
 */
export function useCpuSnapshots(
  ids: string[] | undefined
): ReturnType<typeof useQuery<Map<string, CpuSnapshot>>> {
  const idsOrdenados = Array.from(new Set(ids ?? [])).sort()
  return useQuery({
    queryKey: ['orcamento', 'cpu-snapshots', idsOrdenados],
    enabled: idsOrdenados.length > 0,
    queryFn: async (): Promise<Map<string, CpuSnapshot>> => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
      const { data, error } = await supabase
        .from('cpu_snapshot')
        .select('id, producao_diaria_qtde, producao_diaria_unidade, payload')
        .in('id', idsOrdenados)
      if (error) throw error
      const map = new Map<string, CpuSnapshot>()
      for (const row of (data ?? []) as unknown as CpuSnapshot[]) {
        map.set(row.id, row)
      }
      return map
    }
  })
}
