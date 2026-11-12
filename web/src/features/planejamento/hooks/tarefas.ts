import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'
import { producaoVivaPorServico } from './servico-vivo'

export function useTarefas(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<PlanejamentoTarefaCompleta[]>> {
  return useQuery({
    queryKey: ['planejamento', 'tarefas', planejamentoId],
    enabled: !!planejamentoId,
    queryFn: async (): Promise<PlanejamentoTarefaCompleta[]> => {
      // Ordenação primária por `ordem` (drag-drop respeita). Empate → código
      // do item (estabilidade visual para tarefas legadas com ordem=0).
      // Hierarquia/agrupamento por parent_id é feita no client via buildTaskTree.
      const { data, error } = await supabase
        .from('vw_planejamento_tarefa_completa')
        .select('*')
        .eq('planejamento_id', planejamentoId!)
        .order('ordem', { ascending: true })
        .order('servico_grupo_codigo', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as unknown as PlanejamentoTarefaCompleta[]
    }
  })
}

/**
 * Linha do "catálogo" de itens disponíveis para virar tarefa-folha no
 * planejamento. Cada item é um `servico_grupo` da obra orçada. Vem com
 * info de alocação atual (`alocado`, `restante`, `count`) para a UI
 * mostrar `AlocacaoIndicator` ao lado e sugerir `quantidade_alocada`
 * default = `restante`.
 */
export interface ItemSincronizavel {
  id: string
  codigo: string
  descricao: string
  quantidade_referencia: number
  unidade: string | null
  /** Soma de quantidade_alocada das tarefas-folha já criadas deste item. */
  alocado: number
  /** quantidade_referencia - alocado (mínimo 0). */
  restante: number
  /** Número de tarefas-folha já criadas deste item neste planejamento. */
  count: number
  /** Quando NOT NULL, o item é indireto (lógica de cronograma diferente). */
  indireto_id: string | null
  /** Serviço do catálogo (chave da taxa por equipe). NULL em indiretos. */
  servico_id: string | null
  /** Produção/dia da composição vigente no item (fallback do motor). */
  producao_diaria_cpu: number | null
  /** Venda total orçada (NULL se não há venda_unitaria × quantidade). */
  venda_total: number | null
  /**
   * Custo unitário orçado. Pra indiretos = indireto_item.valor_total
   * (custo por período). Pra diretos = cpu_snapshot.custo_unit.
   */
  custo_unitario: number | null
}

/**
 * Lista de itens orçados (tipo='servico_grupo') da obra, com info de
 * alocação contextualizada ao planejamento (quanto já está alocado em
 * tarefas-folha vs. orçado).
 *
 * Esse hook substitui o uso ad-hoc de `item_orcamentario` no antigo
 * `useSincronizarComOrcamento` — agora a UI pode mostrar restante por
 * item e o usuário escolhe quantidade alocada explicitamente.
 */
export function useItensSincronizaveis(
  planejamento_id: string | null | undefined,
  obra_id: string | null | undefined
): ReturnType<typeof useQuery<ItemSincronizavel[]>> {
  return useQuery({
    queryKey: ['planejamento', 'itens-sincronizaveis', planejamento_id, obra_id],
    enabled: !!planejamento_id && !!obra_id,
    queryFn: async (): Promise<ItemSincronizavel[]> => {
      // Carrega itens servico_grupo da obra + suas tarefas-folha (planejamento).
      // Duas queries pequenas; preferimos isso a uma view nova só pra isso.
      const [{ data: itens, error: itensErr }, { data: tarefas, error: tarErr }] =
        await Promise.all([
          supabase
            .from('item_orcamentario')
            .select(
              'id, codigo, descricao, quantidade_referencia, indireto_id, venda_total_calc, custo_unitario_calc, unidade_referencia, servico_id, servico:servico_id(unidade)'
            )
            .eq('obra_id', obra_id!)
            .eq('tipo', 'servico_grupo')
            // agrupamento sem composição (nem indireto) não entra na programação
            .or('servico_id.not.is.null,indireto_id.not.is.null')
            .order('codigo'),
          supabase
            .from('planejamento_tarefa')
            .select('item_orcamentario_id, quantidade_alocada')
            .eq('planejamento_id', planejamento_id!)
            .eq('tipo_no', 'tarefa')
        ])
      if (itensErr) throw itensErr
      if (tarErr) throw tarErr
      const prodViva = await producaoVivaPorServico(
        (itens ?? []).map((i) => i.servico_id as string | null)
      )
      const stats = new Map<string, { alocado: number; count: number }>()
      for (const t of tarefas ?? []) {
        const id = t.item_orcamentario_id as string | null
        if (!id) continue
        const cur = stats.get(id) ?? { alocado: 0, count: 0 }
        cur.alocado += Number(t.quantidade_alocada ?? 0)
        cur.count += 1
        stats.set(id, cur)
      }
      return (itens ?? []).map((it) => {
        const s = stats.get(it.id as string) ?? { alocado: 0, count: 0 }
        const total = Number(it.quantidade_referencia ?? 0)
        // supabase-js: relacionamento 1:1 retorna objeto OU array dependendo do
        // tipo gerado. Aqui é `servico:servico_id(unidade)` que pode vir como
        // objeto ou array de 1 — normaliza.
        const servicoRaw = (it as unknown as { servico: unknown }).servico
        const servico = Array.isArray(servicoRaw) ? servicoRaw[0] : servicoRaw
        const unidadeServ = (servico as { unidade?: string } | null)?.unidade ?? null
        // Para indiretos, servico_id é NULL — usa unidade_referencia do item.
        const unidadeRef = (it as unknown as { unidade_referencia?: string | null })
          .unidade_referencia
        const unidade = unidadeServ ?? unidadeRef ?? null
        const indiretoId = (it as unknown as { indireto_id: string | null }).indireto_id
        const vendaTotalRaw = (it as unknown as { venda_total_calc: number | string | null })
          .venda_total_calc
        const vendaTotal = vendaTotalRaw == null ? null : Number(vendaTotalRaw)
        const custoUnitRaw = (it as unknown as { custo_unitario_calc: number | string | null })
          .custo_unitario_calc
        const custoUnit = custoUnitRaw == null ? null : Number(custoUnitRaw)
        const prodCpu = prodViva.get(it.servico_id as string) ?? null
        return {
          id: it.id as string,
          codigo: it.codigo as string,
          descricao: it.descricao as string,
          quantidade_referencia: total,
          unidade,
          alocado: s.alocado,
          restante: Math.max(0, total - s.alocado),
          count: s.count,
          indireto_id: indiretoId,
          servico_id: (it as unknown as { servico_id: string | null }).servico_id ?? null,
          producao_diaria_cpu: prodCpu,
          venda_total: vendaTotal,
          custo_unitario: custoUnit
        }
      })
    }
  })
}
