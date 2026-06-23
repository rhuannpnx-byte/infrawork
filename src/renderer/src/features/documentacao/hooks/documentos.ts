import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'
import { adminApi } from '@/lib/supabase/functions'
import type {
  Documento,
  DocumentoComVigente,
  DocumentoStatus,
  DocumentoVersao,
  OrigemIngestao
} from '@/types/documentacao'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

const BUCKET = 'documentacao'

const DOC_COLS =
  'id, empresa_id, obra_id, contrato_id, tipo_codigo, titulo, status, origem, ' +
  'classificacao_confianca, classificacao_origem, created_by, created_at'

const VERSAO_COLS =
  'id, documento_id, versao, vigente, storage_bucket, storage_key, hash_sha256, ' +
  'nome_original, mime, tamanho_bytes, observacao, created_by, created_at'

/**
 * Lista documentos da obra (opcionalmente de um contrato), já com a versão
 * vigente, o número do contrato e o nome da categoria — pronto para a tabela
 * do repositório. Filtrar por contrato/tipo/status vira filtro de coluna na UI.
 */
export function useDocumentos(
  obraId: string | null | undefined,
  contratoId?: string | null
): ReturnType<typeof useQuery<DocumentoComVigente[]>> {
  return useQuery({
    queryKey: ['documentacao', 'documentos', obraId, contratoId ?? null],
    enabled: !!obraId,
    queryFn: async (): Promise<DocumentoComVigente[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      let q = supabase
        .from('documento')
        .select(
          `${DOC_COLS}, contrato:contrato_id(numero), tipo:tipo_codigo(nome), ` +
            `versoes:documento_versao(${VERSAO_COLS})`
        )
        .eq('obra_id', obraId!)
        .order('created_at', { ascending: false })
      if (contratoId) q = q.eq('contrato_id', contratoId)
      const { data, error } = await q
      if (error) throw error
      return ((data ?? []) as unknown[]).map((row) => {
        const r = row as Documento & {
          contrato: { numero: string } | null
          tipo: { nome: string } | null
          versoes: DocumentoVersao[]
        }
        const vigente = (r.versoes ?? []).find((v) => v.vigente) ?? null
        return {
          ...r,
          versao_vigente: vigente,
          contrato_numero: r.contrato?.numero ?? null,
          tipo_nome: r.tipo?.nome ?? null
        }
      })
    }
  })
}

/** Todas as versões de um documento (histórico — a vigente é destacada na UI). */
export function useDocumentoVersoes(
  documentoId: string | null | undefined
): ReturnType<typeof useQuery<DocumentoVersao[]>> {
  return useQuery({
    queryKey: ['documentacao', 'versoes', documentoId],
    enabled: !!documentoId,
    queryFn: async (): Promise<DocumentoVersao[]> => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { data, error } = await supabase
        .from('documento_versao')
        .select(VERSAO_COLS)
        .eq('documento_id', documentoId!)
        .order('versao', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DocumentoVersao[]
    }
  })
}

/** SHA-256 hex do conteúdo (dedup por conteúdo — combina com uq_doc_versao_hash). */
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sanitizarNome(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** MIME por extensão para o upload (Storage exige Content-Type válido). */
const UPLOAD_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  json: 'application/json',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf'
}

/**
 * Content-Type confiável para o upload: usa o MIME informado (se não vazio),
 * senão deriva da extensão; nunca retorna vazio/undefined — o Storage rejeita
 * (400 "Invalid Content-Type header") quando o header não é um MIME válido.
 */
function contentTypeUpload(nome: string, mime?: string | null): string {
  if (mime && mime.trim() !== '') return mime
  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  return UPLOAD_MIME[ext] ?? 'application/octet-stream'
}

export interface IngerirDocumentoInput {
  obra_id: string
  contrato_id: string
  tipo_codigo: string
  titulo: string
  status?: DocumentoStatus
  origem?: OrigemIngestao
  /** Bytes do arquivo (drag-drop: do File; pasta local: do main process). */
  bytes: ArrayBuffer
  nome_original: string
  mime?: string | null
}

/**
 * Ingestão de um documento (função pura, sem hook): cria `documento` +
 * `documento_versao` (v1, vigente) e sobe o arquivo ao bucket privado. WORM:
 * nunca sobrescreve a origem; cria cópia governada. Em falha após o insert, faz
 * cleanup best-effort. Usada tanto pela fila de ingestão em segundo plano quanto
 * pelo hook abaixo.
 */
export async function ingerirDocumento(
  body: IngerirDocumentoInput
): Promise<{ documento_id: string }> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  const hash = await sha256Hex(body.bytes)

  // 1) cria o documento (empresa_id derivado por trigger)
  const { data: doc, error: errDoc } = await supabase
    .from('documento')
    .insert({
      obra_id: body.obra_id,
      contrato_id: body.contrato_id,
      tipo_codigo: body.tipo_codigo,
      titulo: body.titulo,
      status: body.status ?? 'vigente',
      origem: body.origem ?? 'drag_drop'
    })
    .select('id')
    .single()
  if (errDoc) throw errDoc
  const documentoId = doc.id as string

  // 2) sobe o arquivo: <obra_id>/<contrato_id>/<doc_id>/<ts>-<nome>
  const ts = Date.now()
  const safe = sanitizarNome(body.nome_original)
  const path = `${body.obra_id}/${body.contrato_id}/${documentoId}/${ts}-${safe}`
  const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, body.bytes, {
    cacheControl: '3600',
    upsert: false,
    contentType: contentTypeUpload(body.nome_original, body.mime)
  })
  if (errUp) {
    await supabase.from('documento').delete().eq('id', documentoId)
    throw new Error(`Storage: ${errUp.message}`)
  }

  // 3) cria a versão vigente (v1)
  const { error: errVer } = await supabase.from('documento_versao').insert({
    documento_id: documentoId,
    versao: 1,
    vigente: true,
    storage_bucket: BUCKET,
    storage_key: path,
    hash_sha256: hash,
    nome_original: body.nome_original,
    mime: body.mime ?? null,
    tamanho_bytes: body.bytes.byteLength
  })
  if (errVer) {
    await supabase.storage.from(BUCKET).remove([path])
    await supabase.from('documento').delete().eq('id', documentoId)
    throw errVer
  }

  return { documento_id: documentoId }
}

/**
 * Hook de ingestão de um único documento (foreground) — usado na criação de
 * contrato. A ingestão em lote roda em segundo plano (ver ingestao-store).
 */
export function useIngerirDocumento(): ReturnType<
  typeof useMutation<{ documento_id: string }, Error, IngerirDocumentoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => ingerirDocumento(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'documentos', vars.obra_id] })
    }
  })
}

export interface AtualizarDocumentoInput {
  id: string
  obra_id: string
  titulo?: string
  status?: DocumentoStatus
  tipo_codigo?: string
}

export function useAtualizarDocumento(): ReturnType<
  typeof useMutation<void, Error, AtualizarDocumentoInput>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      // Monta o patch só com campos definidos (undefined é omitido na serialização).
      const patch = {
        titulo: input.titulo,
        status: input.status,
        tipo_codigo: input.tipo_codigo
      }
      const { error } = await supabase.from('documento').update(patch).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'documentos', vars.obra_id] })
    }
  })
}

/** URL temporária assinada (1h) para abrir/baixar a versão. */
export async function getDocumentoSignedUrl(
  storageBucket: string,
  storageKey: string
): Promise<string | null> {
  if (!SUPABASE_ENABLED || !supabase) return null
  const { data } = await supabase.storage.from(storageBucket).createSignedUrl(storageKey, 3600)
  return data?.signedUrl ?? null
}

/** Abre a versão vigente de um documento (pela id) numa nova aba via signed URL. */
export async function abrirDocumentoPorId(documentoId: string): Promise<boolean> {
  if (!SUPABASE_ENABLED || !supabase) return false
  const { data: v } = await supabase
    .from('documento_versao')
    .select('storage_bucket, storage_key')
    .eq('documento_id', documentoId)
    .eq('vigente', true)
    .maybeSingle()
  if (!v) return false
  const url = await getDocumentoSignedUrl(v.storage_bucket, v.storage_key)
  if (!url) return false
  window.open(url, '_blank')
  return true
}

/** Remove os arquivos de Storage de um conjunto de documentos (agrupado por bucket). */
async function removerArquivosDosDocumentos(documentoIds: string[]): Promise<void> {
  if (!supabase || documentoIds.length === 0) return
  const { data: versoes } = await supabase
    .from('documento_versao')
    .select('storage_bucket, storage_key')
    .in('documento_id', documentoIds)
  const porBucket = new Map<string, string[]>()
  for (const v of (versoes ?? []) as Array<{ storage_bucket: string; storage_key: string }>) {
    const arr = porBucket.get(v.storage_bucket) ?? []
    arr.push(v.storage_key)
    porBucket.set(v.storage_bucket, arr)
  }
  for (const [bucket, keys] of porBucket) {
    if (keys.length) await supabase.storage.from(bucket).remove(keys)
  }
}

/**
 * Exclui documentos: remove os arquivos do Storage e apaga as linhas. As versões
 * e os chunks de embedding caem por ON DELETE CASCADE (FK em documento).
 */
export function useExcluirDocumentos(): ReturnType<
  typeof useMutation<void, Error, { ids: string[]; obra_id: string }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      if (ids.length === 0) return
      await removerArquivosDosDocumentos(ids)
      const { error } = await supabase.from('documento').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'documentos', vars.obra_id] })
    }
  })
}

export { removerArquivosDosDocumentos }

const MIME_POR_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

function mimePorNome(nome: string): string {
  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  return MIME_POR_EXT[ext] ?? 'application/pdf'
}

/**
 * Classifica um documento JÁ ingerido pelo conteúdo (assina a versão vigente e
 * chama a IA) + a nomenclatura da pasta de origem, e atualiza tipo/título.
 * Retorna o código aplicado (ou null em falha — não interrompe o lote).
 */
export async function classificarDocumentoExistente(
  documentoId: string,
  obraId: string,
  pasta: string | null
): Promise<string | null> {
  if (!SUPABASE_ENABLED || !supabase) return null
  const { data: v } = await supabase
    .from('documento_versao')
    .select('storage_bucket, storage_key, nome_original, mime')
    .eq('documento_id', documentoId)
    .eq('vigente', true)
    .maybeSingle()
  if (!v) return null
  const { data: signed } = await supabase.storage
    .from(v.storage_bucket)
    .createSignedUrl(v.storage_key, 600)
  if (!signed?.signedUrl) return null
  try {
    const res = await adminApi.classificarDocumento({
      obra_id: obraId,
      arquivo_url: signed.signedUrl,
      mime: v.mime || mimePorNome(v.nome_original),
      nome: v.nome_original,
      pasta: pasta ?? undefined
    })
    await supabase
      .from('documento')
      .update({
        tipo_codigo: res.tipo_codigo,
        titulo: res.titulo_sugerido || undefined,
        classificacao_confianca: res.confianca,
        classificacao_origem: 'ia'
      })
      .eq('id', documentoId)
    // Semente de aprendizado (few-shot): a sugestão aceita na ingestão.
    await supabase.from('documento_classificacao_feedback').insert({
      obra_id: obraId,
      documento_id: documentoId,
      nome_arquivo: v.nome_original,
      pasta_origem: pasta,
      tipo_sugerido: res.tipo_codigo,
      tipo_final: res.tipo_codigo,
      acao: 'aceito'
    })
    return res.tipo_codigo
  } catch {
    return null
  }
}

/**
 * Reclassificação MANUAL de um documento (correção do usuário): atualiza o tipo
 * e grava o feedback como 'corrigido' — sinal forte para o few-shot da IA.
 */
export function useReclassificarDocumento(): ReturnType<
  typeof useMutation<
    void,
    Error,
    {
      documento_id: string
      obra_id: string
      tipo_codigo: string
      tipo_sugerido?: string | null
      nome: string
    }
  >
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ documento_id, obra_id, tipo_codigo, tipo_sugerido, nome }) => {
      if (!SUPABASE_ENABLED || !supabase) notReady()
      const { error } = await supabase
        .from('documento')
        .update({ tipo_codigo, classificacao_origem: 'manual' })
        .eq('id', documento_id)
      if (error) throw error
      await supabase.from('documento_classificacao_feedback').insert({
        obra_id,
        documento_id,
        nome_arquivo: nome,
        tipo_sugerido: tipo_sugerido ?? null,
        tipo_final: tipo_codigo,
        acao: tipo_sugerido && tipo_sugerido !== tipo_codigo ? 'corrigido' : 'aceito'
      })
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['documentacao', 'documentos', vars.obra_id] })
    }
  })
}
