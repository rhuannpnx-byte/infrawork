// POST /functions/v1/documentacao-classificar
// Body: { obra_id, arquivo_url, mime, nome, pasta? }
//
// Classifica um documento na taxonomia canônica de 20 categorias usando o
// CONTEÚDO do arquivo (PDF/imagem via OpenRouter) + a NOMENCLATURA DA PASTA de
// origem + o nome do arquivo como sinais. Devolve o código sugerido, confiança,
// título sugerido e uma justificativa curta. Não grava nada — o app revisa.

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''
const OPENROUTER_MODEL =
  Deno.env.get('OPENROUTER_MODEL_DOC_CLASSIFICACAO') ?? 'anthropic/claude-opus-4-8'
const PDF_ENGINE = Deno.env.get('OPENROUTER_PDF_ENGINE') ?? ''

const TAXONOMIA = `01 Edital e Anexos | 02 Proposta (Téc./Comercial) | 03 Contrato | 04 Ordem de Serviço (e NPO) | 05 ART / CAT | 06 Segurança do Trabalho (PGR/PCMSO) | 07 Aditivos | 08 Reprogramação | 09 Reajuste / Apostilamento | 10 Licenças Ambientais (LP/LI/LO, ASV, Outorga) | 11 CNO / CEI | 12 Seguro Garantia | 13 Doc. Consórcio / Contratada | 14 Cartas e Ofícios | 15 Tribunal de Contas (TCM/TCE) | 16 Certidões / Matrícula / Desapropriação | 17 Qualidade (SGQ/PGQ/PVEGQ) | 18 Termo de Entrega/Recebimento (TRP/TRD) | 19 Portarias / Designação de Fiscal | 20 Outros / Diversos`

interface Body {
  obra_id?: string
  arquivo_url?: string
  mime?: string
  nome?: string
  pasta?: string
}

function sistemaPrompt(): string {
  return `Você classifica documentos de obras públicas/privadas brasileiras na TAXONOMIA CANÔNICA de 20 categorias:
${TAXONOMIA}

Receberá o CONTEÚDO de um documento, o NOME DO ARQUIVO e o CAMINHO DA PASTA de origem. Use os três sinais — o conteúdo é o mais forte; a pasta e o nome ajudam a desambiguar (ex.: pasta "07 - Aditivos" sugere categoria 07; "ART" no nome sugere 05).
A numeração da pasta de origem NÃO é a categoria canônica por si só — confirme pelo conteúdo. Na dúvida entre duas, escolha a mais provável pelo conteúdo e baixe a confiança.

Responda SOMENTE com JSON válido (sem markdown):
{
  "tipo_codigo": "NN",        // EXATAMENTE um código de 01 a 20 da taxonomia
  "titulo_sugerido": string,  // título curto e legível do documento (ex.: "2º Termo Aditivo - Contrato 02/2025")
  "confianca": number,        // 0..1 honesta; baixa quando o conteúdo for ilegível/ambíguo
  "justificativa": string     // 1 frase curta (≤ 120 caracteres)
}`
}

function extrairJson(texto: string): Record<string, unknown> {
  const t = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    return JSON.parse(t) as Record<string, unknown>
  } catch {
    const ini = t.indexOf('{')
    const fim = t.lastIndexOf('}')
    if (ini >= 0 && fim > ini) return JSON.parse(t.slice(ini, fim + 1)) as Record<string, unknown>
    throw new Error('Resposta do modelo não é JSON válido')
  }
}

const CODIGOS = new Set(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0')))

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  if (!OPENROUTER_API_KEY) return json({ error: 'OPENROUTER_API_KEY não configurada' }, 500)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const roleErr = assertRole(ctx.caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const obra_id = body.obra_id?.trim()
  const arquivo_url = body.arquivo_url?.trim()
  const mime = (body.mime ?? '').toLowerCase()
  const nome = body.nome?.trim() || 'documento'
  const pasta = body.pasta?.trim() || '(raiz)'
  if (!obra_id) return json({ error: 'obra_id é obrigatório' }, 400)
  if (!arquivo_url) return json({ error: 'arquivo_url é obrigatório' }, 400)

  const acc = await assertObraAccess(ctx, obra_id, { write: true })
  if (acc) return acc

  const isImagem = mime.startsWith('image/')
  const conteudoArquivo = isImagem
    ? { type: 'image_url', image_url: { url: arquivo_url } }
    : { type: 'file', file: { filename: nome, file_data: arquivo_url } }

  const reqBody: Record<string, unknown> = {
    model: OPENROUTER_MODEL,
    temperature: 0,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sistemaPrompt() },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `NOME DO ARQUIVO: ${nome}\nCAMINHO DA PASTA: ${pasta}\nClassifique no formato especificado.`
          },
          conteudoArquivo
        ]
      }
    ]
  }
  if (!isImagem && PDF_ENGINE) {
    reqBody.plugins = [{ id: 'file-parser', pdf: { engine: PDF_ENGINE } }]
  }

  let raw: string
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'InfraWork Classificação Documental'
      },
      body: JSON.stringify(reqBody)
    })
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      return json({ error: `OpenRouter ${resp.status}`, detalhe: txt.slice(0, 400) }, 502)
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) return json({ error: 'OpenRouter devolveu resposta vazia' }, 502)
    raw = content
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha ao chamar o modelo' }, 502)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = extrairJson(raw)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'JSON inválido' }, 502)
  }

  const codigo = String(parsed.tipo_codigo ?? '').padStart(2, '0')
  const tipo_codigo = CODIGOS.has(codigo) ? codigo : '20'
  const confRaw = typeof parsed.confianca === 'number' ? parsed.confianca : Number(parsed.confianca)

  return json({
    tipo_codigo,
    titulo_sugerido:
      typeof parsed.titulo_sugerido === 'string' && parsed.titulo_sugerido.trim()
        ? parsed.titulo_sugerido.trim()
        : nome,
    confianca: Number.isFinite(confRaw) ? confRaw : 0,
    justificativa: typeof parsed.justificativa === 'string' ? parsed.justificativa : '',
    _meta: { modelo: OPENROUTER_MODEL }
  })
})
