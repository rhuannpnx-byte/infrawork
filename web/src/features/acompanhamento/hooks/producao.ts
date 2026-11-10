import { useQuery } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import { useAuthStore } from '@/stores/auth-store'
import type { ProducaoEnriquecida, ProducaoOrigem } from '@/types/acompanhamento'
import { downloadBlob } from '@/lib/files/download'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export interface ProducaoFiltros {
  data_de?: string | null
  data_ate?: string | null
  equipe_ids?: string[]
  encarregado_ids?: string[]
  item_ids?: string[]
  frente?: string | null
  origem?: ProducaoOrigem | null
  texto?: string | null
}

export const PROD_COLS =
  'id, obra_id, data, item_orcamentario_id, servico_id, servico_planejamento_id, servico_nome, ' +
  'qtd, qtd_convertida, fator_conversao, unidade, unidade_plano, ' +
  'frente, frente_raw, estaca_inicial, estaca_final, obs, origem, importacao_id, ' +
  'criado_por, criado_por_nome, created_at, updated_at, ' +
  'equipe_id, equipe_planejamento_id, equipe_display_nome, equipe_display_cor, equipe_tipo, ' +
  'encarregado_id, encarregado_display_nome, ' +
  'servico_codigo, servico_display_nome, servico_unidade, ' +
  'servico_grupo_codigo, servico_grupo_descricao, ' +
  'tarefa_baseline_id, tarefa_data_inicio, tarefa_data_fim, fotos_count, ' +
  'trecho_id, posicao_inicio_m, posicao_fim_m, trecho_nome, trecho_tipo, material_resumo'

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
      const sb = supabase
      const data = await lerTodas((de, ate) => {
        let q = isCliente
          ? sb.rpc('cliente_producao', { _obra_id: obraId! }).select(PROD_COLS)
          : sb
              .from('vw_acompanhamento_producao_enriquecida')
              .select(PROD_COLS)
              .eq('obra_id', obraId!)
        if (filtros.data_de) q = q.gte('data', filtros.data_de)
        if (filtros.data_ate) q = q.lte('data', filtros.data_ate)
        if (filtros.equipe_ids?.length) q = q.in('equipe_id', filtros.equipe_ids)
        if (filtros.encarregado_ids?.length) q = q.in('encarregado_id', filtros.encarregado_ids)
        if (filtros.item_ids?.length) q = q.in('item_orcamentario_id', filtros.item_ids)
        if (filtros.frente) q = q.eq('frente', filtros.frente)
        if (filtros.origem) q = q.eq('origem', filtros.origem)
        if (filtros.texto?.trim()) q = q.ilike('obs', `%${filtros.texto.trim()}%`)
        return q
          .order('data', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(de, ate)
      })
      return data as unknown as ProducaoEnriquecida[]
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
      const sb = supabase
      const data = await lerTodas((de, ate) =>
        sb
          .from('vw_acompanhamento_producao_enriquecida')
          .select(PROD_COLS)
          .eq('tarefa_baseline_id', tarefaId!)
          .order('data', { ascending: false })
          .order('id')
          .range(de, ate)
      )
      return data as unknown as ProducaoEnriquecida[]
    }
  })
}

export function exportarProducaoCsv(rows: ProducaoEnriquecida[]): void {
  const headers = [
    'Data',
    'Código',
    'Serviço',
    'Equipe',
    'Encarregado',
    'Qtd',
    'Unid.',
    'Fator',
    'Qtd (plano)',
    'Unid. plano',
    'Frente',
    'Local',
    'Estaca inicial',
    'Estaca final',
    'Observação',
    'Origem',
    'Lançado por',
    'Tarefa baseline',
    'Fotos'
  ]
  const lines = rows.map((r) => [
    r.data ?? '',
    r.servico_grupo_codigo ?? r.servico_codigo ?? '',
    r.servico_display_nome ?? r.servico_nome ?? '',
    r.equipe_display_nome ?? '',
    r.encarregado_display_nome ?? '',
    r.qtd ?? '',
    r.unidade ?? '',
    r.fator_conversao ?? 1,
    r.qtd_convertida ?? r.qtd ?? '',
    r.unidade_plano ?? r.servico_unidade ?? '',
    r.frente ?? '',
    r.trecho_nome ? (r.trecho_tipo === 'area' ? `Área ${r.trecho_nome}` : r.trecho_nome) : '',
    r.estaca_inicial ?? '',
    r.estaca_final ?? '',
    (r.obs ?? '').replace(/\n/g, ' ').replace(/"/g, '""'),
    r.origem,
    r.criado_por_nome ?? '',
    r.tarefa_baseline_id ? 'Sim' : 'Não',
    r.fotos_count ?? 0
  ])
  const csv = [headers, ...lines]
    .map((row) => row.map((c) => `"${String(c)}"`).join(','))
    .join('\n')
  downloadBlob(
    new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
    `producao_${new Date().toISOString().slice(0, 10)}.csv`
  )
}
