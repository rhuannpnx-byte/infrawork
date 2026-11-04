import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { ModoQuantidade, TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'
import type { SegmentoValores as SegmentoTrecho } from '@/lib/quantidades/segmentos'
import { fetchTemplateAtual } from './trechos'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

/** Compat. com a tela de trechos: [] ou [versão atual do template do trecho]. */
export function useTemplatesQuantidade(
  trechoId: string | null | undefined
): ReturnType<typeof useQuery<TrechoQuantidadeVersaoCompleta[]>> {
  return useQuery({
    queryKey: ['quantidades', 'template-atual-lista', trechoId],
    enabled: !!trechoId,
    queryFn: async () => {
      const t = await fetchTemplateAtual(trechoId!)
      return t ? [t] : []
    }
  })
}

export interface VersaoResumo {
  id: string
  numero: number
  is_atual: boolean
  comentario: string | null
  created_at: string
}

export function useVersoesTrecho(
  trechoId: string | null | undefined
): ReturnType<typeof useQuery<VersaoResumo[]>> {
  return useQuery({
    queryKey: ['quantidades', 'versoes', trechoId],
    enabled: !!trechoId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: tpl } = await supabase
        .from('trecho_quantidade_template')
        .select('id')
        .eq('trecho_id', trechoId!)
        .maybeSingle()
      if (!tpl) return []
      const { data, error } = await supabase
        .from('trecho_quantidade_versao')
        .select('id, numero, is_atual, comentario, created_at')
        .eq('template_id', tpl.id)
        .order('numero', { ascending: false })
      if (error) throw error
      return (data ?? []) as VersaoResumo[]
    }
  })
}

export interface AgrupadorTrecho {
  id: string
  codigo: string
  descricao: string
  unidade: string
  quantidade: number
  /** Soma do serviço em todos os trechos da obra (versões atuais). */
  totalTrechos: number
}

/** Agrupadores do orçamento (candidatos a coluna) + quanto já está nos trechos. */
export function useAgrupadoresTrecho(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<AgrupadorTrecho[]>> {
  return useQuery({
    queryKey: ['quantidades', 'agrupadores', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select('id, codigo, descricao, unidade_referencia, quantidade_referencia, indireto_id')
        .eq('obra_id', obraId!)
        .eq('tipo', 'servico_grupo')
        .is('indireto_id', null)
        .order('codigo')
      if (error) throw error
      const lista = data ?? []
      const totais = await Promise.all(
        lista.map((g) => supabase!.rpc('trechos_servico_total', { _item_id: g.id }))
      )
      return lista.map((g, k) => ({
        id: g.id as string,
        codigo: g.codigo as string,
        descricao: g.descricao as string,
        unidade: (g.unidade_referencia as string) ?? '',
        quantidade: Number(g.quantidade_referencia ?? 0),
        totalTrechos: Number(totais[k].data ?? 0)
      }))
    }
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['quantidades'] })
  void qc.invalidateQueries({ queryKey: ['planejamento'] })
}

export function useSalvarQuantidadesTrecho(): ReturnType<
  typeof useMutation<
    { versao_id: string; segmentos: number; celulas: number },
    Error,
    {
      trecho_id: string
      modo: ModoQuantidade
      servicos: string[]
      segmentos: SegmentoTrecho[]
      nova_versao: boolean
      comentario?: string
    }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase.rpc('trecho_salvar_quantidades', {
        _trecho_id: b.trecho_id,
        _dados: {
          modo: b.modo,
          servicos: b.servicos,
          nova_versao: b.nova_versao,
          comentario: b.comentario ?? '',
          segmentos: b.segmentos
        }
      })
      if (error) throw error
      return data as never
    },
    onSuccess: () => invalidar(qc)
  })
}

export interface LocalEmTarefa {
  trecho_id: string
  item_orcamentario_id: string
  quantidade: number
  qtd_origem: 'manual' | 'trecho'
}

/** Locais das tarefas de um plano (quanto de cada serviço já virou tarefa em cada local). */
export function useQuantidadesEmTarefas(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<LocalEmTarefa[]>> {
  return useQuery({
    queryKey: ['planejamento', 'locais-em-tarefas', planejamentoId],
    enabled: !!planejamentoId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento_tarefa_local')
        .select('trecho_id, quantidade, qtd_origem, tarefa:tarefa_id(item_orcamentario_id)')
        .eq('planejamento_id', planejamentoId!)
        .not('trecho_id', 'is', null)
      if (error) throw error
      return (data ?? []).flatMap((r) => {
        const raw = (r as unknown as { tarefa: unknown }).tarefa
        const t = (Array.isArray(raw) ? raw[0] : raw) as { item_orcamentario_id: string } | null
        if (!t?.item_orcamentario_id) return []
        return [
          {
            trecho_id: r.trecho_id as string,
            item_orcamentario_id: t.item_orcamentario_id,
            quantidade: Number(r.quantidade ?? 0),
            qtd_origem: r.qtd_origem as 'manual' | 'trecho'
          }
        ]
      })
    }
  })
}

/** Mapeamento salvo das colunas da planilha de quantidades (chave normalizada → serviço; null = não importar). */
export function useMapeamentoQuantidades(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Map<string, string | null>>> {
  return useQuery({
    queryKey: ['quantidades', 'mapeamento', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('trecho_quantidade_mapeamento')
        .select('chave, item_orcamentario_id')
        .eq('obra_id', obraId!)
      if (error) throw error
      return new Map(
        (data ?? []).map((r) => [
          r.chave as string,
          (r.item_orcamentario_id as string | null) ?? null
        ])
      )
    }
  })
}

export function useSalvarMapeamentoQuantidades(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { obra_id: string; itens: { chave: string; item_orcamentario_id: string | null }[] }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, itens }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      if (itens.length === 0) return
      const { error } = await supabase.from('trecho_quantidade_mapeamento').upsert(
        itens.map((i) => ({
          obra_id,
          chave: i.chave,
          item_orcamentario_id: i.item_orcamentario_id,
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'obra_id,chave' }
      )
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['quantidades', 'mapeamento', vars.obra_id] })
    }
  })
}

export function useRestaurarVersaoTrecho(): ReturnType<
  typeof useMutation<void, Error, { versao_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ versao_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.rpc('trecho_restaurar_versao', { _versao_id: versao_id })
      if (error) throw error
    },
    onSuccess: () => invalidar(qc)
  })
}
