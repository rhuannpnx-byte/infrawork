import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { add, dec, div, mul, sub } from '@/lib/money'
import type { Indireto, LucratividadeResumo } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

/**
 * Agrega Planilha Orçamentária (raízes) + Indireto + impostos da obra em um resumo.
 * - Venda total: soma dos venda_total_calc dos itens raiz
 * - Custo direto: soma dos custo_total_calc dos itens raiz
 * - Custo indireto: SUM(valor_total × distribuicao_perc) dos indiretos
 * - Impostos: venda × aliquota_total (regime tributário aplica via alíquotas)
 * - Lucro líquido = venda - custo_direto - custo_indireto - impostos
 */
export function useLucratividade(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<LucratividadeResumo>> {
  return useQuery({
    queryKey: ['orcamento', 'lucratividade', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<LucratividadeResumo> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()

      const hoje = new Date().toISOString().slice(0, 10)
      const [{ data: taxas }, { data: raizes }, { data: indiretos }] = await Promise.all([
        supabase
          .from('encargos_sociais_regime')
          .select('total_perc_calc, vigencia_inicio, vigencia_fim')
          .eq('obra_id', obraId!)
          .eq('ativo', true)
          .or(`vigencia_inicio.is.null,vigencia_inicio.lte.${hoje}`)
          .or(`vigencia_fim.is.null,vigencia_fim.gte.${hoje}`)
          .order('vigencia_inicio', { ascending: false, nullsFirst: false })
          .limit(1),
        supabase
          .from('item_orcamentario')
          .select('venda_total_calc, custo_total_calc')
          .eq('obra_id', obraId!)
          .is('parent_id', null),
        supabase
          .from('indireto_item')
          .select('valor_total, distribuicao_perc')
          .eq('obra_id', obraId!)
      ])

      const aliquotaTotal = dec((taxas ?? [])[0]?.total_perc_calc ?? 0)

      let vendaTotal = dec(0)
      let custoDireto = dec(0)
      for (const r of raizes ?? []) {
        vendaTotal = add(vendaTotal, r.venda_total_calc ?? 0)
        custoDireto = add(custoDireto, r.custo_total_calc ?? 0)
      }

      let custoIndireto = dec(0)
      for (const i of (indiretos ?? []) as Pick<Indireto, 'valor_total' | 'distribuicao_perc'>[]) {
        custoIndireto = add(custoIndireto, mul(i.valor_total ?? 0, i.distribuicao_perc ?? 1))
      }

      const impostos = mul(vendaTotal, aliquotaTotal)
      const lucroLiquido = sub(sub(sub(vendaTotal, custoDireto), custoIndireto), impostos)
      const margemPerc = vendaTotal.isZero() ? null : div(lucroLiquido, vendaTotal).toNumber()

      return {
        venda_total: vendaTotal.toNumber(),
        custo_direto: custoDireto.toNumber(),
        custo_indireto: custoIndireto.toNumber(),
        aliquota_total_perc: aliquotaTotal.toNumber(),
        impostos: impostos.toNumber(),
        lucro_liquido: lucroLiquido.toNumber(),
        margem_perc: margemPerc
      }
    }
  })
}
