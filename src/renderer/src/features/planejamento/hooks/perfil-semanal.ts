import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { adminApi } from '@/lib/supabase/functions'
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
