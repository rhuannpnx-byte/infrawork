import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { Servico, ServicoTreeNode } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export function useServicos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Servico[]>> {
  return useQuery({
    queryKey: ['orcamento', 'servicos', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Servico[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('servico')
        .select(
          'id, obra_id, codigo, nome, parent_id, nivel, unidade, ativo, descricao, referencia_externa, created_at'
        )
        .eq('obra_id', obraId!)
        .order('codigo')
      if (error) throw error
      return (data ?? []) as Servico[]
    }
  })
}

/** Monta a árvore (parent_id) a partir da lista plana. */
export function buildServicoTree(servicos: Servico[]): ServicoTreeNode[] {
  const map = new Map<string, ServicoTreeNode>()
  const roots: ServicoTreeNode[] = []
  for (const s of servicos) {
    map.set(s.id, { ...s, children: [] })
  }
  for (const s of servicos) {
    const node = map.get(s.id)!
    if (s.parent_id && map.has(s.parent_id)) {
      map.get(s.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortRec = (arr: ServicoTreeNode[]): void => {
    arr.sort((a, b) => a.codigo.localeCompare(b.codigo))
    arr.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

export interface CreateServicoInput {
  obra_id: string
  codigo: string
  nome: string
  parent_id?: string | null
  unidade?: string | null
  descricao?: string
  referencia_externa?: string
}

export function useCreateServico(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateServicoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('servico')
        .insert({
          obra_id: body.obra_id,
          codigo: body.codigo.trim(),
          nome: body.nome.trim(),
          parent_id: body.parent_id ?? null,
          unidade: body.unidade?.trim() || null,
          descricao: body.descricao?.trim() || null,
          referencia_externa: body.referencia_externa?.trim() || null
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servicos'] })
    }
  })
}

export interface UpdateServicoInput {
  id: string
  codigo?: string
  nome?: string
  parent_id?: string | null
  unidade?: string | null
  ativo?: boolean
  descricao?: string | null
  referencia_externa?: string | null
}

export function useUpdateServico(): ReturnType<
  typeof useMutation<void, Error, UpdateServicoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('servico').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servicos'] })
    }
  })
}

export function useToggleAtivoServico(): ReturnType<
  typeof useMutation<void, Error, { id: string; ativo: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ativo }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('servico').update({ ativo }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'servicos'] })
    }
  })
}
