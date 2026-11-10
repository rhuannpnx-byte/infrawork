// Hooks da página de Performance de equipes/encarregados.
// - useProducaoPerformance: produção enriquecida da obra no período (RLS-aware).
// - useProdutividadeObra: produtividade equipe×serviço da obra (meta = taxa da equipe ou CPU).
// - usePerfHistorico: benchmark histórico em outras obras da empresa (RPC), por código do serviço.

import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import type {
  PerfHistorico,
  ProducaoEnriquecida,
  ProdutividadeEquipeItem
} from '@/types/acompanhamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const PERF_COLS =
  'id, obra_id, data, qtd, qtd_convertida, unidade_plano, ' +
  'equipe_id, equipe_planejamento_id, equipe_display_nome, equipe_display_cor, ' +
  'encarregado_id, encarregado_display_nome, ' +
  'servico_id, servico_planejamento_id, servico_nome, servico_display_nome, servico_codigo, servico_unidade, item_orcamentario_id'

/** Produções enriquecidas da obra no período — base de toda a análise da página. */
export function useProducaoPerformance(
  obraId: string | null | undefined,
  dataDe: string,
  dataAte: string
): ReturnType<typeof useQuery<ProducaoEnriquecida[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'perf-prod', obraId, dataDe, dataAte],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<ProducaoEnriquecida[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const sb = supabase
      const data = await lerTodas((de, ate) =>
        sb
          .from('vw_acompanhamento_producao_enriquecida')
          .select(PERF_COLS)
          .eq('obra_id', obraId!)
          .gte('data', dataDe)
          .lte('data', dataAte)
          .order('data')
          .order('id')
          .range(de, ate)
      )
      return data as unknown as ProducaoEnriquecida[]
    }
  })
}

/** Produtividade equipe×serviço da obra (meta diária = taxa da equipe ou CPU). */
export function useProdutividadeObra(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ProdutividadeEquipeItem[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'perf-produtividade', obraId],
    enabled: !!obraId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ProdutividadeEquipeItem[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('vw_acompanhamento_produtividade_equipe')
        .select('*')
        .eq('obra_id', obraId!)
      if (error) throw error
      return (data ?? []) as unknown as ProdutividadeEquipeItem[]
    }
  })
}

const toNum = (v: unknown): number | null =>
  v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null

/**
 * Benchmark histórico do serviço (por `servico.codigo`) em OUTRAS obras que o
 * usuário enxerga, excluindo a obra atual, sem outliers (IQR 1,5×).
 */
export function usePerfHistorico(
  servicoCodigos: string[],
  obraAtualId: string | null | undefined
): ReturnType<typeof useQuery<PerfHistorico | null>> {
  const codKey = [...servicoCodigos].sort().join(',')
  return useQuery({
    queryKey: ['acompanhamento', 'perf-historico', obraAtualId, codKey],
    enabled: !!obraAtualId && servicoCodigos.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PerfHistorico | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('acompanhamento_perf_historico', {
        p_servico_codigos: servicoCodigos,
        p_obra_atual: obraAtualId!
      })
      if (error) throw error
      const res = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
      if (!res || Number(res.n_amostras ?? 0) === 0) {
        return {
          n_amostras: 0,
          n_outliers: 0,
          p25: null,
          p50: null,
          p75: null,
          media_trim: null,
          media_bruta: null,
          n_obras: Number(res?.n_obras ?? 0),
          unidade: (res?.unidade as string | null) ?? null
        }
      }
      return {
        n_amostras: Number(res.n_amostras ?? 0),
        n_outliers: Number(res.n_outliers ?? 0),
        p25: toNum(res.p25),
        p50: toNum(res.p50),
        p75: toNum(res.p75),
        media_trim: toNum(res.media_trim),
        media_bruta: toNum(res.media_bruta),
        n_obras: Number(res.n_obras ?? 0),
        unidade: (res.unidade as string | null) ?? null
      }
    }
  })
}
