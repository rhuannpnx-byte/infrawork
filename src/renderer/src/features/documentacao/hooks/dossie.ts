// Hooks do ObraDossier (React Query). O dossiê é montado pela edge function
// documentacao-montar-dossie e validado por Zod no front (defensivo).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/supabase/functions'
import { ObraDossierSchema, type ObraDossier } from '@/types/documentacao'

export function useDossie(
  obraId: string | null | undefined,
  fresh = false
): ReturnType<typeof useQuery<ObraDossier>> {
  return useQuery({
    queryKey: ['documentacao', 'dossie', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<ObraDossier> => {
      const { dossie } = await adminApi.montarDossie({ obra_id: obraId!, fresh })
      // Validação tolerante: o backend é a fonte da verdade; logamos drift.
      const parsed = ObraDossierSchema.safeParse(dossie)
      if (!parsed.success) {
        console.warn('[dossie] schema drift', parsed.error.issues.slice(0, 5))
        return dossie as ObraDossier
      }
      return parsed.data
    }
  })
}

export function useReavaliarLacunas(): ReturnType<
  typeof useMutation<{ cobertura_essencial_pct: number }, Error, { obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ obra_id }) => {
      const r = await adminApi.reavaliarLacunas({ obra_id })
      await adminApi.montarDossie({ obra_id, fresh: true })
      return { cobertura_essencial_pct: r.cobertura_essencial_pct }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'dossie', vars.obra_id] })
    }
  })
}
