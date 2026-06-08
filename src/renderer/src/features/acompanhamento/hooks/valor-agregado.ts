import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useBaseline, useTarefas } from '@/features/planejamento/hooks'
import {
  montarCurvaValorAgregado,
  montarComparativoPorServico,
  montarMedicao,
  type CurvaSDiaRow,
  type EapGrupo,
  type ValorAgregadoBucket,
  type ComparativoServico,
  type MedicaoRow
} from '../lib/valor-agregado-calc'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Produção real/planejada por item/dia (vw_acompanhamento_curva_s). */
function useCurvaSDia(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<CurvaSDiaRow[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'valor-agregado', 'curva-s-dia', obraId],
    enabled: !!obraId,
    staleTime: 30_000,
    queryFn: async (): Promise<CurvaSDiaRow[]> => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
      const { data, error } = await supabase
        .from('vw_acompanhamento_curva_s')
        .select('item_orcamentario_id, data, planejado_dia, realizado_dia')
        .eq('obra_id', obraId!)
        .limit(20_000)
      if (error) throw error
      return (data ?? []) as unknown as CurvaSDiaRow[]
    }
  })
}

/** Árvore EAP da obra: agregadores (servico_grupo) + filhos receita. */
function useEapGrupos(obraId: string | null | undefined): ReturnType<typeof useQuery<EapGrupo[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'valor-agregado', 'eap', obraId],
    enabled: !!obraId,
    staleTime: 60_000,
    queryFn: async (): Promise<EapGrupo[]> => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select(
          'id, codigo, descricao, tipo, parent_id, quantidade, venda_unitaria, quantidade_referencia, unidade, unidade_referencia'
        )
        .eq('obra_id', obraId!)
        .in('tipo', ['servico_grupo', 'receita'])
        .order('codigo', { ascending: true })
      if (error) throw error
      const itens = data ?? []
      const grupos = itens.filter((i) => i.tipo === 'servico_grupo')
      return grupos.map((g) => ({
        id: g.id as string,
        codigo: (g.codigo as string) ?? '',
        descricao: (g.descricao as string) ?? '',
        quantidade_referencia: Number(g.quantidade_referencia ?? 0),
        unidade_referencia: (g.unidade_referencia as string) ?? '',
        filhos: itens
          .filter((c) => c.tipo === 'receita' && c.parent_id === g.id)
          .map((c) => ({
            id: c.id as string,
            codigo: (c.codigo as string) ?? '',
            descricao: (c.descricao as string) ?? '',
            unidade: (c.unidade as string) ?? '',
            quantidade: Number(c.quantidade ?? 0),
            venda_unitaria: Number(c.venda_unitaria ?? 0)
          }))
      }))
    }
  })
}

export interface ValorAgregadoFiltrosArg {
  de: string
  ate: string
  servicoItemId: string | null
}

export interface ValorAgregadoResultado {
  curva: ValorAgregadoBucket[]
  comparativo: ComparativoServico[]
  medicao: MedicaoRow[]
  /** Opções para o filtro de serviço (agregadores). */
  listaServicos: Array<{ id: string; label: string }>
  /** EAP (agregadores + filhos receita) — base das memórias de cálculo no export. */
  grupos: EapGrupo[]
  /** Produção real/planejada por item/dia — base das memórias e da projetada. */
  curvaSRows: CurvaSDiaRow[]
  isLoading: boolean
  semBaseline: boolean
}

export function useValorAgregado(
  obraId: string | null | undefined,
  filtros: ValorAgregadoFiltrosArg
): ValorAgregadoResultado {
  const { data: baseline, isLoading: loadingBaseline } = useBaseline(obraId)
  const { data: tarefas = [], isLoading: loadingTarefas } = useTarefas(baseline?.id)
  const { data: curvaSRows = [], isLoading: loadingCurva } = useCurvaSDia(obraId)
  const { data: grupos = [], isLoading: loadingEap } = useEapGrupos(obraId)

  const { servicoItemId, de, ate } = filtros

  // Aplica o filtro de serviço (servico_grupo) a tarefas/produção/EAP.
  const tarefasF = useMemo(
    () =>
      servicoItemId
        ? tarefas.filter((t) => t.is_indireto || t.item_orcamentario_id === servicoItemId)
        : tarefas,
    [tarefas, servicoItemId]
  )
  const curvaSF = useMemo(
    () =>
      servicoItemId
        ? curvaSRows.filter((r) => r.item_orcamentario_id === servicoItemId)
        : curvaSRows,
    [curvaSRows, servicoItemId]
  )
  const gruposF = useMemo(
    () => (servicoItemId ? grupos.filter((g) => g.id === servicoItemId) : grupos),
    [grupos, servicoItemId]
  )

  const hoje = todayIso()

  const curva = useMemo(
    () => montarCurvaValorAgregado({ tarefas: tarefasF, curvaSRows: curvaSF, hoje }),
    [tarefasF, curvaSF, hoje]
  )
  const comparativo = useMemo(
    () => montarComparativoPorServico({ tarefas: tarefasF, curvaSRows: curvaSF, de, ate }),
    [tarefasF, curvaSF, de, ate]
  )
  const medicao = useMemo(
    () =>
      montarMedicao({
        grupos: gruposF,
        tarefas: tarefasF,
        curvaSRows: curvaSF,
        de,
        ate,
        incluirIndireto: !servicoItemId
      }),
    [gruposF, tarefasF, curvaSF, de, ate, servicoItemId]
  )

  const listaServicos = useMemo(
    () =>
      grupos
        .map((g) => ({ id: g.id, label: `${g.codigo} — ${g.descricao}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [grupos]
  )

  return {
    curva,
    comparativo,
    medicao,
    listaServicos,
    grupos,
    curvaSRows,
    isLoading: loadingBaseline || loadingTarefas || loadingCurva || loadingEap,
    semBaseline: !loadingBaseline && !baseline
  }
}
