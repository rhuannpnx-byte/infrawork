import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { invalidarCadeia } from '@/lib/query/cadeia'

export interface Reajuste {
  id: string
  obra_id: string
  numero: number
  data: string
  descricao: string | null
  status: 'rascunho' | 'aplicado'
  venda_antes: number | null
  venda_depois: number | null
  aplicado_em: string | null
}

export interface ReajusteGrupo {
  id: string
  reajuste_id: string
  ordem: number
  nome: string
  indice_anterior: number
  indice_atual: number
}

export interface ReajusteItem {
  reajuste_id: string
  receita_id: string
  grupo_id: string
  fator: number | null
  preco_antes: number | null
  preco_depois: number | null
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

export function useReajustes(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Reajuste[]>> {
  return useQuery({
    queryKey: ['orcamento', 'reajustes', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Reajuste[]> => {
      const { data, error } = await supabase
        .from('orcamento_reajuste')
        .select(
          'id, obra_id, numero, data, descricao, status, venda_antes, venda_depois, aplicado_em'
        )
        .eq('obra_id', obraId!)
        .order('numero', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as Reajuste),
        venda_antes: num(r.venda_antes),
        venda_depois: num(r.venda_depois)
      }))
    }
  })
}

export function useReajusteDetalhe(
  reajusteId: string | null | undefined
): ReturnType<typeof useQuery<{ grupos: ReajusteGrupo[]; itens: ReajusteItem[] }>> {
  return useQuery({
    queryKey: ['orcamento', 'reajuste-detalhe', reajusteId],
    enabled: !!reajusteId,
    queryFn: async () => {
      const [g, i] = await Promise.all([
        supabase
          .from('orcamento_reajuste_grupo')
          .select('id, reajuste_id, ordem, nome, indice_anterior, indice_atual')
          .eq('reajuste_id', reajusteId!)
          .order('ordem'),
        supabase
          .from('orcamento_reajuste_item')
          .select('reajuste_id, receita_id, grupo_id, fator, preco_antes, preco_depois')
          .eq('reajuste_id', reajusteId!)
      ])
      if (g.error) throw g.error
      if (i.error) throw i.error
      return {
        grupos: (g.data ?? []).map((x) => ({
          ...(x as ReajusteGrupo),
          indice_anterior: Number(x.indice_anterior),
          indice_atual: Number(x.indice_atual)
        })),
        itens: (i.data ?? []).map((x) => ({
          ...(x as ReajusteItem),
          fator: num(x.fator),
          preco_antes: num(x.preco_antes),
          preco_depois: num(x.preco_depois)
        }))
      }
    }
  })
}

export function useDataBase(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<string | null>> {
  return useQuery({
    queryKey: ['orcamento', 'data-base', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('obras')
        .select('data_base_orcamento')
        .eq('id', obraId!)
        .single()
      if (error) throw error
      return (data?.data_base_orcamento as string | null) ?? null
    }
  })
}

export function useDefinirDataBase(): ReturnType<
  typeof useMutation<void, Error, { obra_id: string; data: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id, data }) => {
      const { error } = await supabase.rpc('definir_data_base', { _obra_id: obra_id, _data: data })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orcamento', 'data-base'] })
  })
}

/** Cria o rascunho; com `copiarDe`, traz grupos (anterior = atual do passado) e classificação. */
export function useCriarReajuste(): ReturnType<
  typeof useMutation<
    { id: string },
    Error,
    { obra_id: string; data: string; descricao?: string; copiarDe?: string | null }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b) => {
      // rascunho + grupos e classificação copiados, numa transação
      const { data, error } = await supabase.rpc('reajuste_criar', {
        _obra_id: b.obra_id,
        _data: b.data,
        _descricao: b.descricao ?? null,
        _copiar_de: b.copiarDe ?? null
      })
      if (error) throw error
      return { id: data as string }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orcamento', 'reajustes'] })
  })
}

export function useAtualizarReajuste(): ReturnType<
  typeof useMutation<void, Error, { id: string; data?: string; descricao?: string | null }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      const { error } = await supabase.from('orcamento_reajuste').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orcamento', 'reajustes'] })
  })
}

export function useExcluirReajuste(): ReturnType<typeof useMutation<void, Error, { id: string }>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('orcamento_reajuste').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orcamento', 'reajustes'] })
  })
}

export function useSalvarGrupo(): ReturnType<
  typeof useMutation<void, Error, Partial<ReajusteGrupo> & { reajuste_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...b }) => {
      const { error } = id
        ? await supabase.from('orcamento_reajuste_grupo').update(b).eq('id', id)
        : await supabase.from('orcamento_reajuste_grupo').insert(b)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['orcamento', 'reajuste-detalhe', v.reajuste_id] })
  })
}

export function useExcluirGrupo(): ReturnType<
  typeof useMutation<void, Error, { id: string; reajuste_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('orcamento_reajuste_grupo').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['orcamento', 'reajuste-detalhe', v.reajuste_id] })
  })
}

/** Classifica receitas num grupo (grupo_id null = retira da classificação). */
export function useClassificar(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { reajuste_id: string; receita_ids: string[]; grupo_id: string | null }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ reajuste_id, receita_ids, grupo_id }) => {
      if (receita_ids.length === 0) return
      if (grupo_id === null) {
        const { error } = await supabase
          .from('orcamento_reajuste_item')
          .delete()
          .eq('reajuste_id', reajuste_id)
          .in('receita_id', receita_ids)
        if (error) throw error
        return
      }
      const { error } = await supabase.from('orcamento_reajuste_item').upsert(
        receita_ids.map((receita_id) => ({ reajuste_id, receita_id, grupo_id })),
        { onConflict: 'reajuste_id,receita_id' }
      )
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['orcamento', 'reajuste-detalhe', v.reajuste_id] })
  })
}

export function useAplicarReajuste(): ReturnType<
  typeof useMutation<
    { numero: number; venda_antes: number; venda_depois: number },
    Error,
    { id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.rpc('aplicar_reajuste', { _reajuste_id: id })
      if (error) throw error
      return data as never
    },
    onSuccess: () => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
    }
  })
}
