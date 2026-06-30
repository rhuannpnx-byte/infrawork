import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { Recurso, RecursoGrupo, RecursoPreco } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
}

// ─── Recursos ────────────────────────────────────────────────────────────

export function useRecursos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Recurso[]>> {
  return useQuery({
    queryKey: ['orcamento', 'recursos', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Recurso[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('vw_recurso_com_preco')
        .select(
          'id, obra_id, codigo, grupo, nome, unidade, ativo, fonte, observacao, created_at, updated_at, preco_vigente'
        )
        .eq('obra_id', obraId!)
        .order('grupo')
        .order('nome')
      if (error) throw error
      return (data ?? []) as Recurso[]
    }
  })
}

export interface CreateRecursoInput {
  obra_id: string
  codigo?: string
  grupo: RecursoGrupo
  nome: string
  unidade: string
  fonte?: string
  observacao?: string
  /** Se informado, cria o primeiro preço vigente junto. */
  preco_inicial?: number
  preco_vigencia_inicio?: string
}

export function useCreateRecurso(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateRecursoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const insertRecurso = {
        obra_id: body.obra_id,
        codigo: body.codigo?.trim() || null,
        grupo: body.grupo,
        nome: body.nome.trim(),
        unidade: body.unidade.trim(),
        fonte: body.fonte?.trim() || null,
        observacao: body.observacao?.trim() || null
      }
      const { data: rec, error: errRec } = await supabase
        .from('recurso')
        .insert(insertRecurso)
        .select('id')
        .single()
      if (errRec) throw errRec

      if (body.preco_inicial !== undefined && body.preco_inicial !== null) {
        // Primeiro preço já entra como vigente (único do recurso).
        const { error: errPreco } = await supabase.from('recurso_preco').insert({
          recurso_id: rec.id,
          custo_unitario: body.preco_inicial,
          vigencia_inicio: body.preco_vigencia_inicio || new Date().toISOString().slice(0, 10),
          is_vigente: true
        })
        if (errPreco) throw errPreco
      }
      return { id: rec.id as string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
    }
  })
}

export interface UpdateRecursoInput {
  id: string
  codigo?: string | null
  grupo?: RecursoGrupo
  nome?: string
  unidade?: string
  ativo?: boolean
  fonte?: string | null
  observacao?: string | null
}

export function useUpdateRecurso(): ReturnType<
  typeof useMutation<void, Error, UpdateRecursoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('recurso')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
    }
  })
}

export function useToggleAtivoRecurso(): ReturnType<
  typeof useMutation<void, Error, { id: string; ativo: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ativo }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('recurso')
        .update({ ativo, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
    }
  })
}

/** Apaga um recurso. Cascade do schema remove recurso_preco vinculados.
 *  Se o recurso está usado em alguma CPU (cpu_item), o delete falha por FK. */
export function useDeleteRecurso(): ReturnType<typeof useMutation<void, Error, { id: string }>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('recurso').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
      // Cascata de delete pode ter mexido em cpu_item / cpu (recalc).
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpus'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
    }
  })
}

// ─── Preços ──────────────────────────────────────────────────────────────

export function useRecursoPrecos(
  recursoId: string | null | undefined
): ReturnType<typeof useQuery<RecursoPreco[]>> {
  return useQuery({
    queryKey: ['orcamento', 'recurso-precos', recursoId],
    enabled: !!recursoId,
    queryFn: async (): Promise<RecursoPreco[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('recurso_preco')
        .select(
          'id, recurso_id, custo_unitario, vigencia_inicio, vigencia_fim, is_vigente, origem, documento_url, observacao, criado_por, created_at'
        )
        .eq('recurso_id', recursoId!)
        // Histórico ordenado pela data de inserção (mais recente primeiro).
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as RecursoPreco[]
    }
  })
}

export interface AddRecursoPrecoInput {
  recurso_id: string
  custo_unitario: number
  vigencia_inicio: string
  vigencia_fim?: string | null
  origem?: string
  observacao?: string
  /** Se true (default), o novo preço passa a ser o vigente do recurso. */
  marcar_vigente?: boolean
}

export function useAddRecursoPreco(): ReturnType<
  typeof useMutation<{ id: string }, Error, AddRecursoPrecoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // Apenas insere no histórico. A vigência é explícita: o usuário marca
      // qual preço vale (ou marcamos este, quando pedido).
      const { data, error } = await supabase
        .from('recurso_preco')
        .insert({
          recurso_id: body.recurso_id,
          custo_unitario: body.custo_unitario,
          vigencia_inicio: body.vigencia_inicio,
          vigencia_fim: body.vigencia_fim ?? null,
          origem: body.origem?.trim() || null,
          observacao: body.observacao?.trim() || null
        })
        .select('id')
        .single()
      if (error) throw error
      const novoId = data.id as string
      if (body.marcar_vigente !== false) {
        const { error: errVig } = await supabase.rpc('set_recurso_preco_vigente', {
          _preco_id: novoId
        })
        if (errVig) throw errVig
      }
      return { id: novoId }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recurso-precos', vars.recurso_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
    }
  })
}

/** Marca explicitamente qual preço do histórico é o vigente do recurso. */
export function useSetRecursoPrecoVigente(): ReturnType<
  typeof useMutation<void, Error, { preco_id: string; recurso_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ preco_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.rpc('set_recurso_preco_vigente', { _preco_id: preco_id })
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recurso-precos', vars.recurso_id] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'recursos'] })
      void qc.invalidateQueries({ queryKey: ['orcamento', 'cpu'] })
    }
  })
}
