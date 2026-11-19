import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { lerTodas } from '@/lib/supabase/paginar'
import type { ModoQuantidade } from '@/types/quantidades'
import {
  arredondarPreservandoSoma,
  type SegmentoValores as SegmentoTrecho
} from '@/lib/quantidades/segmentos'

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
      const { data, error } = await supabase
        .from('item_orcamentario')
        .select('id, codigo, descricao, unidade_referencia, quantidade_referencia, indireto_id')
        .eq('obra_id', obraId!)
        .eq('tipo', 'servico_grupo')
        .is('indireto_id', null)
        .order('codigo')
      if (error) throw error
      const t = await supabase.rpc('trechos_servico_totais', { _obra_id: obraId! })
      if (t.error) throw t.error
      const totais = new Map(
        ((t.data ?? []) as { item_orcamentario_id: string; total: number }[]).map((x) => [
          x.item_orcamentario_id,
          Number(x.total)
        ])
      )
      return (data ?? []).map((g) => ({
        id: g.id as string,
        codigo: g.codigo as string,
        descricao: g.descricao as string,
        unidade: (g.unidade_referencia as string) ?? '',
        quantidade: Number(g.quantidade_referencia ?? 0),
        totalTrechos: totais.get(g.id as string) ?? 0
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
      const { data, error } = await supabase.rpc('trecho_salvar_quantidades', {
        _trecho_id: b.trecho_id,
        _dados: {
          modo: b.modo,
          servicos: b.servicos,
          nova_versao: b.nova_versao,
          comentario: b.comentario ?? '',
          segmentos: arredondarPreservandoSoma([b.segmentos])[0]
        }
      })
      if (error) throw error
      return data as never
    },
    onSuccess: () => invalidar(qc)
  })
}

/** Apaga as quantidades (template e versões) dos locais, para importar de novo. Recusa com plano vigente. */
export function useExcluirQuantidadesTrechos(): ReturnType<
  typeof useMutation<
    { locais: number; versoes: number; locais_de_tarefa_recalculados: number },
    Error,
    { trecho_ids: string[] }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ trecho_ids }) => {
      const { data, error } = await supabase.rpc('trecho_excluir_quantidades', {
        _trecho_ids: trecho_ids
      })
      if (error) throw new Error(error.message)
      return data as { locais: number; versoes: number; locais_de_tarefa_recalculados: number }
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
      const sb = supabase
      const data = await lerTodas((de, ate) =>
        sb
          .from('planejamento_tarefa_local')
          .select('trecho_id, quantidade, qtd_origem, tarefa:tarefa_id(item_orcamentario_id)')
          .eq('planejamento_id', planejamentoId!)
          .not('trecho_id', 'is', null)
          .order('id')
          .range(de, ate)
      )
      return data.flatMap((r) => {
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
      const { error } = await supabase.rpc('trecho_restaurar_versao', { _versao_id: versao_id })
      if (error) throw error
    },
    onSuccess: () => invalidar(qc)
  })
}

/** Quantidade de um serviço num local, somada das tarefas do plano (e as faixas que essas tarefas ocupam). */
export interface QuantidadeNaTarefa {
  item_orcamentario_id: string
  codigo: string
  descricao: string
  unidade: string | null
  total: number
  /** Faixas ocupadas pelas tarefas; tarefas na mesma faixa viram uma linha só, com a contagem. */
  faixas: Array<{
    inicio_m: number | null
    fim_m: number | null
    quantidade: number
    tarefas: number
  }>
}

interface LinhaTarefaLocal {
  id: string
  trecho_id: string | null
  inicio_m: number | null
  fim_m: number | null
  quantidade: number | null
  tarefa: {
    item_orcamentario_id: string | null
    item: {
      codigo: string | null
      descricao: string | null
      unidade_referencia: string | null
    } | null
  } | null
}

/**
 * Quantidades por local que estão nas tarefas do plano, por local e por serviço. Servem para mostrar o local que
 * não tem grade de quantidades: as tarefas importadas de outro cronograma (ou digitadas) levam a quantidade nelas
 * mesmas (`qtd_origem` = manual), sem passar pela grade da página Locais.
 */
export function useQuantidadesNasTarefas(
  planoId: string | null | undefined
): ReturnType<typeof useQuery<Map<string, QuantidadeNaTarefa[]>>> {
  return useQuery({
    queryKey: ['quantidades', 'nas-tarefas', planoId],
    enabled: !!planoId,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<Map<string, QuantidadeNaTarefa[]>> => {
      const linhas = await lerTodas<LinhaTarefaLocal>((de, ate) =>
        supabase
          .from('planejamento_tarefa_local')
          .select(
            'id, trecho_id, inicio_m, fim_m, quantidade, tarefa:tarefa_id(item_orcamentario_id, item:item_orcamentario_id(codigo, descricao, unidade_referencia))'
          )
          .eq('planejamento_id', planoId!)
          .gt('quantidade', 0)
          .order('id')
          .range(de, ate)
      )
      const porLocal = new Map<string, Map<string, QuantidadeNaTarefa>>()
      for (const l of linhas) {
        const itemId = l.tarefa?.item_orcamentario_id
        if (!l.trecho_id || !itemId) continue
        const servicos = porLocal.get(l.trecho_id) ?? new Map<string, QuantidadeNaTarefa>()
        porLocal.set(l.trecho_id, servicos)
        const s = servicos.get(itemId) ?? {
          item_orcamentario_id: itemId,
          codigo: l.tarefa?.item?.codigo ?? '',
          descricao: l.tarefa?.item?.descricao ?? 'Serviço',
          unidade: l.tarefa?.item?.unidade_referencia ?? null,
          total: 0,
          faixas: []
        }
        servicos.set(itemId, s)
        const q = Number(l.quantidade ?? 0)
        s.total += q
        const inicio = l.inicio_m == null ? null : Number(l.inicio_m)
        const fim = l.fim_m == null ? null : Number(l.fim_m)
        const mesma = s.faixas.find((f) => f.inicio_m === inicio && f.fim_m === fim)
        if (mesma) {
          mesma.quantidade += q
          mesma.tarefas++
        } else s.faixas.push({ inicio_m: inicio, fim_m: fim, quantidade: q, tarefas: 1 })
      }
      const out = new Map<string, QuantidadeNaTarefa[]>()
      for (const [trechoId, servicos] of porLocal) {
        const lista = [...servicos.values()]
        for (const s of lista) s.faixas.sort((a, b) => (a.inicio_m ?? 0) - (b.inicio_m ?? 0))
        lista.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
        out.set(trechoId, lista)
      }
      return out
    }
  })
}
