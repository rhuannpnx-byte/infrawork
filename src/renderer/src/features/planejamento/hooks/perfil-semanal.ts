import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { adminApi } from '@/lib/supabase/functions'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { SemanaPerfil } from '@/types/planejamento'

export interface SalvarPerfilCustomizadoInput {
  tarefa_id: string
  planejamento_id: string
  semanas: SemanaPerfil[]
}

export interface SalvarPerfilCustomizadoResult {
  ok: boolean
  tarefa_id: string
  semanas_salvas: number
}

/**
 * Salva perfil customizado de uma tarefa via RPC atomica.
 * Constraint trigger DEFERRED valida soma; se diverge da
 * quantidade_referencia além de 0.1%, retorna HTTP 422.
 *
 * Após sucesso, `usa_perfil_customizado = true` na tarefa.
 * Edge function calcular-cronograma preserva perfis customizados.
 */
export function useSalvarPerfilCustomizado(): UseMutationResult<
  SalvarPerfilCustomizadoResult,
  Error,
  SalvarPerfilCustomizadoInput
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input) => {
      const r = await adminApi.salvarPerfilSemanaCustomizado({
        tarefa_id: input.tarefa_id,
        semanas: input.semanas.map((s) => ({
          semana_segunda: s.semana_segunda,
          quantidade_planejada: s.quantidade_planejada
        }))
      })
      return r
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ['planejamento', 'tarefas', vars.planejamento_id]
      })
    }
  })
}

export interface ReverterPerfilInput {
  tarefa_id: string
  planejamento_id: string
}

/**
 * Reverte perfil customizado pra "default":
 *   - DELETE rows de planejamento_tarefa_perfil_semana da tarefa.
 *   - UPDATE planejamento_tarefa SET usa_perfil_customizado = false.
 *
 * Próximo `calcular-cronograma` regenera com `perfil_default`. RLS
 * controla acesso (engenheiro+ na obra).
 */
export function useReverterParaPerfilDefault(): UseMutationResult<
  void,
  Error,
  ReverterPerfilInput
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input) => {
      if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
      const { error: delErr } = await supabase
        .from('planejamento_tarefa_perfil_semana')
        .delete()
        .eq('tarefa_id', input.tarefa_id)
      if (delErr) throw delErr
      const { error: updErr } = await supabase
        .from('planejamento_tarefa')
        .update({ usa_perfil_customizado: false })
        .eq('id', input.tarefa_id)
      if (updErr) throw updErr
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ['planejamento', 'tarefas', vars.planejamento_id]
      })
    }
  })
}
