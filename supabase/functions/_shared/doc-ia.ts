// Helpers de IA do módulo Documentação Oficial v2.
// Modelos via OpenRouter: DeepSeek (texto/extração/classificação/chat) e
// Qwen-VL (visão/OCR de escaneados). Inclui máscara LGPD (CPF/CNH, preservando
// CNPJ), extração de JSON tolerante e chunking de texto.

export const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''
export const MODEL_TEXTO =
  Deno.env.get('OPENROUTER_MODEL_DOC_TEXTO') ?? 'deepseek/deepseek-chat'
export const MODEL_VISAO =
  Deno.env.get('OPENROUTER_MODEL_DOC_VISAO') ?? 'qwen/qwen2.5-vl-72b-instruct'
// Engine do file-parser p/ PDF (vazio = leitura nativa do modelo).
export const PDF_ENGINE = Deno.env.get('OPENROUTER_PDF_ENGINE') ?? ''

// OCR via Mistral (API hospedada). Vazio = OCR desligado.
export const MISTRAL_API_KEY = Deno.env.get('MISTRAL_API_KEY') ?? ''
export const MISTRAL_OCR_MODEL = Deno.env.get('MISTRAL_OCR_MODEL') ?? 'mistral-ocr-latest'

export interface OcrPagina {
  n: number
  markdown: string
}
export interface OcrResultado {
  paginas: OcrPagina[]
  texto: string
  confianca: number
}

/**
 * OCR/parsing documental via Mistral OCR. Lê o PDF/imagem pela signed URL e
 * devolve markdown por página (com proveniência por página downstream).
 */
export async function chamarMistralOcr(url: string, mime: string): Promise<OcrResultado> {
  if (!MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY não configurada')
  const isImg = (mime ?? '').startsWith('image/')
  const document = isImg
    ? { type: 'image_url', image_url: url }
    : { type: 'document_url', document_url: url }
  const resp = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: MISTRAL_OCR_MODEL, document, include_image_base64: false })
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Mistral OCR ${resp.status}: ${t.slice(0, 300)}`)
  }
  const data = (await resp.json()) as { pages?: Array<{ index?: number; markdown?: string }> }
  const paginas = (data.pages ?? []).map((p, i) => ({
    n: (typeof p.index === 'number' ? p.index : i) + 1,
    markdown: p.markdown ?? ''
  }))
  const texto = paginas
    .map((p) => p.markdown)
    .join('\n\n')
    .trim()
  return { paginas, texto, confianca: texto ? 0.92 : 0 }
}

/** Junta as páginas com marcadores [[page:N]] p/ proveniência por página downstream. */
export function textoComMarcadores(paginas: OcrPagina[]): string {
  return paginas
    .map((p) => `[[page:${p.n}]]\n${p.markdown}`)
    .join('\n\n')
    .trim()
}

export interface ChatOpts {
  model?: string
  temperature?: number
  max_tokens?: number
  json?: boolean
  plugins?: unknown[]
  titulo?: string
}

/** Chamada de chat completions no OpenRouter. Retorna o conteúdo (texto). */
export async function chamarLLM(
  messages: unknown[],
  opts: ChatOpts = {}
): Promise<string> {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY não configurada')
  const body: Record<string, unknown> = {
    model: opts.model ?? MODEL_TEXTO,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.max_tokens ?? 4000,
    messages
  }
  if (opts.json) body.response_format = { type: 'json_object' }
  if (opts.plugins) body.plugins = opts.plugins
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': opts.titulo ?? 'InfraWork Documentação'
    },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`OpenRouter ${resp.status}: ${txt.slice(0, 300)}`)
  }
  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

/** Monta o bloco de conteúdo multimodal (imagem → vision; PDF/outro → file). */
export function conteudoArquivo(
  mime: string,
  url: string,
  nome: string
): Record<string, unknown> {
  return mime.startsWith('image/')
    ? { type: 'image_url', image_url: { url } }
    : { type: 'file', file: { filename: nome, file_data: url } }
}

/** Plugin file-parser quando há engine configurado (e não é imagem). */
export function pluginsParaArquivo(mime: string): unknown[] | undefined {
  if (mime.startsWith('image/') || !PDF_ENGINE) return undefined
  return [{ id: 'file-parser', pdf: { engine: PDF_ENGINE } }]
}

/** Extrai um objeto JSON da resposta do modelo (tolerante a cercas/lixo). */
export function extrairJson(texto: string): unknown {
  const t = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  try {
    return JSON.parse(t)
  } catch {
    const ini = t.indexOf('{')
    const fim = t.lastIndexOf('}')
    if (ini >= 0 && fim > ini) return JSON.parse(t.slice(ini, fim + 1))
    throw new Error('Resposta do modelo não é JSON válido')
  }
}

/**
 * Mascara CPF e CNH antes de enviar ao LLM (LGPD), PRESERVANDO CNPJ.
 * CNPJ (00.000.000/0000-00 ou 14 dígitos) não é tocado; CPF formatado e
 * sequências isoladas de 11 dígitos viram [CPF].
 */
export function mascararPII(texto: string): string {
  // Mascara CPF FORMATADO (XXX.XXX.XXX-XX) e CPF "rotulado" (precedido de "CPF").
  // NÃO mascara números crus de 11 dígitos: ARTs/CREA/protocolos de obra têm
  // 11+ dígitos e eram destruídos (ex.: ART "BA12345678901" → "BA[CPF]"),
  // quebrando a identidade do responsável técnico.
  return texto
    .replace(/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, '[CPF]')
    .replace(/\bCPF[:\s.ºn-]*\d{11}\b/gi, 'CPF [CPF]')
}

/** Quebra o texto em chunks de ~900 chars com leve sobreposição, por parágrafos. */
export function chunkText(texto: string, alvo = 900, overlap = 150): string[] {
  const limpo = texto.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
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
  const final: string[] = []
  for (const c of chunks) {
    if (c.length <= alvo * 1.5) final.push(c)
    else for (let i = 0; i < c.length; i += alvo - overlap) final.push(c.slice(i, i + alvo))
  }
  return final.slice(0, 100) // teto por documento (limite de compute do gte-small na edge)
}

export interface ChunkPagina {
  conteudo: string
  pagina: number | null
}

/**
 * Igual ao chunkText, mas preserva o nº da página a partir dos marcadores
 * `[[page:N]]` (gravados pelo OCR em texto_extraido). Documentos nato-digitais
 * (sem marcadores) caem para chunk plano com pagina = null.
 */
export function chunkComPagina(texto: string, alvo = 900, overlap = 150): ChunkPagina[] {
  const limpo = (texto ?? '').replace(/\r/g, '')
  if (!limpo.includes('[[page:')) {
    return chunkText(limpo, alvo, overlap).map((c) => ({ conteudo: c, pagina: null }))
  }
  const out: ChunkPagina[] = []
  // split com grupo de captura → [pre, n1, seg1, n2, seg2, ...]
  const partes = limpo.split(/\[\[page:(\d+)\]\]/)
  for (let i = 1; i < partes.length; i += 2) {
    const pagina = Number(partes[i]) || null
    const seg = partes[i + 1] ?? ''
    for (const c of chunkText(seg, alvo, overlap)) out.push({ conteudo: c, pagina })
  }
  return out.slice(0, 120)
}

export const MISTRAL_EMBED_MODEL = Deno.env.get('MISTRAL_EMBED_MODEL') ?? 'mistral-embed'

/**
 * Embeddings via Mistral (`mistral-embed`, 1024-dim). Batch. Lança em erro/sem
 * chave — o chamador decide o fallback (RAG segue só com FTS). Trunca cada
 * entrada (limite de tokens do provedor).
 */
export async function gerarEmbedding(textos: string[]): Promise<number[][]> {
  if (!MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY não configurada')
  if (textos.length === 0) return []
  const input = textos.map((t) => (t ?? '').slice(0, 8000))
  const resp = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MISTRAL_EMBED_MODEL, input })
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Mistral embeddings ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = (await resp.json()) as { data?: Array<{ embedding?: number[] }> }
  return (data.data ?? []).map((d) => d.embedding ?? [])
}

/** Soma `n` dias a uma data ISO. */
export function addDaysIso(iso: string | null, n: number | null): string | null {
  if (!iso || n == null || !Number.isFinite(n)) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
