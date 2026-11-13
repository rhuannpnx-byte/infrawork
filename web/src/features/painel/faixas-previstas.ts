import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'

export interface FaixaPrevista {
  item_orcamentario_id: string
  trecho_id: string
  inicio_m: number
  fim_m: number
}

/**
 * Onde cada serviço está previsto ao longo dos locais, pelas tarefas de um plano (a linha de base vigente, na
 * faixa da obra). Só leitura.
 */
export function useFaixasPrevistas(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<FaixaPrevista[]>> {
  return useQuery({
    queryKey: ['painel', 'faixas-previstas', planejamentoId],
    enabled: !!planejamentoId,
    staleTime: 60_000,
    queryFn: async (): Promise<FaixaPrevista[]> => {
      const linhas = await lerTodas((de, ate) =>
        supabase
          .from('planejamento_tarefa_local')
          .select('trecho_id, inicio_m, fim_m, tarefa:tarefa_id(item_orcamentario_id)')
          .eq('planejamento_id', planejamentoId!)
          .not('trecho_id', 'is', null)
          .not('inicio_m', 'is', null)
          .not('fim_m', 'is', null)
          .order('id')
          .range(de, ate)
      )
      return linhas.flatMap((r) => {
        const bruto = (r as unknown as { tarefa: unknown }).tarefa
        const tarefa = (Array.isArray(bruto) ? bruto[0] : bruto) as {
          item_orcamentario_id: string | null
        } | null
        if (!tarefa?.item_orcamentario_id) return []
        const a = Number(r.inicio_m)
        const b = Number(r.fim_m)
        return [
          {
            item_orcamentario_id: tarefa.item_orcamentario_id,
            trecho_id: r.trecho_id as string,
            inicio_m: Math.min(a, b),
            fim_m: Math.max(a, b)
          }
        ]
      })
    }
  })
}
