// POST /functions/v1/documentacao-classificar
// Body: { obra_id, texto?, arquivo_url?, mime?, nome?, pasta? }
//
// Classifica um documento nos GRUPOS do template da obra (taxonomia editável,
// não mais hardcoded). DeepSeek (texto) quando há texto; senão Qwen-VL (arquivo).
// Retorna grupo_codigo (slug do template) + tipo_codigo canônico (01..20) p/ a FK.

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
import {
  carregarGrupos,
  gruposAplicaveis,
  mapaGrupoBase,
  type TemplateGrupo
} from '../_shared/template.ts'

interface Body {
  obra_id?: string
  texto?: string
  arquivo_url?: string
  mime?: string
  nome?: string
  pasta?: string
}

// deno-lint-ignore no-explicit-any
type Admin = any

/** Contexto da obra (natureza/órgão/consórcio) p/ filtrar grupos aplicáveis. */
async function contextoObra(
  admin: Admin,
  obra_id: string
): Promise<{ natureza: string | null; perfil_orgao: string | null; consorcio: boolean | null }> {
  // Consórcio é atributo declarado da obra (obra_perfil), conhecido antes da
  // extração — evita o ovo-e-galinha de depender de contrato.consorcio derivado.
  const { data: perfil } = await admin
    .from('obra_perfil')
    .select('natureza, perfil_orgao, consorcio')
    .eq('obra_id', obra_id)
    .maybeSingle()
  return {
    natureza: perfil?.natureza ?? null,
    perfil_orgao: perfil?.perfil_orgao ?? null,
    consorcio: perfil?.consorcio === true
  }
}

function listaGrupos(grupos: TemplateGrupo[]): string {
  return grupos
    .slice()
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((g) => {
      const dicas = g.aliases?.length ? ` (dicas: ${g.aliases.slice(0, 6).join(', ')})` : ''
      const regra = g.regras ? ` — ${g.regras}` : ''
      return `- ${g.codigo} · ${g.nome}${regra}${dicas}`
    })
    .join('\n')
}

function sistema(grupos: TemplateGrupo[]): string {
  return `Você classifica documentos de obras de engenharia (públicas e privadas no Brasil) nos GRUPOS abaixo. A categoria é SEMÂNTICA (pelo conteúdo), não pela posição da pasta — mas a nomenclatura da pasta é uma DICA útil. Use EXATAMENTE um dos códigos de grupo listados; se nenhum servir, use "20" (Outros).
GRUPOS DISPONÍVEIS (use o "codigo" exato à esquerda):
${listaGrupos(grupos)}
Responda SOMENTE com JSON válido (sem markdown):
{
  "grupo_codigo": string,        // um dos codigos listados acima (ex.: "03", "consorcio", "empenhos")
  "especie": string,             // espécie específica: "Contrato", "1º Aditivo", "ART", "Licença de Instalação"...
  "titulo_sugerido": string,     // título curto e claro do documento
  "confianca": number,           // 0..1 honesto
  "justificativa": string,       // 1 frase
  "sinais": { "assinado": boolean, "minuta": boolean }  // pistas detectadas no documento
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
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  // Taxonomia data-driven: grupos do template, filtrados pelo perfil da obra.
  const todos = await carregarGrupos(admin, obra_id)
  const obraCtx = await contextoObra(admin, obra_id)
  const grupos = gruposAplicaveis(todos, obraCtx)
  const base = mapaGrupoBase(todos)
  const codigosValidos = new Set(grupos.map((g) => g.codigo))

  const pastaCtx = body.pasta ? `\nNOMENCLATURA DA PASTA: ${body.pasta}` : ''
  const nomeCtx = body.nome ? `\nNOME DO ARQUIVO: ${body.nome}` : ''
  const texto = body.texto?.trim()
  const mime = (body.mime ?? '').toLowerCase()

  let messages: unknown[]
  let model = MODEL_TEXTO
  if (texto) {
    const trecho = mascararPII(texto).slice(0, 8000)
    messages = [
      { role: 'system', content: sistema(grupos) },
      { role: 'user', content: `${nomeCtx}${pastaCtx}\n\nCONTEÚDO (início):\n${trecho}` }
    ]
  } else if (body.arquivo_url) {
    model = MODEL_VISAO
    messages = [
      { role: 'system', content: sistema(grupos) },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Classifique o documento.${nomeCtx}${pastaCtx}` },
          conteudoArquivo(mime, body.arquivo_url, body.nome ?? 'documento')
        ]
      }
    ]
  } else {
    return json({ error: 'Informe texto ou arquivo_url' }, 400)
  }

  let raw: string
  try {
    raw = await chamarLLM(messages, {
      model,
      json: true,
      max_tokens: 600,
      plugins: texto ? undefined : pluginsParaArquivo(mime),
      titulo: 'InfraWork Classificação'
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha no modelo' }, 502)
  }

  let p: Record<string, unknown>
  try {
    p = extrairJson(raw) as Record<string, unknown>
  } catch {
    return json({ error: 'JSON inválido', detalhe: raw.slice(0, 300) }, 502)
  }

  const grupoBruto = String(p.grupo_codigo ?? p.tipo_codigo ?? '20').trim()
  const grupo_codigo = codigosValidos.has(grupoBruto) ? grupoBruto : '20'
  const tipo_codigo = base[grupo_codigo] ?? (/^(0[1-9]|1[0-9]|20)$/.test(grupo_codigo) ? grupo_codigo : '20')
  const sinais = (p.sinais ?? {}) as { assinado?: unknown; minuta?: unknown }
  return json({
    grupo_codigo,
    tipo_codigo,
    especie: typeof p.especie === 'string' ? p.especie : null,
    titulo_sugerido: typeof p.titulo_sugerido === 'string' ? p.titulo_sugerido : null,
    confianca: typeof p.confianca === 'number' ? p.confianca : 0,
    justificativa: typeof p.justificativa === 'string' ? p.justificativa : '',
    sinais: { assinado: sinais.assinado === true, minuta: sinais.minuta === true }
  })
})
