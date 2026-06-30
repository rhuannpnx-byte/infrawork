// POST /functions/v1/documentacao-aderencia
// Body: { obra_id, grupo_codigo, texto?, arquivo_url?, mime?, nome?, pasta? }
//
// Verdito leve de ADERÊNCIA: o documento que o usuário quer arquivar no grupo
// escolhido realmente pertence a ele? ORIENTA (sugere grupo melhor) sem restringir.
// Reusa a taxonomia (grupos do template) e o LLM; classifica e compara.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import {
  chamarLLM,
  conteudoArquivo,
  pluginsParaArquivo,
  extrairJson,
  mascararPII,
  MODEL_TEXTO,
  MODEL_VISAO
} from '../_shared/doc-ia.ts'
import { carregarGrupos, gruposAplicaveis, type TemplateGrupo } from '../_shared/template.ts'
import { carregarPrompts, promptDe } from '../_shared/prompts.ts'

interface Body {
  obra_id?: string
  grupo_codigo?: string
  texto?: string
  arquivo_url?: string
  mime?: string
  nome?: string
  pasta?: string
}

// deno-lint-ignore no-explicit-any
type Admin = any

async function contextoObra(admin: Admin, obra_id: string) {
  const { data } = await admin
    .from('obra_perfil')
    .select('natureza, perfil_orgao, consorcio')
    .eq('obra_id', obra_id)
    .maybeSingle()
  return {
    natureza: data?.natureza ?? null,
    perfil_orgao: data?.perfil_orgao ?? null,
    consorcio: data?.consorcio === true
  }
}

function lista(grupos: TemplateGrupo[]): string {
  return grupos
    .slice()
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((g) => `- ${g.codigo} · ${g.nome}${g.regras ? ` — ${g.regras}` : ''}`)
    .join('\n')
}

function sistema(
  framing: string,
  grupos: TemplateGrupo[],
  alvo: TemplateGrupo | undefined
): string {
  const grupoTxt = `"${alvo?.codigo ?? '?'} · ${alvo?.nome ?? '?'}"${alvo?.regras ? ` (regras: ${alvo.regras})` : ''}`
  return `${framing.split('{{grupo}}').join(grupoTxt)}
GRUPOS DISPONÍVEIS:
${lista(grupos)}
Responda SOMENTE com JSON válido (sem markdown):
{
  "grupo_melhor": string,    // codigo do grupo que MELHOR descreve o documento
  "confianca": number,       // 0..1 de que o documento pertence ao grupo escolhido pelo usuário
  "motivo": string           // 1 frase curta
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
  const grupo_codigo = body.grupo_codigo?.trim()
  if (!obra_id || !grupo_codigo) return json({ error: 'obra_id e grupo_codigo são obrigatórios' }, 400)
  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const todos = await carregarGrupos(admin, obra_id)
  const grupos = gruposAplicaveis(todos, await contextoObra(admin, obra_id))
  const alvo = todos.find((g) => g.codigo === grupo_codigo)
  const codigosValidos = new Set(grupos.map((g) => g.codigo))
  const framing = promptDe(await carregarPrompts(admin, obra_id), 'aderencia_sistema')

  const nomeCtx = body.nome ? `\nNOME DO ARQUIVO: ${body.nome}` : ''
  const pastaCtx = body.pasta ? `\nPASTA: ${body.pasta}` : ''
  const texto = body.texto?.trim()
  const mime = (body.mime ?? '').toLowerCase()

  let messages: unknown[]
  let model = MODEL_TEXTO
  if (texto) {
    messages = [
      { role: 'system', content: sistema(framing, grupos, alvo) },
      { role: 'user', content: `${nomeCtx}${pastaCtx}\n\nCONTEÚDO (início):\n${mascararPII(texto).slice(0, 6000)}` }
    ]
  } else if (body.arquivo_url) {
    model = MODEL_VISAO
    messages = [
      { role: 'system', content: sistema(framing, grupos, alvo) },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Avalie a aderência.${nomeCtx}${pastaCtx}` },
          conteudoArquivo(mime, body.arquivo_url, body.nome ?? 'documento')
        ]
      }
    ]
  } else {
    return json({ error: 'Informe texto ou arquivo_url' }, 400)
  }

  let p: Record<string, unknown>
  try {
    const raw = await chamarLLM(messages, {
      model,
      json: true,
      max_tokens: 300,
      plugins: texto ? undefined : pluginsParaArquivo(mime),
      titulo: 'InfraWork Aderência'
    })
    p = extrairJson(raw) as Record<string, unknown>
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha no modelo' }, 502)
  }

  const melhorBruto = String(p.grupo_melhor ?? grupo_codigo).trim()
  const grupo_melhor = codigosValidos.has(melhorBruto) ? melhorBruto : grupo_codigo
  const confianca = typeof p.confianca === 'number' ? p.confianca : 0
  const adere = grupo_melhor === grupo_codigo || confianca >= 0.6
  return json({
    adere,
    grupo_sugerido: adere ? null : grupo_melhor,
    confianca,
    motivo: typeof p.motivo === 'string' ? p.motivo : ''
  })
})
