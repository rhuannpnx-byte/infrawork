// POST /functions/v1/documentacao-embeddings
// Body: { documento_id, texto? }
//
// Gera os embeddings de um documento: obtém o texto (na ordem: `texto` do body →
// texto_extraido já salvo → OCR próprio via OpenRouter), quebra em chunks e
// vetoriza com a IA NATIVA do Supabase (gte-small, 384 dims). Re-executar
// substitui os chunks antigos (idempotente). Base do RAG do agente.
//
// Declaração mínima do runtime de IA do Supabase Edge Functions.
// deno-lint-ignore no-explicit-any
declare const Supabase: any

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''
const OPENROUTER_MODEL =
  Deno.env.get('OPENROUTER_MODEL_DOC_OCR') ??
  Deno.env.get('OPENROUTER_MODEL_DOC_EXTRACAO') ??
  'anthropic/claude-opus-4-8'
const PDF_ENGINE = Deno.env.get('OPENROUTER_PDF_ENGINE') ?? ''

interface Body {
  documento_id?: string
  texto?: string
}

/** OCR/transcrição integral do documento via OpenRouter (fallback p/ embeddings). */
async function transcrever(arquivoUrl: string, mime: string, nome: string): Promise<string> {
  if (!OPENROUTER_API_KEY) return ''
  const isImagem = mime.startsWith('image/')
  const conteudo = isImagem
    ? { type: 'image_url', image_url: { url: arquivoUrl } }
    : { type: 'file', file: { filename: nome, file_data: arquivoUrl } }
  const reqBody: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    temperature: 0,
    max_tokens: 16000,
    messages: [
      {
        role: 'system',
        content:
          'Transcreva FIELMENTE todo o texto legível do documento, preservando a ordem e a estrutura (títulos, cláusulas, itens). Não resuma, não comente, não use markdown de cerca. Apenas o texto.'
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Transcreva o documento na íntegra.' }, conteudo]
      }
    ]
  }
  if (!isImagem && PDF_ENGINE) {
    reqBody.plugins = [{ id: 'file-parser', pdf: { engine: PDF_ENGINE } }]
  }
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'InfraWork OCR Documental'
    },
    body: JSON.stringify(reqBody)
  })
  if (!resp.ok) return ''
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string | null } }> }
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

/** Quebra o texto em chunks de ~900 chars com leve sobreposição, por parágrafos. */
function chunkText(texto: string, alvo = 900, overlap = 150): string[] {
  const limpo = texto
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!limpo) return []
  const paragrafos = limpo.split(/\n\n+/)
  const chunks: string[] = []
  let buffer = ''
  for (const p of paragrafos) {
    if ((buffer + '\n\n' + p).length > alvo && buffer) {
      chunks.push(buffer.trim())
      buffer = buffer.slice(Math.max(0, buffer.length - overlap)) + '\n\n' + p
    } else {
      buffer = buffer ? `${buffer}\n\n${p}` : p
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim())
  // Parágrafos isolados muito longos: corta em janelas.
  const final: string[] = []
  for (const c of chunks) {
    if (c.length <= alvo * 1.5) {
      final.push(c)
    } else {
      for (let i = 0; i < c.length; i += alvo - overlap) final.push(c.slice(i, i + alvo))
    }
  }
  return final.slice(0, 200) // teto de segurança por documento
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

  // Documento + versão vigente (escopo da obra).
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
    .select('id, texto_extraido, storage_bucket, storage_key, mime, nome_original')
    .eq('documento_id', documento_id)
    .eq('vigente', true)
    .maybeSingle()
  if (!versao) return json({ error: 'Documento sem versão vigente' }, 422)

  // Origem do texto: body → texto_extraido salvo → OCR próprio (OpenRouter).
  let texto = (body.texto ?? versao.texto_extraido ?? '').trim()
  let origemTexto: 'body' | 'cache' | 'ocr' = body.texto ? 'body' : 'cache'
  if (!texto) {
    const { data: signed } = await admin.storage
      .from(versao.storage_bucket)
      .createSignedUrl(versao.storage_key, 600)
    if (signed?.signedUrl) {
      texto = await transcrever(
        signed.signedUrl,
        (versao.mime ?? '').toLowerCase(),
        versao.nome_original ?? 'documento'
      )
      origemTexto = 'ocr'
    }
  }
  if (!texto) {
    return json({ error: 'Não foi possível obter texto do documento (OCR vazio).' }, 422)
  }

  // Persiste o texto na versão (fonte reusável dos chunks) quando novo.
  if (origemTexto !== 'cache' && texto !== versao.texto_extraido) {
    await admin.from('documento_versao').update({ texto_extraido: texto }).eq('id', versao.id)
  }

  const chunks = chunkText(texto)
  if (chunks.length === 0) return json({ ok: true, chunks: 0 })

  // Vetoriza com a IA nativa do Supabase (gte-small → 384 dims).
  const session = new Supabase.ai.Session('gte-small')

  // Remove chunks antigos (re-embed idempotente).
  await admin.from('documento_chunk').delete().eq('documento_id', documento_id)

  const linhas: Array<Record<string, unknown>> = []
  for (let i = 0; i < chunks.length; i++) {
    const embedding = (await session.run(chunks[i], {
      mean_pool: true,
      normalize: true
    })) as number[]
    linhas.push({
      documento_id,
      versao_id: versao.id,
      ordem: i,
      conteudo: chunks[i],
      embedding,
      metadados: { len: chunks[i].length }
    })
  }

  // obra_id/empresa_id são derivados por trigger.
  const { error: errIns } = await admin.from('documento_chunk').insert(linhas)
  if (errIns) return json({ error: errIns.message }, 500)

  return json({ ok: true, chunks: linhas.length })
})
