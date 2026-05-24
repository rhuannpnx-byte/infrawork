import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/supabase/functions'
import type { SyncResultadoItem } from '@/types/acompanhamento'

export interface SyncInput {
  obra_id: string
  force_full?: boolean
}

export interface SyncResposta {
  ok: boolean
  sincronizados: SyncResultadoItem[]
  duracao_ms: number
}

export function useSyncManual(): ReturnType<
  typeof useMutation<SyncResposta, Error, SyncInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => adminApi.acompanhamentoSync(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'link', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'producao', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['acompanhamento', 'fotos', vars.obra_id] })
    }
  })
}
