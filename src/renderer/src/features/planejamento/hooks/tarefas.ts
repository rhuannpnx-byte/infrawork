import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

export function useTarefas(
  planejamentoId: string | null | undefined
): ReturnType<typeof useQuery<PlanejamentoTarefaCompleta[]>> {
  return useQuery({
    queryKey: ['planejamento', 'tarefas', planejamentoId],
    enabled: !!planejamentoId,
    queryFn: async (): Promise<PlanejamentoTarefaCompleta[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('vw_planejamento_tarefa_completa')
        .select('*')
        .eq('planejamento_id', planejamentoId!)
        .order('servico_grupo_codigo', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as PlanejamentoTarefaCompleta[]
    }
  })
}

export interface CreateTarefaInput {
  planejamento_id: string
  item_orcamentario_id: string
  ordem?: number
  notas?: string
  obra_id: string
}

export function useCreateTarefa(): ReturnType<
  typeof useMutation<{ id: string }, Error, CreateTarefaInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('planejamento_tarefa')
        .insert({
          planejamento_id: body.planejamento_id,
          item_orcamentario_id: body.item_orcamentario_id,
          ordem: body.ordem ?? 0,
          notas: body.notas ?? null
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}

export interface UpdateTarefaInput {
  id: string
  planejamento_id: string
  data_inicio?: string | null
  data_inicio_manual?: boolean
  notas?: string | null
  ordem?: number
  /** Posição espacial em METROS (sempre — UI converte de unidade display antes do mutate). */
  posicao_inicio_m?: number | null
  posicao_fim_m?: number | null
  unidade_espaco_display?: 'km' | 'm' | 'estaca' | null
}

export function useUpdateTarefa(): ReturnType<typeof useMutation<void, Error, UpdateTarefaInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, planejamento_id: _p, ...rest }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento_tarefa').update(rest).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}

export function useDeleteTarefa(): ReturnType<
  typeof useMutation<void, Error, { id: string; planejamento_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('planejamento_tarefa').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}

// ─── Sincronização com orçamento ───────────────────────────────────────
// Cria tarefas para todos os servico_grupo da obra que ainda não estão no
// planejamento. Retorna { criadas, ja_existentes }.
export function useSincronizarComOrcamento(): ReturnType<
  typeof useMutation<
    { criadas: number; ja_existentes: number },
    Error,
    { planejamento_id: string; obra_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ planejamento_id, obra_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: gruposExistentes, error: tarErr } = await supabase
        .from('planejamento_tarefa')
        .select('item_orcamentario_id')
        .eq('planejamento_id', planejamento_id)
      if (tarErr) throw tarErr
      const existentes = new Set((gruposExistentes ?? []).map((t) => t.item_orcamentario_id))

      const { data: grupos, error: grErr } = await supabase
        .from('item_orcamentario')
        .select('id, codigo')
        .eq('obra_id', obra_id)
        .eq('tipo', 'servico_grupo')
        .order('codigo')
      if (grErr) throw grErr

      const novos = (grupos ?? []).filter((g) => !existentes.has(g.id))
      if (novos.length === 0) return { criadas: 0, ja_existentes: existentes.size }

      const insertRows = novos.map((g, idx) => ({
        planejamento_id,
        item_orcamentario_id: g.id,
        ordem: existentes.size + idx
      }))
      const { error: insErr } = await supabase.from('planejamento_tarefa').insert(insertRows)
      if (insErr) throw insErr
      return { criadas: novos.length, ja_existentes: existentes.size }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}

// ─── Alocação de equipes ──────────────────────────────────────────────
export interface AlocarEquipeInput {
  tarefa_id: string
  equipe_id: string
  qtd_equipes: number
  planejamento_id: string
}

export function useAlocarEquipe(): ReturnType<typeof useMutation<void, Error, AlocarEquipeInput>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tarefa_id, equipe_id, qtd_equipes }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('planejamento_tarefa_equipe')
        .upsert(
          { tarefa_id, equipe_id, qtd_equipes },
          { onConflict: 'tarefa_id,equipe_id' }
        )
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}

export function useDesalocarEquipe(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { tarefa_id: string; equipe_id: string; planejamento_id: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tarefa_id, equipe_id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('planejamento_tarefa_equipe')
        .delete()
        .eq('tarefa_id', tarefa_id)
        .eq('equipe_id', equipe_id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
    }
  })
}
