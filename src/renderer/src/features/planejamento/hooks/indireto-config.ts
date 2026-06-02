// Hooks pra criar/editar tarefas-indiretas via RPCs atômicas
// (`criar_tarefa_indireta` / `atualizar_tarefa_indireta`). Diferente de tarefa
// direta, indireta exige 2 INSERTs em tabelas distintas — RPC garante
// atomicidade pela transação do banco.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { recalcBus } from '../lib/recalc-bus'
import type {
  CustoPeriodicidade,
  IndiretoConfig,
  ReceitaModoIndireto
} from '@/types/planejamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

/** Payload mínimo pra criar — campos derivados (periodos_calc) ficam null. */
export interface IndiretoConfigInput {
  custo_periodicidade: CustoPeriodicidade
  /**
   * Override do custo por período. Omitido/null = motor herda de
   * item.custo_unitario_calc do orçamento (= indireto_item.valor_total).
   */
  custo_unitario?: number | null
  receita_modo: ReceitaModoIndireto
  /**
   * Override da receita por período (só faz sentido modo='mesma_logica_custo').
   * Omitido/null = motor deriva de item.venda_total_calc / quantidade_referencia.
   */
  receita_unitaria?: number | null
  receita_percentual?: number | null
  offset_dias_antes?: number
  offset_dias_depois?: number
  receita_extrapola?: boolean
  aplica_taxas?: boolean
  taxa_regime_id?: string | null
}

export interface CriarTarefaIndiretaInput {
  planejamento_id: string
  item_orcamentario_id: string
  config: IndiretoConfigInput
  parent_id?: string | null
  nome_custom?: string | null
  ordem?: number
  notas?: string
}

export function useCriarTarefaIndireta(): ReturnType<
  typeof useMutation<{ tarefa_id: string }, Error, CriarTarefaIndiretaInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('criar_tarefa_indireta', {
        p_planejamento_id: body.planejamento_id,
        p_item_orcamentario_id: body.item_orcamentario_id,
        p_indireto_config: configToJsonb(body.config),
        p_parent_id: body.parent_id ?? null,
        p_nome_custom: body.nome_custom ?? null,
        p_ordem: body.ordem ?? 0,
        p_notas: body.notas ?? null
      })
      if (error) throw error
      return { tarefa_id: data as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      void qc.invalidateQueries({
        queryKey: ['planejamento', 'itens-sincronizaveis', vars.planejamento_id]
      })
      // Aciona recalc — indireta só ganha datas após CPM rodar.
      recalcBus.emit('mutationDone', {
        planejamentoId: vars.planejamento_id,
        source: 'criar-tarefa-indireta'
      })
    }
  })
}

export interface AtualizarTarefaIndiretaInput {
  tarefa_id: string
  planejamento_id: string
  patch: Partial<IndiretoConfigInput>
}

export function useAtualizarTarefaIndireta(): ReturnType<
  typeof useMutation<void, Error, AtualizarTarefaIndiretaInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.rpc('atualizar_tarefa_indireta', {
        p_tarefa_id: body.tarefa_id,
        p_indireto_config: configToJsonb(body.patch)
      })
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      recalcBus.emit('mutationDone', {
        planejamentoId: vars.planejamento_id,
        source: 'atualizar-tarefa-indireta'
      })
    }
  })
}

function configToJsonb(c: Partial<IndiretoConfigInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (c.custo_periodicidade !== undefined) out.custo_periodicidade = c.custo_periodicidade
  if (c.custo_unitario !== undefined) out.custo_unitario = String(c.custo_unitario)
  if (c.receita_modo !== undefined) out.receita_modo = c.receita_modo
  if (c.receita_unitaria !== undefined && c.receita_unitaria != null)
    out.receita_unitaria = String(c.receita_unitaria)
  if (c.receita_percentual !== undefined && c.receita_percentual != null)
    out.receita_percentual = String(c.receita_percentual)
  if (c.offset_dias_antes !== undefined) out.offset_dias_antes = c.offset_dias_antes
  if (c.offset_dias_depois !== undefined) out.offset_dias_depois = c.offset_dias_depois
  if (c.receita_extrapola !== undefined) out.receita_extrapola = c.receita_extrapola
  if (c.aplica_taxas !== undefined) out.aplica_taxas = c.aplica_taxas
  if (c.taxa_regime_id !== undefined && c.taxa_regime_id != null)
    out.taxa_regime_id = c.taxa_regime_id
  return out
}

/** Helper: deriva IndiretoConfigInput a partir da config vinda da view (read). */
export function configFromView(c: IndiretoConfig): IndiretoConfigInput {
  return {
    custo_periodicidade: c.custo_periodicidade,
    custo_unitario: c.custo_unitario,
    receita_modo: c.receita_modo,
    receita_unitaria: c.receita_unitaria,
    receita_percentual: c.receita_percentual,
    offset_dias_antes: c.offset_dias_antes,
    offset_dias_depois: c.offset_dias_depois,
    receita_extrapola: c.receita_extrapola,
    aplica_taxas: c.aplica_taxas,
    taxa_regime_id: c.taxa_regime_id
  }
}
