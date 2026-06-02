import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { LucratividadeResumo } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

/**
 * Lucratividade real-time da obra (sem duplicar indireto).
 *
 * Lê de `vw_orcamento_consolidado` (single source of truth server-side).
 *
 * Os campos retornados já apresentam o split correto pra UI:
 *   - custo_direto   = custo_direto_real (raízes - indireto vinculado embutido)
 *   - custo_indireto = standalone + vinculado (tudo que é indireto numa só métrica)
 *
 * Os indiretos vinculados continuam fazendo parte do rollup da planilha
 * (via FK item_orcamentario.indireto_id), mas a UI mostra a separação clara.
 */
export function useLucratividade(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<LucratividadeResumo>> {
  return useQuery({
    queryKey: ['orcamento', 'lucratividade', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<LucratividadeResumo> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()

      const { data: raw, error } = await supabase
        .from('vw_orcamento_consolidado')
        .select(
          'venda_total, custo_direto_real, custo_indireto_standalone, custo_indireto_vinculado, ' +
            'aliquota_total_perc, impostos, lucro_liquido, lucratividade_perc'
        )
        .eq('obra_id', obraId!)
        .maybeSingle()

      if (error) throw error
      // Cast pra unknown — supabase-js não infere tipo de view recém-criada.
      const data = raw as unknown as {
        venda_total: number | null
        custo_direto_real: number | null
        custo_indireto_standalone: number | null
        custo_indireto_vinculado: number | null
        aliquota_total_perc: number | null
        impostos: number | null
        lucro_liquido: number | null
        lucratividade_perc: number | null
      } | null

      const standalone = Number(data?.custo_indireto_standalone ?? 0)
      const vinculado = Number(data?.custo_indireto_vinculado ?? 0)

      return {
        venda_total: Number(data?.venda_total ?? 0),
        custo_direto: Number(data?.custo_direto_real ?? 0),
        custo_indireto: standalone + vinculado,
        custo_indireto_standalone: standalone,
        custo_indireto_vinculado: vinculado,
        aliquota_total_perc: Number(data?.aliquota_total_perc ?? 0),
        impostos: Number(data?.impostos ?? 0),
        lucro_liquido: Number(data?.lucro_liquido ?? 0),
        margem_perc: data?.lucratividade_perc != null ? Number(data.lucratividade_perc) : null
      }
    }
  })
}
