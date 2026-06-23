// POST /functions/v1/documentacao-perguntar
// Body: { obra_id, pergunta }
//
// Agente sobre o acervo documental da obra (RAG): vetoriza a pergunta (gte-small),
// recupera os trechos mais similares via match_documento_chunks e responde com
// CITAÇÃO das fontes. Leitura — exige acesso à obra (inclui apoio/cliente leitura
// se tiver permissão de obra; ajuste a matriz conforme necessário).
//
// deno-lint-ignore no-explicit-any
declare const Supabase: any

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL_DOC_AGENTE') ?? 'anthropic/claude-opus-4-8'

interface Body {
  obra_id?: string
  pergunta?: string
  match_count?: number
}

interface ChunkRow {
  chunk_id: string
  documento_id: string
  conteudo: string
  metadados: Record<string, unknown>
  similaridade: number
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  if (!OPENROUTER_API_KEY) return json({ error: 'OPENROUTER_API_KEY não configurada' }, 500)

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
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  if (!pergunta) return json({ error: 'pergunta é obrigatória' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: false })
  if (acc) return acc

  // 1) Vetoriza a pergunta e recupera trechos similares.
  const session = new Supabase.ai.Session('gte-small')
  const queryEmbedding = (await session.run(pergunta, {
    mean_pool: true,
    normalize: true
  })) as number[]

  const { data: chunks, error: errMatch } = await admin.rpc('match_documento_chunks', {
    query_embedding: queryEmbedding,
    _obra_id: obra_id,
    _match_count: Math.min(Math.max(body.match_count ?? 8, 1), 20)
  })
  if (errMatch) return json({ error: errMatch.message }, 500)
  const trechos = (chunks ?? []) as ChunkRow[]

  if (trechos.length === 0) {
    return json({
      resposta: 'Não encontrei documentos relevantes para essa pergunta neste acervo.',
      fontes: []
    })
  }

  // 2) Enriquece com título/categoria do documento para citar.
  const docIds = Array.from(new Set(trechos.map((t) => t.documento_id)))
  const { data: docs } = await admin
    .from('documento')
    .select('id, titulo, tipo_codigo, contrato_id')
    .in('id', docIds)
  const docById = new Map(
    ((docs ?? []) as Array<{ id: string; titulo: string; tipo_codigo: string }>).map((d) => [
      d.id,
      d
    ])
  )

  const contexto = trechos
    .map((t, i) => {
      const d = docById.get(t.documento_id)
      return `[Fonte ${i + 1}] (${d?.tipo_codigo ?? '--'} · ${d?.titulo ?? t.documento_id})\n${t.conteudo}`
    })
    .join('\n\n---\n\n')

  const sistema = `Você é o assistente documental da obra. Responda à pergunta do usuário SOMENTE com base nos TRECHOS fornecidos do acervo. Cite as fontes usadas no formato [Fonte N]. Se a resposta não estiver nos trechos, diga que não encontrou e sugira onde procurar. Seja direto e em PT-BR.`

  let resposta: string
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'InfraWork Agente Documental'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        temperature: 0.1,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: `PERGUNTA: ${pergunta}\n\nTRECHOS DO ACERVO:\n${contexto}` }
        ]
      })
    })
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      return json({ error: `OpenRouter ${resp.status}`, detalhe: txt.slice(0, 400) }, 502)
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    resposta = data.choices?.[0]?.message?.content ?? '(sem resposta)'
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
        titulo: d?.titulo ?? null,
        tipo_codigo: d?.tipo_codigo ?? null,
        similaridade: Number(t.similaridade?.toFixed?.(3) ?? t.similaridade)
      }
    })
  })
})
