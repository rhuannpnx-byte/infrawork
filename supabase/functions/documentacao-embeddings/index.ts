// POST /functions/v1/documentacao-embeddings
// Body: { documento_id, texto? }
//
// Indexa o documento para busca: fatia o texto em chunks e grava conteudo (a
// coluna tsv é gerada no banco → busca full-text em PT-BR). Idempotente.
// Observação: a vetorização (gte-small/Supabase.ai) não cabe no tier de memória
// da edge deste projeto (WORKER_RESOURCE_LIMIT); o RAG usa FTS por ora. Quando
// um provedor de embeddings externo (BGE-m3/OpenAI) for adicionado, reativa-se o
// vetor em documento_chunk.embedding.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { chamarLLM, conteudoArquivo, chunkText, MODEL_VISAO } from '../_shared/doc-ia.ts'

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
    .select('id, texto_extraido, storage_bucket, storage_key, mime, nome_original')
    .eq('documento_id', documento_id)
    .eq('vigente', true)
    .maybeSingle()
  if (!versao) return json({ error: 'Documento sem versão vigente' }, 422)

  let texto = (body.texto ?? versao.texto_extraido ?? '').trim()
  const origemCache = !body.texto && !!versao.texto_extraido
  if (!texto) {
    const { data: signed } = await admin.storage
      .from(versao.storage_bucket)
      .createSignedUrl(versao.storage_key, 600)
    if (signed?.signedUrl) {
      try {
        texto = (
          await chamarLLM(
            [
              {
                role: 'system',
                content:
                  'Transcreva FIELMENTE todo o texto legível do documento. Sem resumo, sem markdown de cerca. Apenas o texto.'
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Transcreva o documento na íntegra.' },
                  conteudoArquivo(
                    (versao.mime ?? '').toLowerCase(),
                    signed.signedUrl,
                    versao.nome_original ?? 'documento'
                  )
                ]
              }
            ],
            { model: MODEL_VISAO, max_tokens: 16000, titulo: 'InfraWork OCR' }
          )
        ).trim()
      } catch {
        texto = ''
      }
    }
  }
  if (!texto) return json({ error: 'Não foi possível obter texto do documento.' }, 422)

  if (!origemCache && texto !== versao.texto_extraido) {
    await admin.from('documento_versao').update({ texto_extraido: texto }).eq('id', versao.id)
  }

  const chunks = chunkText(texto.slice(0, 200_000))
  if (chunks.length === 0) return json({ ok: true, chunks: 0 })

  // Re-indexação idempotente (substitui chunks antigos).
  await admin.from('documento_chunk').delete().eq('documento_id', documento_id)

  const linhas = chunks.map((c, i) => ({
    documento_id,
    versao_id: versao.id,
    ordem: i,
    pagina: null,
    conteudo: c,
    metadados: { len: c.length, fts: true }
  }))
  const { error: errIns } = await admin.from('documento_chunk').insert(linhas)
  if (errIns) return json({ error: errIns.message }, 500)

  return json({ ok: true, chunks: linhas.length })
})
