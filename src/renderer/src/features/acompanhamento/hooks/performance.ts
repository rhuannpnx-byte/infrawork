// Hooks da página de Performance de equipes/encarregados.
// - useProducaoPerformance: produção enriquecida da obra no período (RLS-aware).
// - useProdutividadeObra: linha de produtividade equipe×serviço da obra (meta CPU).
// - usePerfHistorico: benchmark histórico cross-obra (RPC security-definer).

import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type {
  ProducaoEnriquecida,
  ProdutividadeEquipeItem,
  PerfHistorico
} from '@/types/acompanhamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const PERF_COLS =
  'id, obra_id, data, qtd, qtd_convertida, unidade_plano, ' +
  'siga_equipe_nome, equipe_planejamento_id, equipe_display_nome, equipe_display_cor, ' +
  'siga_encarregado_nome, encarregado_match_id, encarregado_display_nome, ' +
  'siga_servico_id, servico_planejamento_id, servico_display_nome, servico_codigo, servico_unidade, item_orcamentario_id'

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
      const { data, error } = await supabase
        .from('vw_acompanhamento_producao_enriquecida')
        .select(PERF_COLS)
        .eq('obra_id', obraId!)
        .gte('data', dataDe)
        .lte('data', dataAte)
        .order('data')
        .limit(20000)
      if (error) throw error
      return (data ?? []) as unknown as ProducaoEnriquecida[]
    }
  })
}

/** Linha de produtividade equipe×serviço da obra (traz producao_diaria_cpu = meta). */
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
 * Benchmark histórico (cross-obra, sem outliers) do serviço selecionado,
 * excluindo a obra atual. Calculado DIRETO no SIGA (todos os projetos do ERP,
 * não só as obras importadas) pela edge function — recebe os IDs do serviço
 * executado do SIGA e devolve UMA distribuição combinada.
 */
export function usePerfHistorico(
  sigaServicoIds: number[],
  obraAtualId: string | null | undefined
): ReturnType<typeof useQuery<PerfHistorico | null>> {
  const idsKey = [...sigaServicoIds].sort((a, b) => a - b).join(',')
  return useQuery({
    queryKey: ['acompanhamento', 'perf-historico', obraAtualId, idsKey],
    enabled: !!obraAtualId && sigaServicoIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PerfHistorico | null> => {
      const res = await adminApi.acompanhamentoPerfHistorico({
        siga_servico_ids: sigaServicoIds,
        obra_id: obraAtualId!
      })
      if (!res || res.n_amostras === 0) {
        return {
          n_amostras: 0,
          n_outliers: 0,
          p25: null,
          p50: null,
          p75: null,
          media_trim: null,
          media_bruta: null,
          n_obras: res?.n_obras ?? 0,
          unidade: res?.unidade ?? null
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
        n_obras: toNum(res.n_obras) ?? 0,
        unidade: res.unidade ?? null
      }
    }
  })
}
