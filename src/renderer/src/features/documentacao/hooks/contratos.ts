import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import { removerArquivosDosDocumentos } from './documentos'
import type { Contrato, ExtrairContratoResposta, NaturezaContrato } from '@/types/documentacao'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const COLS =
  'id, empresa_id, obra_id, numero, processo_sei, contratante, natureza, consorcio, objeto, ' +
  'modalidade_regime, lei, vigencia_inicio, vigencia_fim, prazo_vigencia_meses, ' +
  'execucao_inicio, execucao_fim, valor_original, valor_atual, pct_aditado, fiscal_responsavel, ' +
  'reajuste_indice, reajuste_periodicidade_meses, reajuste_data_base, reajuste_elegivel_em, ' +
  'status, created_by, created_at'

export function useContratos(
  obraId: string | null | undefined
): ReturnType<typeof useQuery<Contrato[]>> {
  return useQuery({
    queryKey: ['documentacao', 'contratos', obraId],
    enabled: !!obraId,
    queryFn: async (): Promise<Contrato[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('contrato')
        .select(COLS)
        .eq('obra_id', obraId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Contrato[]
    }
  })
}

export function useContrato(
  contratoId: string | null | undefined
): ReturnType<typeof useQuery<Contrato | null>> {
  return useQuery({
    queryKey: ['documentacao', 'contrato', contratoId],
    enabled: !!contratoId,
    queryFn: async (): Promise<Contrato | null> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('contrato')
        .select(COLS)
        .eq('id', contratoId!)
        .maybeSingle()
      if (error) throw error
      return (data as unknown as Contrato) ?? null
    }
  })
}

export interface CriarContratoInput {
  obra_id: string
  numero: string
  processo_sei?: string | null
  contratante?: string | null
  natureza?: NaturezaContrato
  objeto?: string | null
  modalidade_regime?: string | null
  lei?: string | null
  vigencia_inicio?: string | null
  vigencia_fim?: string | null
  prazo_vigencia_meses?: number | null
  execucao_inicio?: string | null
  execucao_fim?: string | null
  valor_original?: number | null
  fiscal_responsavel?: string | null
  reajuste_indice?: string | null
  reajuste_periodicidade_meses?: number | null
  reajuste_data_base?: string | null
  reajuste_elegivel_em?: string | null
}

export function useCriarContrato(): ReturnType<
  typeof useMutation<{ id: string }, Error, CriarContratoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // empresa_id é derivado por trigger no banco a partir de obra_id.
      const { data, error } = await supabase
        .from('contrato')
        .insert({
          obra_id: body.obra_id,
          numero: body.numero,
          processo_sei: body.processo_sei ?? null,
          contratante: body.contratante ?? null,
          natureza: body.natureza ?? 'publico',
          objeto: body.objeto ?? null,
          modalidade_regime: body.modalidade_regime ?? null,
          lei: body.lei ?? null,
          vigencia_inicio: body.vigencia_inicio ?? null,
          vigencia_fim: body.vigencia_fim ?? null,
          prazo_vigencia_meses: body.prazo_vigencia_meses ?? null,
          execucao_inicio: body.execucao_inicio ?? null,
          execucao_fim: body.execucao_fim ?? null,
          valor_original: body.valor_original ?? null,
          valor_atual: body.valor_original ?? null,
          fiscal_responsavel: body.fiscal_responsavel ?? null,
          reajuste_indice: body.reajuste_indice ?? null,
          reajuste_periodicidade_meses: body.reajuste_periodicidade_meses ?? null,
          reajuste_data_base: body.reajuste_data_base ?? null,
          reajuste_elegivel_em: body.reajuste_elegivel_em ?? null
        })
        .select('id')
        .single()
      if (error) throw error
      return { id: data.id as string }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'contratos', vars.obra_id] })
    }
  })
}

const BUCKET = 'documentacao'

function sanitizarNome(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Exclui um contrato e TODO o seu acervo: remove os arquivos de Storage de todos
 * os documentos e apaga o contrato. Documentos, versões e chunks de embedding
 * caem por ON DELETE CASCADE (FKs encadeadas a partir de contrato).
 */
export function useExcluirContrato(): ReturnType<
  typeof useMutation<void, Error, { id: string; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data: docs } = await supabase.from('documento').select('id').eq('contrato_id', id)
      const docIds = ((docs ?? []) as Array<{ id: string }>).map((d) => d.id)
      await removerArquivosDosDocumentos(docIds)
      const { error } = await supabase.from('contrato').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'contratos', vars.obra_id] })
      void qc.invalidateQueries({ queryKey: ['documentacao', 'documentos', vars.obra_id] })
    }
  })
}

export interface ExtrairContratoVars {
  obra_id: string
  file: File
}

/**
 * Extrai as entidades do contrato a partir de um arquivo (PDF/imagem) usando IA:
 * sobe o arquivo a um prefixo temporário do bucket, gera signed URL, chama a
 * Edge Function `documentacao-extrair-contrato` (OCR + extração) e remove o temp.
 * O arquivo original fica com o chamador para, depois de confirmar, ser ingerido
 * como o documento "03 — Contrato".
 */
export function useExtrairContratoDeArquivo(): ReturnType<
  typeof useMutation<ExtrairContratoResposta, Error, ExtrairContratoVars>
> {
  return useMutation({
    mutationFn: async ({ obra_id, file }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const ts = Date.now()
      const path = `${obra_id}/_extracao/${ts}-${sanitizarNome(file.name)}`
      const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '60',
        upsert: true,
        contentType: file.type || undefined
      })
      if (errUp) throw new Error(`Storage: ${errUp.message}`)
      try {
        const { data: signed, error: errSign } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, 600)
        if (errSign || !signed) throw new Error(errSign?.message ?? 'Falha ao assinar URL')
        return await adminApi.extrairContrato({
          obra_id,
          arquivo_url: signed.signedUrl,
          mime: file.type || 'application/pdf',
          nome: file.name
        })
      } finally {
        // Limpa o arquivo temporário (best-effort).
        await supabase.storage.from(BUCKET).remove([path])
      }
    }
  })
}
