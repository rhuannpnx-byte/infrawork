// Ingestão de baixo nível (renderer): upload WORM + criação de documento/versão.
// Usado pela fila de ingestão em segundo plano (ingestao-store).

import { supabase, SUPABASE_ENABLED } from '@/lib/supabase/client'

const BUCKET = 'documentacao'

function notReady(): never {
  throw new Error('Supabase não configurado.')
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sanitizarNome(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, '_')
}

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
  zip: 'application/zip'
}

export function contentTypeUpload(nome: string, mime?: string | null): string {
  if (mime && mime.trim() !== '') return mime
  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  return UPLOAD_MIME[ext] ?? 'application/octet-stream'
}

export interface IngerirInput {
  obra_id: string
  titulo: string
  nome_original: string
  bytes: ArrayBuffer
  mime?: string | null
  fonte_path?: string | null
}

/**
 * Cria documento (placeholder tipo '20', a IA reclassifica) + versão vigente (v1)
 * e sobe o arquivo ao bucket WORM. Caminho mantém obra_id no 1º segmento (RLS).
 * Em falha após o insert, faz cleanup best-effort.
 */
export async function ingerirDocumento(
  body: IngerirInput
): Promise<{ documento_id: string; versao_id: string }> {
  if (!SUPABASE_ENABLED || !supabase) notReady()
  const hash = await sha256Hex(body.bytes)

  const { data: doc, error: errDoc } = await supabase
    .from('documento')
    .insert({
      obra_id: body.obra_id,
      tipo_codigo: '20',
      titulo: body.titulo,
      nome: body.nome_original,
      fonte_path: body.fonte_path ?? null,
      classificacao_origem: 'ia'
    })
    .select('id')
    .single()
  if (errDoc) throw errDoc
  const documentoId = (doc as { id: string }).id

  const ts = Date.now()
  const safe = sanitizarNome(body.nome_original)
  const path = `${body.obra_id}/sem-contrato/${documentoId}/${ts}-${safe}`
  const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, body.bytes, {
    cacheControl: '3600',
    upsert: false,
    contentType: contentTypeUpload(body.nome_original, body.mime)
  })
  if (errUp) {
    await supabase.from('documento').delete().eq('id', documentoId)
    throw new Error(`Storage: ${errUp.message}`)
  }

  const { data: ver, error: errVer } = await supabase
    .from('documento_versao')
    .insert({
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
    .select('id')
    .single()
  if (errVer) {
    await supabase.storage.from(BUCKET).remove([path])
    await supabase.from('documento').delete().eq('id', documentoId)
    throw errVer
  }

  return { documento_id: documentoId, versao_id: (ver as { id: string }).id }
}

/** Arquivamento MANUAL: define grupo/categoria sem IA (origem manual). */
export async function arquivarEmGrupo(
  documentoId: string,
  grupo_codigo: string,
  tipo_codigo: string
): Promise<void> {
  if (!SUPABASE_ENABLED || !supabase) return
  await supabase
    .from('documento')
    .update({
      grupo_codigo,
      tipo_codigo,
      categoria: tipo_codigo,
      classificacao_origem: 'manual'
    })
    .eq('id', documentoId)
}

/** Grava o verdito de aderência (orientação, não restrição). */
export async function registrarAderencia(
  documentoId: string,
  score: number,
  grupoSugerido: string | null
): Promise<void> {
  if (!SUPABASE_ENABLED || !supabase) return
  await supabase
    .from('documento')
    .update({ aderencia_score: score, aderencia_grupo_sugerido: grupoSugerido })
    .eq('id', documentoId)
}

/** URL assinada (1h) para abrir/visualizar a versão. */
export async function getDocumentoSignedUrl(bucket: string, key: string): Promise<string | null> {
  if (!SUPABASE_ENABLED || !supabase) return null
  const { data } = await supabase.storage.from(bucket).createSignedUrl(key, 3600)
  return data?.signedUrl ?? null
}
