import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { ProducaoEnriquecida } from '@/types/acompanhamento'

function notReady(): never { throw new Error('Supabase não configurado.') }

export interface ProducaoFiltros {
  data_de?: string | null
  data_ate?: string | null
  equipe_nomes?: string[]
  encarregado_nomes?: string[]
  servico_ids?: number[]
  trecho?: string | null
  texto?: string | null
}

const PROD_COLS =
  'id, obra_id, siga_producao_id, data, siga_servico_id, siga_servico_nome, ' +
  'siga_encarregado_id, siga_encarregado_nome, siga_equipe_id, siga_equipe_nome, ' +
  'qtd, qtd_convertida, fator_conversao, siga_unidade_nome, ' +
  'trecho, estaca_inicial, estaca_final, obs, frente, ' +
  'siga_created_at, siga_updated_at, sincronizado_em, ' +
  'equipe_match_id, equipe_planejamento_id, equipe_display_nome, equipe_display_cor, equipe_match_origem, equipe_tipo, ' +
  'encarregado_match_id, encarregado_display_nome, encarregado_match_origem, ' +
  'servico_match_id, servico_planejamento_id, item_orcamentario_id, servico_codigo, servico_display_nome, servico_unidade, unidade_plano, ' +
  'servico_grupo_codigo, servico_grupo_descricao, ' +
  'tarefa_baseline_id, tarefa_data_inicio, tarefa_data_fim, fotos_count'

export function useProducao(
  obraId: string | null | undefined,
  filtros: ProducaoFiltros = {}
): ReturnType<typeof useQuery<ProducaoEnriquecida[]>> {
  // Cliente lê via função SECURITY DEFINER (sem RLS direto na view — evita
  // vazamento de preço de item_orcamentario). Demais papéis: SELECT na view.
  const isCliente = useAuthStore((s) => s.profile?.role === 'cliente')
  return useQuery({
    queryKey: ['acompanhamento', 'producao', obraId, filtros, isCliente],
    enabled: !!obraId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<ProducaoEnriquecida[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      let q = isCliente
        ? supabase
            .rpc('cliente_producao', { _obra_id: obraId! })
            .select(PROD_COLS)
            .order('data', { ascending: false })
            .order('sincronizado_em', { ascending: false })
            .limit(5000)
        : supabase
            .from('vw_acompanhamento_producao_enriquecida')
            .select(PROD_COLS)
            .eq('obra_id', obraId!)
            .order('data', { ascending: false })
            .order('sincronizado_em', { ascending: false })
            .limit(5000)
      if (filtros.data_de) q = q.gte('data', filtros.data_de)
      if (filtros.data_ate) q = q.lte('data', filtros.data_ate)
      if (filtros.equipe_nomes?.length) q = q.in('siga_equipe_nome', filtros.equipe_nomes)
      if (filtros.encarregado_nomes?.length) q = q.in('siga_encarregado_nome', filtros.encarregado_nomes)
      if (filtros.servico_ids?.length) q = q.in('siga_servico_id', filtros.servico_ids)
      if (filtros.trecho) q = q.eq('frente', filtros.trecho)
      if (filtros.texto?.trim()) q = q.ilike('obs', `%${filtros.texto.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as ProducaoEnriquecida[]
    }
  })
}

export function useProducaoPorTarefa(
  tarefaId: string | null | undefined
): ReturnType<typeof useQuery<ProducaoEnriquecida[]>> {
  return useQuery({
    queryKey: ['acompanhamento', 'producao-tarefa', tarefaId],
    enabled: !!tarefaId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('vw_acompanhamento_producao_enriquecida')
        .select(PROD_COLS)
        .eq('tarefa_baseline_id', tarefaId!)
        .order('data', { ascending: false })
        .limit(1000)
      if (error) throw error
      return (data ?? []) as unknown as ProducaoEnriquecida[]
    }
  })
}

export function exportarProducaoCsv(rows: ProducaoEnriquecida[]): void {
  const headers = [
    'Data', 'Serviço', 'Equipe SIGA', 'Equipe vinculada', 'Encarregado',
    'Qtd SIGA', 'Unid. SIGA', 'Fator', 'Qtd convertida', 'Unid. plano',
    'Frente', 'Trecho', 'Estaca', 'Observação',
    'Tarefa baseline', 'Fotos'
  ]
  const lines = rows.map((r) => [
    r.data ?? '',
    r.servico_display_nome ?? r.siga_servico_nome ?? '',
    r.siga_equipe_nome ?? '',
    r.equipe_planejamento_id ? (r.equipe_display_nome ?? '') : '',
    r.siga_encarregado_nome ?? '',
    r.qtd ?? '',
    r.siga_unidade_nome ?? '',
    r.fator_conversao ?? 1,
    r.qtd_convertida ?? r.qtd ?? '',
    r.unidade_plano ?? r.servico_unidade ?? '',
    r.frente ?? '',
    r.trecho ?? '',
    r.estaca_inicial ?? '',
    (r.obs ?? '').replace(/\n/g, ' ').replace(/"/g, '""'),
    r.tarefa_baseline_id ? 'Sim' : 'Não',
    r.fotos_count ?? 0
  ])
  const csv = [headers, ...lines]
    .map((row) => row.map((c) => `"${String(c)}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `producao_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
