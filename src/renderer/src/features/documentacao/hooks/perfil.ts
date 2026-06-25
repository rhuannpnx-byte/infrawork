// Perfil da obra (obra_perfil): peculiaridades que adaptam o template/grupos —
// consórcio, natureza (público/privado) e órgão. Acesso direto ao Supabase (RLS).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import type { NaturezaContrato, PerfilOrgao } from '@/types/documentacao'

function cli(): NonNullable<typeof supabase> {
  if (!SUPABASE_ENABLED || !supabase) throw new Error('Supabase não configurado.')
  return supabase
}

export interface ObraPerfil {
  obra_id: string
  perfil_orgao: PerfilOrgao
  orgao: string | null
  natureza: NaturezaContrato
  consorcio: boolean
}

const PADRAO: Omit<ObraPerfil, 'obra_id'> = {
  perfil_orgao: 'DNIT',
  orgao: null,
  natureza: 'publico',
  consorcio: false
}

export function useObraPerfil(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<ObraPerfil>> {
  return useQuery({
    queryKey: ['documentacao', 'obra-perfil', obraId],
    enabled: !!obraId && SUPABASE_ENABLED,
    queryFn: async (): Promise<ObraPerfil> => {
      const { data } = await cli()
        .from('obra_perfil')
        .select('obra_id, perfil_orgao, orgao, natureza, consorcio')
        .eq('obra_id', obraId!)
        .maybeSingle()
      return { obra_id: obraId!, ...PADRAO, ...(data ?? {}) } as ObraPerfil
    }
  })
}

export function useSalvarObraPerfil(): ReturnType<
  typeof useMutation<void, Error, Partial<ObraPerfil> & { obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch) => {
      const { error } = await cli().from('obra_perfil').upsert(patch, { onConflict: 'obra_id' })
      if (error) throw error
    },
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['documentacao', 'obra-perfil', v.obra_id] })
  })
}
