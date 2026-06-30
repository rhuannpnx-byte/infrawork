// POST /functions/v1/documentacao-clausula-analise
// Body: { obra_id, clausula_id, refresh? }
//
// Análise RICA de UMA cláusula, sob demanda (cacheada na linha clausula.analise),
// integrada ao CONTEXTO do contrato (objeto/lei/regime/valor), das demais
// cláusulas e dos aditivos. Sem reanalisar tudo: roda só quando o usuário abre.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { chamarLLM, extrairJson, mascararPII, MODEL_TEXTO } from '../_shared/doc-ia.ts'
import { carregarPrompts, promptDe } from '../_shared/prompts.ts'

interface Body {
  obra_id?: string
  clausula_id?: string
  refresh?: boolean
}

function sistema(framing: string): string {
  return `${framing}
Responda SOMENTE com JSON válido (sem markdown):
{
  "resumo": string,                    // 1-2 frases: o que a cláusula determina, em linguagem clara
  "risco": "alto" | "medio" | "baixo", // risco/criticidade para a contratada
  "implicacoes": string[],             // implicações práticas/obrigações (0-5 itens)
  "referencias": string[],             // cláusulas/documentos relacionados (ex.: "Cláusula 5.2", "1º Aditivo")
  "pontos_atencao": string[]           // riscos, vedações, prazos, penalidades a vigiar (0-5 itens)
}`
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
  const obra_id = body.obra_id?.trim()
  const clausula_id = body.clausula_id?.trim()
  if (!obra_id || !clausula_id) return json({ error: 'obra_id e clausula_id são obrigatórios' }, 400)
  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const { data: cl } = await admin
    .from('clausula')
    .select('id, numero, titulo, categoria, texto, analise')
    .eq('id', clausula_id)
    .eq('obra_id', obra_id)
    .maybeSingle()
  if (!cl) return json({ error: 'Cláusula não encontrada' }, 404)
  if (cl.analise && !body.refresh) return json({ analise: cl.analise, cached: true })

  const prompts = await carregarPrompts(admin, obra_id)

  // Contexto: contrato + demais cláusulas (índice) + aditivos.
  const [{ data: ctr }, { data: outras }, { data: aditivos }] = await Promise.all([
    admin
      .from('contrato')
      .select('numero, objeto, lei, regime, valor_p0, valor_vigente')
      .eq('obra_id', obra_id)
      .limit(1)
      .maybeSingle(),
    admin.from('clausula').select('numero, titulo, categoria').eq('obra_id', obra_id).neq('id', clausula_id),
    admin.from('evento').select('rotulo, descricao').eq('obra_id', obra_id).eq('tipo', 'aditivo')
  ])

  const indice = ((outras ?? []) as Array<Record<string, string>>)
    .map((o) => `- ${o.numero ?? ''} ${o.titulo ?? ''}${o.categoria ? ` [${o.categoria}]` : ''}`.trim())
    .slice(0, 60)
    .join('\n')
  const adit = ((aditivos ?? []) as Array<Record<string, string>>)
    .map((a) => `- ${a.rotulo ?? ''}${a.descricao ? `: ${a.descricao}` : ''}`)
    .slice(0, 20)
    .join('\n')

  const contexto = `CONTRATO: ${ctr?.numero ?? '—'} | Objeto: ${ctr?.objeto ?? '—'} | Lei: ${ctr?.lei ?? '—'} | Regime: ${ctr?.regime ?? '—'} | P0: ${ctr?.valor_p0 ?? '—'} | Vigente: ${ctr?.valor_vigente ?? '—'}

CLÁUSULA EM ANÁLISE:
${cl.numero ?? ''} ${cl.titulo ?? ''}${cl.categoria ? ` [${cl.categoria}]` : ''}
${mascararPII(String(cl.texto ?? '')).slice(0, 6000)}

ÍNDICE DAS DEMAIS CLÁUSULAS:
${indice || '(nenhuma)'}

ADITIVOS DO CONTRATO:
${adit || '(nenhum)'}`

  let p: Record<string, unknown>
  try {
    const raw = await chamarLLM(
      [
        { role: 'system', content: sistema(promptDe(prompts, 'clausula_sistema')) },
        { role: 'user', content: contexto }
      ],
      { model: MODEL_TEXTO, json: true, max_tokens: 900, titulo: 'InfraWork Cláusula' }
    )
    p = extrairJson(raw) as Record<string, unknown>
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha no modelo' }, 502)
  }

  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 8) : []
  const risco = ['alto', 'medio', 'baixo'].includes(String(p.risco)) ? String(p.risco) : 'baixo'
  const analise = {
    resumo: typeof p.resumo === 'string' ? p.resumo : null,
    risco,
    implicacoes: arr(p.implicacoes),
    referencias: arr(p.referencias),
    pontos_atencao: arr(p.pontos_atencao)
  }

  await admin
    .from('clausula')
    .update({ analise, risco, analise_em: new Date().toISOString() })
    .eq('id', clausula_id)

  return json({ analise, cached: false })
})
