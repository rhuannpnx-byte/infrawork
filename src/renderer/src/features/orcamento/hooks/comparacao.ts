// Hook de comparação entre 2 revisões do orçamento.
//
// Devolve:
//   - resumoA / resumoB: linha de vw_orcamento_consolidado_revisao(rev_id)
//     (totais agregados — usado nos cards comparativos)
//   - itensA / itensB: itens extraídos dos snapshots (usados na tabela diff)

import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export interface ResumoRevisao {
  revisao_id: string
  versao: number | null
  status: string | null
  rotulo: string | null
  obra_id: string
  venda_total: number
  custo_direto_calc: number
  custo_indireto_standalone: number
  custo_total: number
  aliquota_total_perc: number
  impostos: number
  lucro_liquido: number
  lucratividade_perc: number | null
}

export interface ItemSnap {
  id: string
  codigo: string
  descricao: string
  tipo: 'receita' | 'servico_grupo' | 'etapa'
  parent_id: string | null
  unidade: string | null
  quantidade: number | null
  venda_unitaria: number | null
  venda_total_calc: number | null
  custo_unitario_calc: number | null
  custo_total_calc: number | null
  quantidade_referencia: number | null
}

export interface DiffLinha {
  codigo: string
  descricao: string
  /** '=' (sem mudança), 'Δ' (alterado), '+' (só em B), '-' (só em A) */
  status: '=' | 'Δ' | '+' | '-'
  qtdA: number | null
  qtdB: number | null
  custoUnitA: number | null
  custoUnitB: number | null
  vendaTotalA: number | null
  vendaTotalB: number | null
  custoTotalA: number | null
  custoTotalB: number | null
  deltaQtdPct: number | null
  deltaCustoUnitPct: number | null
  deltaVendaTotalPct: number | null
}

async function fetchResumo(revisaoId: string): Promise<ResumoRevisao> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  const { data, error } = await supabase.rpc('vw_orcamento_consolidado_revisao', {
    _revisao_id: revisaoId
  })
  if (error) throw error
  const row = (data as ResumoRevisao[] | null)?.[0]
  if (!row) throw new Error('Revisão sem dados consolidados')
  return {
    ...row,
    venda_total: Number(row.venda_total ?? 0),
    custo_direto_calc: Number(row.custo_direto_calc ?? 0),
    custo_indireto_standalone: Number(row.custo_indireto_standalone ?? 0),
    custo_total: Number(row.custo_total ?? 0),
    aliquota_total_perc: Number(row.aliquota_total_perc ?? 0),
    impostos: Number(row.impostos ?? 0),
    lucro_liquido: Number(row.lucro_liquido ?? 0),
    lucratividade_perc: row.lucratividade_perc != null ? Number(row.lucratividade_perc) : null
  }
}

async function fetchItens(revisaoId: string): Promise<ItemSnap[]> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  const { data, error } = await supabase
    .from('revisao_orcamento')
    .select('snapshot')
    .eq('id', revisaoId)
    .maybeSingle()
  if (error) throw error
  const snap = (data?.snapshot ?? null) as { itens?: ItemSnap[] } | null
  return snap?.itens ?? []
}

export interface ComparacaoResult {
  resumoA: ResumoRevisao
  resumoB: ResumoRevisao
  itensA: ItemSnap[]
  itensB: ItemSnap[]
  diff: DiffLinha[]
}

function delta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  if (a === 0 && b === 0) return 0
  if (a === 0) return null
  return ((b - a) / a)
}

export function useComparacaoRevisoes(
  aId: string | null | undefined,
  bId: string | null | undefined
): ReturnType<typeof useQuery<ComparacaoResult>> {
  return useQuery({
    queryKey: ['orcamento', 'comparacao', aId, bId],
    enabled: !!aId && !!bId,
    queryFn: async (): Promise<ComparacaoResult> => {
      const [resumoA, resumoB, itensA, itensB] = await Promise.all([
        fetchResumo(aId!),
        fetchResumo(bId!),
        fetchItens(aId!),
        fetchItens(bId!)
      ])

      // Diff por código (chave estável entre revisões).
      const mapA = new Map<string, ItemSnap>()
      for (const i of itensA) mapA.set(i.codigo, i)
      const mapB = new Map<string, ItemSnap>()
      for (const i of itensB) mapB.set(i.codigo, i)

      const allCodigos = new Set<string>([...mapA.keys(), ...mapB.keys()])
      const diff: DiffLinha[] = []
      for (const codigo of allCodigos) {
        const a = mapA.get(codigo)
        const b = mapB.get(codigo)
        const descricao = (a ?? b)?.descricao ?? ''
        const qtdA = a?.quantidade ?? a?.quantidade_referencia ?? null
        const qtdB = b?.quantidade ?? b?.quantidade_referencia ?? null
        const custoUnitA = a?.custo_unitario_calc ?? null
        const custoUnitB = b?.custo_unitario_calc ?? null
        const vendaTotalA = a?.venda_total_calc ?? null
        const vendaTotalB = b?.venda_total_calc ?? null
        const custoTotalA = a?.custo_total_calc ?? null
        const custoTotalB = b?.custo_total_calc ?? null

        let status: DiffLinha['status']
        if (!a) status = '+'
        else if (!b) status = '-'
        else {
          // Considera alterado se qtd, custo_unit ou venda_total diferem
          const mudou =
            (qtdA ?? 0) !== (qtdB ?? 0) ||
            (custoUnitA ?? 0) !== (custoUnitB ?? 0) ||
            (vendaTotalA ?? 0) !== (vendaTotalB ?? 0)
          status = mudou ? 'Δ' : '='
        }

        diff.push({
          codigo,
          descricao,
          status,
          qtdA,
          qtdB,
          custoUnitA,
          custoUnitB,
          vendaTotalA,
          vendaTotalB,
          custoTotalA,
          custoTotalB,
          deltaQtdPct: delta(qtdA, qtdB),
          deltaCustoUnitPct: delta(custoUnitA, custoUnitB),
          deltaVendaTotalPct: delta(vendaTotalA, vendaTotalB)
        })
      }
      diff.sort((x, y) => x.codigo.localeCompare(y.codigo))

      return { resumoA, resumoB, itensA, itensB, diff }
    }
  })
}
