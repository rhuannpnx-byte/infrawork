// POST /functions/v1/documentacao-ocr-texto
// Body: { documento_id, texto? }
//
// Camada de texto de um documento. Se `texto` vier (texto nativo extraído no
// processo MAIN), persiste como texto_layer. Senão, extrai via Mistral OCR —
// lida com nato-digital e escaneado, devolvendo markdown por página. Persiste
// texto_extraido (com marcadores [[page:N]]) na versão vigente.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { chamarMistralOcr, textoComMarcadores, MISTRAL_API_KEY } from '../_shared/doc-ia.ts'

interface Body {
  documento_id?: string
  texto?: string
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr
  const { admin } = ctx

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const documento_id = body.documento_id?.trim()
  if (!documento_id) return json({ error: 'documento_id é obrigatório' }, 400)

  const { data: doc } = await admin
    .from('documento')
    .select('id, obra_id')
    .eq('id', documento_id)
    .maybeSingle()
  if (!doc) return json({ error: 'Documento não encontrado' }, 404)

  const acc = await assertObraAccess(ctx, doc.obra_id, { write: true })
  if (acc) return acc

  const { data: versao } = await admin
    .from('documento_versao')
    .select('id, texto_extraido, texto_layer, ocr, storage_bucket, storage_key, mime, nome_original')
    .eq('documento_id', documento_id)
    .eq('vigente', true)
    .maybeSingle()
  if (!versao) return json({ error: 'Documento sem versão vigente' }, 422)

  // 1) Texto nativo veio pronto (do MAIN) → camada de texto, sem OCR.
  const textoNativo = body.texto?.trim()
  if (textoNativo) {
    await admin
      .from('documento_versao')
      .update({ texto_extraido: textoNativo, texto_layer: true, ocr: false })
      .eq('id', versao.id)
    return json({
      texto: textoNativo,
      paginas: [],
      texto_layer: true,
      ocr: false,
      confianca: 0.99
    })
  }

  // 2) Cache já existe.
  if (versao.texto_extraido?.trim()) {
    return json({
      texto: versao.texto_extraido,
      paginas: [],
      texto_layer: versao.texto_layer ?? false,
      ocr: versao.ocr ?? false,
      confianca: 0.9
    })
  }

  // 3) Sem Mistral configurado → devolve vazio graciosamente (não derruba o lote).
  if (!MISTRAL_API_KEY) {
    return json({ texto: '', paginas: [], texto_layer: false, ocr: false, confianca: 0 })
  }

  // 4) Extrai via Mistral OCR. Lê o PDF/imagem pela signed URL.
  const { data: signed } = await admin.storage
    .from(versao.storage_bucket)
    .createSignedUrl(versao.storage_key, 600)
  if (!signed?.signedUrl) return json({ error: 'Falha ao assinar o arquivo' }, 500)

  let res
  try {
    res = await chamarMistralOcr(signed.signedUrl, (versao.mime ?? '').toLowerCase())
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha no OCR' }, 502)
  }

  const paginas = (res.paginas ?? []).map((p) => ({ n: p.n, texto: p.markdown }))
  // texto_extraido carrega marcadores [[page:N]] p/ proveniência por página downstream.
  const textoMarc = textoComMarcadores(res.paginas ?? [])
  if (!textoMarc) {
    await admin
      .from('documento_versao')
      .update({ texto_layer: false, ocr: false })
      .eq('id', versao.id)
    return json({ texto: '', paginas: [], texto_layer: false, ocr: false, confianca: 0 })
  }

  await admin
    .from('documento_versao')
    .update({ texto_extraido: textoMarc, texto_layer: true, ocr: true })
    .eq('id', versao.id)

  return json({
    texto: textoMarc,
    paginas,
    texto_layer: true,
    ocr: true,
    confianca: res.confianca ?? 0.9
  })
})
