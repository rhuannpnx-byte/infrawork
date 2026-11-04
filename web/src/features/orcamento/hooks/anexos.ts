import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'
import type { Anexo, AnexoEscopo } from '@/types/orcamento'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const COLS =
  'id, obra_id, escopo, escopo_id, nome, storage_path, mime, tamanho_bytes, autor_id, created_at'

export function useAnexos(
  escopo: AnexoEscopo,
  escopoId: string | null | undefined
): ReturnType<typeof useQuery<Anexo[]>> {
  return useQuery({
    queryKey: ['orcamento', 'anexos', escopo, escopoId],
    enabled: !!escopoId,
    queryFn: async (): Promise<Anexo[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('anexo')
        .select(COLS)
        .eq('escopo', escopo)
        .eq('escopo_id', escopoId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Anexo[]
    }
  })
}

export interface UploadAnexoInput {
  obra_id: string
  escopo: AnexoEscopo
  escopo_id: string
  file: File
}

export function useUploadAnexo(): ReturnType<
  typeof useMutation<{ id: string }, Error, UploadAnexoInput>
> {
  const qc = useQueryClient()
  const callerId = useAuthStore((s) => s.profile?.id ?? null)
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // Storage path: <obra_id>/<escopo>/<escopo_id>/<timestamp>-<nome>
      const ts = Date.now()
      const safe = body.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${body.obra_id}/${body.escopo}/${body.escopo_id}/${ts}-${safe}`

      const { error: errUp } = await supabase.storage.from('orcamento').upload(path, body.file, {
        cacheControl: '3600',
        upsert: false,
        contentType: body.file.type || undefined
      })
      if (errUp) throw new Error(`Storage: ${errUp.message}`)

      const { data, error } = await supabase
        .from('anexo')
        .insert({
          obra_id: body.obra_id,
          escopo: body.escopo,
          escopo_id: body.escopo_id,
          nome: body.file.name,
          storage_path: path,
          mime: body.file.type || null,
          tamanho_bytes: body.file.size,
          autor_id: callerId
        })
        .select('id')
        .single()
      if (error) {
        // Rollback do arquivo (best effort)
        await supabase.storage.from('orcamento').remove([path])
        throw error
      }
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'anexos', vars.escopo, vars.escopo_id] })
    }
  })
}

export function useDeleteAnexo(): ReturnType<
  typeof useMutation<
    void,
    Error,
    { id: string; escopo: AnexoEscopo; escopo_id: string; storage_path: string }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, storage_path }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase.from('anexo').delete().eq('id', id)
      if (error) throw error
      await supabase.storage.from('orcamento').remove([storage_path])
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['orcamento', 'anexos', vars.escopo, vars.escopo_id] })
    }
  })
}

/**
 * Cria URL temporária assinada (1h) para download/preview.
 */
export async function getAnexoSignedUrl(storagePath: string): Promise<string | null> {
  if (!SUPABASE_ENABLED || !supabase) return null
  const { data } = await supabase.storage.from('orcamento').createSignedUrl(storagePath, 3600)
  return data?.signedUrl ?? null
}
