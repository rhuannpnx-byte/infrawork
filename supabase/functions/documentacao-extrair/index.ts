// POST /functions/v1/documentacao-extrair
// Body: { obra_id, documento_id, categoria, texto }
//
// Extração TEMPLATE-AWARE (DeepSeek). Responde SOMENTE as perguntas dos campos
// do template cuja âncora de categoria casa com este documento — nada além disso.
// Devolve candidatos (escalares + entradas incrementais) com {pagina, confianca},
// que a consolidação grava como CANDIDATOS e o resolver depois resolve por âncora.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import { chamarLLM, extrairJson, mascararPII, MODEL_TEXTO } from '../_shared/doc-ia.ts'
import {
  carregarCampos,
  carregarGrupos,
  camposParaGrupo,
  categoriaCodigo,
  type TemplateCampo
} from '../_shared/template.ts'
import { carregarPrompts, promptDe } from '../_shared/prompts.ts'

interface Body {
  obra_id?: string
  documento_id?: string
  categoria?: string
  grupo_codigo?: string
  texto?: string
}

const CONF_MIN = 0.6

function instrucoes(framing: string, campos: TemplateCampo[]): string {
  const escalares = campos.filter((c) => c.cardinalidade === 'escalar')
  const listas = campos.filter((c) => c.cardinalidade === 'incremental')

  const linhasEsc = escalares
    .map((c) => `  - "${c.chave}" (${c.tipo}): ${c.pergunta}`)
    .join('\n')
  const linhasLista = listas
    .map((c) => {
      const itens = c.item_schema ? Object.keys(c.item_schema).join(', ') : 'valor'
      return `  - "${c.chave}" (lista; cada item tem: ${itens}): ${c.pergunta}`
    })
    .join('\n')

  // framing = system prompt editável; as listas de campos + formato JSON são
  // máquina-críticas e sempre anexadas em código.
  return `${framing}

CAMPOS ESCALARES (um valor cada):
${linhasEsc || '  (nenhum)'}

CAMPOS LISTA (uma ou mais entradas; podem aparecer várias no mesmo documento):
${linhasLista || '  (nenhum)'}

FORMATO DE RESPOSTA:
{
  "respostas": [ { "chave": "<chave escalar>", "valor": <valor|null>, "pagina": <N|null>, "confianca": <0..1> } ],
  "listas":    [ { "chave": "<chave lista>", "itens": [ { ...campos do item..., "pagina": <N|null>, "confianca": <0..1> } ] } ],
  "confianca": <0..1 geral>,
  "avisos": [ "..." ]
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
  const documento_id = body.documento_id?.trim()
  if (!obra_id || !documento_id) return json({ error: 'obra_id e documento_id são obrigatórios' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const codigo = categoriaCodigo(body.categoria)
  const [todosCampos, grupos, prompts] = await Promise.all([
    carregarCampos(admin, obra_id),
    carregarGrupos(admin, obra_id),
    carregarPrompts(admin, obra_id)
  ])
  // Grupo dita os campos: extrai só o que o grupo do documento declara alimentar.
  const campos = camposParaGrupo(todosCampos, grupos, body.grupo_codigo, codigo)
  if (!campos.length) {
    return json({ respostas: [], entradas: [], confianca: 0, avisos: ['sem campos no template para este grupo'] })
  }

  const texto = body.texto?.trim()
  if (!texto) return json({ respostas: [], entradas: [], confianca: 0, avisos: ['sem texto'] })

  const messages = [
    { role: 'system', content: instrucoes(promptDe(prompts, 'extracao_sistema'), campos) },
    { role: 'user', content: `DOCUMENTO (categoria ${codigo}):\n${mascararPII(texto).slice(0, 28000)}` }
  ]

  let p: Record<string, unknown> | null = null
  for (let tentativa = 0; tentativa < 2 && !p; tentativa++) {
    try {
      const raw = await chamarLLM(messages, {
        model: MODEL_TEXTO,
        json: true,
        max_tokens: 4000,
        titulo: 'InfraWork Extração (template)'
      })
      p = extrairJson(raw) as Record<string, unknown>
    } catch {
      p = null
    }
  }
  if (!p) return json({ error: 'Extração falhou (JSON inválido)' }, 502)

  const confianca = typeof p.confianca === 'number' ? p.confianca : 0
  const avisos = Array.isArray(p.avisos) ? (p.avisos as unknown[]).map(String) : []

  // Só aceita chaves do template (nada além dele).
  const chavesEsc = new Set(campos.filter((c) => c.cardinalidade === 'escalar').map((c) => c.chave))
  const chavesLista = new Set(campos.filter((c) => c.cardinalidade === 'incremental').map((c) => c.chave))

  const respostas = (Array.isArray(p.respostas) ? p.respostas : [])
    .map((r) => r as Record<string, unknown>)
    .filter((r) => chavesEsc.has(String(r.chave)) && r.valor != null && r.valor !== '')
    .map((r) => ({
      chave: String(r.chave),
      valor: r.valor,
      pagina: typeof r.pagina === 'number' ? r.pagina : null,
      confianca: typeof r.confianca === 'number' ? r.confianca : confianca
    }))

  const entradas: Array<{ chave: string; item: Record<string, unknown>; pagina: number | null; confianca: number }> = []
  for (const l of (Array.isArray(p.listas) ? p.listas : []) as Array<Record<string, unknown>>) {
    const chave = String(l.chave)
    if (!chavesLista.has(chave)) continue
    for (const it of (Array.isArray(l.itens) ? l.itens : []) as Array<Record<string, unknown>>) {
      const { pagina, confianca: cf, ...item } = it
      if (!Object.keys(item).length) continue
      entradas.push({
        chave,
        item,
        pagina: typeof pagina === 'number' ? pagina : null,
        confianca: typeof cf === 'number' ? cf : confianca
      })
    }
  }

  return json({ respostas, entradas, confianca, avisos, fila_humana: confianca < CONF_MIN })
})
