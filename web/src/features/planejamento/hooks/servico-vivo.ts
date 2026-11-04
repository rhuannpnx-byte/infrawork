import { supabase } from '@/lib/supabase/client'

/** Produção/dia vigente (ao vivo, da composição) de cada serviço. */
export async function producaoVivaPorServico(
  servicoIds: Array<string | null | undefined>
): Promise<Map<string, number | null>> {
  const ids = [...new Set(servicoIds.filter((x): x is string => !!x))]
  const m = new Map<string, number | null>()
  if (ids.length === 0 || !supabase) return m
  const { data, error } = await supabase
    .from('vw_servico_vivo')
    .select('servico_id, producao_diaria_qtde')
    .in('servico_id', ids)
  if (error) throw error
  for (const r of data ?? [])
    m.set(
      r.servico_id as string,
      r.producao_diaria_qtde == null ? null : Number(r.producao_diaria_qtde)
    )
  return m
}
