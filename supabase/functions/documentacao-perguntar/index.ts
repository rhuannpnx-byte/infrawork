// POST /functions/v1/documentacao-perguntar
// Body: { obra_id, pergunta, match_count? }
//
// Agente RAG sobre o acervo da obra: recuperação por FULL-TEXT (tsv, PT-BR) dos
// chunks → DeepSeek responde com citação {doc_id, página}. (Vetorial/híbrido
// será reativado quando houver provedor de embeddings externo.) Leitura — exige
// acesso à obra (apoio/cliente leem).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { chamarLLM, MODEL_TEXTO } from '../_shared/doc-ia.ts'

interface Body {
  obra_id?: string
  pergunta?: string
  match_count?: number
}

interface ChunkRow {
  id: string
  documento_id: string
  conteudo: string
  pagina: number | null
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
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  if (!pergunta) return json({ error: 'pergunta é obrigatória' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: false })
  if (acc) return acc

  const limite = Math.min(Math.max(body.match_count ?? 8, 1), 20)

  // Recuperação full-text RANQUEADA (ts_rank, OR dos termos) escopada por obra.
  // Fallback: se a query não casar nada, pega os primeiros chunks da obra.
  let trechos: ChunkRow[] = []
  const { data: hit } = await admin.rpc('buscar_chunks_fts', {
    _obra_id: obra_id,
    _q: pergunta,
    _match: limite
  })
  trechos = (hit ?? []) as ChunkRow[]

  if (trechos.length === 0) {
    const { data: fallback } = await admin
      .from('documento_chunk')
      .select('id, documento_id, conteudo, pagina')
      .eq('obra_id', obra_id)
      .limit(limite)
    trechos = (fallback ?? []) as ChunkRow[]
  }

  if (trechos.length === 0) {
    return json({
      resposta: 'Não encontrei documentos indexados para responder. Ingira documentos primeiro.',
      fontes: []
    })
  }

  const docIds = Array.from(new Set(trechos.map((t) => t.documento_id)))
  const { data: docs } = await admin
    .from('documento')
    .select('id, titulo, tipo_codigo')
    .in('id', docIds)
  const docById = new Map(
    ((docs ?? []) as Array<{ id: string; titulo: string; tipo_codigo: string }>).map((d) => [d.id, d])
  )

  const contexto = trechos
    .map((t, i) => {
      const d = docById.get(t.documento_id)
      const pg = t.pagina != null ? ` p.${t.pagina}` : ''
      return `[Fonte ${i + 1}] (${d?.tipo_codigo ?? '--'} · ${d?.titulo ?? t.documento_id}${pg})\n${t.conteudo}`
    })
    .join('\n\n---\n\n')

  const sistema = `Você é o assistente documental da obra. Responda SOMENTE com base nos TRECHOS fornecidos. Cite as fontes no formato [Fonte N]. Se a resposta não estiver nos trechos, diga que não encontrou e sugira onde procurar. Seja direto, em PT-BR.`

  let resposta: string
  try {
    resposta =
      (await chamarLLM(
        [
          { role: 'system', content: sistema },
          { role: 'user', content: `PERGUNTA: ${pergunta}\n\nTRECHOS DO ACERVO:\n${contexto}` }
        ],
        { model: MODEL_TEXTO, temperature: 0.1, max_tokens: 1200, titulo: 'InfraWork Agente Documental' }
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
        similaridade: 1
      }
    })
  })
})
