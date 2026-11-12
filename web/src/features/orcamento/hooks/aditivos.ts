import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { invalidarCadeia } from '@/lib/query/cadeia'

export type AditivoStatus = 'rascunho' | 'aplicado'
export type AditivoItemTipo = 'quantidade' | 'exclusao' | 'novo'

export interface Aditivo {
  id: string
  obra_id: string
  numero: number
  data: string
  descricao: string | null
  status: AditivoStatus
  venda_antes: number | null
  venda_depois: number | null
  created_at: string
  aplicado_em: string | null
}

export interface AditivoAlocacao {
  criterio: 'percentual'
  compoe: boolean
  destinos: Array<{ grupo_id?: string; servico?: string; valor: number }>
}

export interface AditivoItem {
  id: string
  aditivo_id: string
  ordem: number
  tipo: AditivoItemTipo
  receita_id: string | null
  codigo: string
  descricao: string | null
  unidade: string | null
  quantidade_antes: number | null
  quantidade_nova: number | null
  venda_unitaria: number | null
  alocacao: AditivoAlocacao | null
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

export function useAditivos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Aditivo[]>> {
  return useQuery({
    queryKey: ['orcamento', 'aditivos', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Aditivo[]> => {
      const { data, error } = await supabase
        .from('orcamento_aditivo')
        .select(
          'id, obra_id, numero, data, descricao, status, venda_antes, venda_depois, created_at, aplicado_em'
        )
        .eq('obra_id', obraId!)
        .order('numero', { ascending: false })
      if (error) throw error
      return (data ?? []).map((a) => ({
        ...(a as Aditivo),
        venda_antes: num(a.venda_antes),
        venda_depois: num(a.venda_depois)
      }))
    }
  })
}

export function useAditivoItens(
  aditivoId: string | null | undefined
): ReturnType<typeof useQuery<AditivoItem[]>> {
  return useQuery({
    queryKey: ['orcamento', 'aditivo-itens', aditivoId],
    enabled: !!aditivoId,
    queryFn: async (): Promise<AditivoItem[]> => {
      const { data, error } = await supabase
        .from('orcamento_aditivo_item')
        .select(
          'id, aditivo_id, ordem, tipo, receita_id, codigo, descricao, unidade, quantidade_antes, quantidade_nova, venda_unitaria, alocacao'
        )
        .eq('aditivo_id', aditivoId!)
        .order('ordem')
        .order('created_at')
      if (error) throw error
      return (data ?? []).map((i) => ({
        ...(i as AditivoItem),
        quantidade_antes: num(i.quantidade_antes),
        quantidade_nova: num(i.quantidade_nova),
        venda_unitaria: num(i.venda_unitaria)
      }))
    }
  })
}

/** Snapshot da planilha arquivada no 1º aditivo (null = ainda sem aditivo). */
export function usePlanilhaInicial(obraId: string | null | undefined): ReturnType<
  typeof useQuery<{
    criada_em: string
    snapshot: { itens: Array<Record<string, unknown>>; totais?: { venda_total?: number } }
  } | null>
> {
  return useQuery({
    queryKey: ['orcamento', 'planilha-inicial', obraId],
    enabled: !!obraId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orcamento_planilha_inicial')
        .select('criada_em, snapshot')
        .eq('obra_id', obraId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as never
    }
  })
}

export function useCriarAditivo(): ReturnType<
  typeof useMutation<{ id: string }, Error, { obra_id: string; data: string; descricao?: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b) => {
      const { data, error } = await supabase
        .from('orcamento_aditivo')
        .insert({ obra_id: b.obra_id, data: b.data, descricao: b.descricao?.trim() || null })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orcamento', 'aditivos'] })
  })
}

export function useAtualizarAditivo(): ReturnType<
  typeof useMutation<void, Error, { id: string; data?: string; descricao?: string | null }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      const { error } = await supabase.from('orcamento_aditivo').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orcamento', 'aditivos'] })
  })
}

export function useExcluirAditivo(): ReturnType<typeof useMutation<void, Error, { id: string }>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('orcamento_aditivo').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orcamento', 'aditivos'] })
  })
}

export type AditivoItemInput = Partial<Omit<AditivoItem, 'aditivo_id'>> & {
  aditivo_id: string
  tipo: AditivoItemTipo
  codigo: string
}

export function useSalvarAditivoItem(): ReturnType<
  typeof useMutation<void, Error, AditivoItemInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...b }) => {
      const { error } = id
        ? await supabase.from('orcamento_aditivo_item').update(b).eq('id', id)
        : await supabase.from('orcamento_aditivo_item').insert(b)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['orcamento', 'aditivo-itens', v.aditivo_id] })
  })
}

export function useExcluirAditivoItem(): ReturnType<
  typeof useMutation<void, Error, { id: string; aditivo_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('orcamento_aditivo_item').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['orcamento', 'aditivo-itens', v.aditivo_id] })
  })
}

export function useAplicarAditivo(): ReturnType<
  typeof useMutation<
    { numero: number; venda_antes: number; venda_depois: number; novos: number },
    Error,
    { id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      const { data, error } = await supabase.rpc('aplicar_aditivo', { _aditivo_id: id })
      if (error) throw error
      return data as never
    },
    onSuccess: () => {
      invalidarCadeia(qc)
      void qc.invalidateQueries({ queryKey: ['acompanhamento'] })
    }
  })
}
