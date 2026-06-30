// POST /functions/v1/documentacao-perguntar
// Body: { obra_id, pergunta, match_count?, documento_id? }
//
// Agente RAG sobre o acervo da obra (ou de UM documento, quando documento_id é
// informado — usado no visualizador): recuperação HÍBRIDA (embedding Mistral +
// FTS PT-BR, fundidos por RRF) → DeepSeek responde com citação {doc_id, página}.
// Sem trecho relevante → diz que não encontrou (NUNCA "chuta" com trecho
// aleatório). Leitura — exige acesso à obra (apoio/cliente leem).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { chamarLLM, gerarEmbedding, MODEL_TEXTO } from '../_shared/doc-ia.ts'
import { carregarPrompts, promptDe } from '../_shared/prompts.ts'

interface Body {
  obra_id?: string
  pergunta?: string
  match_count?: number
  documento_id?: string
}

interface ChunkRow {
  chunk_id: string
  documento_id: string
  conteudo: string
  pagina: number | null
  score: number
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro', 'apoio'])
  if (roleErr) return roleErr
  const { admin } = ctx

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  const pergunta = body.pergunta?.trim()
  const documento_id = body.documento_id?.trim() || null
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  if (!pergunta) return json({ error: 'pergunta é obrigatória' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: false })
  if (acc) return acc

  const limite = Math.min(Math.max(body.match_count ?? 8, 1), 20)

  // Embedding da pergunta (semântico). Se falhar, segue só com FTS (qemb null).
  let qemb: number[] | null = null
  try {
    const v = await gerarEmbedding([pergunta])
    qemb = v[0]?.length ? v[0] : null
  } catch (e) {
    console.warn('[perguntar] embedding da pergunta falhou; usando só FTS', e)
  }

  // Recuperação HÍBRIDA (RRF vetor+FTS), escopada por obra (e por documento, se houver).
  const { data: hit, error: errHibrido } = await admin.rpc('match_documento_chunks_hibrido', {
    query_embedding: qemb ? JSON.stringify(qemb) : null,
    query_text: pergunta,
    _obra_id: obra_id,
    _match_count: limite,
    _documento_id: documento_id
  })
  if (errHibrido) return json({ error: errHibrido.message }, 500)
  const trechos = (hit ?? []) as ChunkRow[]

  // SEM fallback cego: nada relevante → admite que não encontrou.
  if (trechos.length === 0) {
    return json({
      resposta:
        'Não encontrei nos documentos indexados informação que responda a isso. ' +
        'Verifique se o documento certo foi inserido e indexado, ou refine a pergunta com termos do contrato.',
      fontes: []
    })
  }

  const docIds = Array.from(new Set(trechos.map((t) => t.documento_id)))
  const { data: docs } = await admin
    .from('documento')
    .select('id, titulo, tipo_codigo, grupo_codigo, especie')
    .in('id', docIds)
  const docById = new Map(
    ((docs ?? []) as Array<{
      id: string
      titulo: string | null
      tipo_codigo: string | null
      grupo_codigo: string | null
      especie: string | null
    }>).map((d) => [d.id, d])
  )

  const contexto = trechos
    .map((t, i) => {
      const d = docById.get(t.documento_id)
      const meta = [d?.tipo_codigo, d?.especie || d?.grupo_codigo, d?.titulo]
        .filter(Boolean)
        .join(' · ')
      const pg = t.pagina != null ? ` · p.${t.pagina}` : ''
      return `[Fonte ${i + 1}] (${meta || t.documento_id}${pg})\n${t.conteudo}`
    })
    .join('\n\n---\n\n')

  const escopo = documento_id
    ? 'Você responde APENAS sobre o documento aberto (os trechos abaixo são todos dele).'
    : 'Você é o assistente documental da obra.'
  const prompts = await carregarPrompts(admin, obra_id)
  const sistema = promptDe(prompts, 'agente_sistema', { escopo })

  let resposta: string
  try {
    resposta =
      (await chamarLLM(
        [
          { role: 'system', content: sistema },
          { role: 'user', content: `PERGUNTA: ${pergunta}\n\nTRECHOS DO ACERVO:\n${contexto}` }
        ],
        {
          model: MODEL_TEXTO,
          temperature: 0.1,
          max_tokens: 1200,
          titulo: 'InfraWork Agente Documental'
        }
      )) || '(sem resposta)'
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha ao chamar o modelo' }, 502)
  }

  return json({
    resposta,
    fontes: trechos.map((t, i) => {
      const d = docById.get(t.documento_id)
      return {
        n: i + 1,
        documento_id: t.documento_id,
        pagina: t.pagina,
        titulo: d?.titulo ?? null,
        tipo_codigo: d?.tipo_codigo ?? null,
        similaridade: t.score
      }
    })
  })
})
