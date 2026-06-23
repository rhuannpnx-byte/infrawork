// POST /functions/v1/documentacao-extrair-contrato
// Body: { obra_id: string, arquivo_url: string, mime: string, nome: string }
//
// Lê um documento de contrato (PDF/imagem) via OpenRouter e EXTRAI as entidades
// do contrato (número, contratante, processo SEI, vigência, valor, etc.). NÃO
// cria o contrato — devolve os campos para o usuário revisar e confirmar no app.
//
// - Imagens (image/*): enviadas como `image_url`.
// - PDFs: enviados como content `type:'file'` + plugin `file-parser` (engine
//   mistral-ocr por padrão, bom para PDFs escaneados — a maioria dos assinados).
//   O `file_data` recebe a SIGNED URL do arquivo (gerada pelo app no bucket
//   privado), evitando trafegar base64 gigante no corpo da requisição.
//
// A chave OPENROUTER_API_KEY fica server-side. assertObraAccess garante que o
// caller pode escrever na obra (apoio/cliente bloqueados).

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''
const OPENROUTER_MODEL =
  Deno.env.get('OPENROUTER_MODEL_DOC_EXTRACAO') ?? 'anthropic/claude-opus-4-8'
// Engine de OCR do file-parser para PDF. Quando NÃO definido, omitimos o plugin
// e o OpenRouter usa a leitura NATIVA do modelo (Opus é multimodal e lê PDF,
// inclusive escaneado) — funciona sem depender de billing de plugin. Defina
// OPENROUTER_PDF_ENGINE='mistral-ocr' (melhor p/ escaneados, pago) ou
// 'cloudflare-ai' (grátis, markdown) para forçar um engine específico.
const PDF_ENGINE = Deno.env.get('OPENROUTER_PDF_ENGINE') ?? ''

interface Body {
  obra_id?: string
  arquivo_url?: string
  mime?: string
  nome?: string
}

function sistemaPrompt(): string {
  return `Você é um analista jurídico especializado em contratos de obra pública e privada no Brasil (Lei 14.133/2021, GOINFRA, DNIT, SANEAGO, prefeituras, concessionárias).
Receberá o documento de UM contrato (ou minuta/aditivo). Extraia as ENTIDADES do contrato e responda SOMENTE com um objeto JSON válido (sem markdown, sem comentários), com EXATAMENTE estas chaves:
{
  "numero": string|null,            // número do contrato, ex.: "02/2025-GOINFRA", "CNT 12.00368/2023"
  "contratante": string|null,       // QUEM CONTRATA (paga). Pode ser órgão público OU empresa/cooperativa privada. NÃO confunda com interveniente/anuente.
  "processo_sei": string|null,      // nº do processo administrativo / SEI, se houver
  "natureza": "publico"|"privado",  // "privado" quando o instrumento é particular entre partes privadas, mesmo que um órgão público seja interveniente/anuente
  "lei": string|null,               // dispositivo legal/instrumento: "14.133/2021", "8.666/93", "contrato privado (instrumento particular)"
  "objeto": string|null,            // objeto resumido (ex.: "Restauração/pavimentação GO-570 e GO-174, km ...")
  "modalidade_regime": string|null, // modalidade/regime: "Empreitada por preço global (integrada - projetos e obras)", "Concorrência"...
  "vigencia_inicio": string|null,   // data ISO "AAAA-MM-DD". Use a data de assinatura (ou OS de início se houver). Se a assinatura for eletrônica, use a data da ÚLTIMA assinatura.
  "prazo_vigencia_meses": number|null, // prazo TOTAL de vigência em MESES. Se o contrato expressar em DIAS, CONVERTA dividindo por 30 e arredonde (ex.: 1270 dias → 42). NUNCA deixe nulo se houver prazo em dias.
  "prazo_vigencia_dias": number|null,  // prazo de vigência em DIAS quando o contrato expressar assim (ex.: "1.270 dias consecutivos"); senão null.
  "vigencia_fim": string|null,      // data ISO. CALCULE: se o prazo for em dias, vigencia_inicio + dias; se em meses, vigencia_inicio + meses. Só null se não houver início nem prazo.
  "execucao_inicio": string|null,   // data ISO de INÍCIO da execução das obras (OS de início; na ausência, a assinatura).
  "prazo_execucao_dias": number|null,  // prazo de execução do objeto em DIAS quando expresso assim (ex.: "1.080 dias contados da Ordem de Início"); senão null.
  "execucao_fim": string|null,      // data ISO de FIM da execução. Calcule a partir do início + prazo (dias OU meses). Com vários prazos, use a data MAIS DISTANTE (datas fixas como 31/12/2025 entram na comparação).
  "valor_original": number|null,    // valor total em reais SEM separador de milhar, ponto decimal (ex.: 152173654.15)
  "fiscal_responsavel": string|null,// fiscal/gestor designado nominalmente. Se a fiscalização for genérica (ex.: "exercida pela GOINFRA"), retorne o ÓRGÃO fiscalizador (ex.: "GOINFRA/SEINFRA").
  "reajuste_indice": string|null,   // índice(s) de reajuste/correção citados (ex.: "Índices setoriais de obras rodoviárias da FGV: Terraplenagem, Pavimentação, Drenagem, Sinalização, Conservação, Ligantes Betuminosos"; ou "IGPM/FGV", "IPCA"...)
  "reajuste_periodicidade_meses": number|null, // periodicidade mínima do reajuste em meses (tipicamente 12)
  "reajuste_data_base": string|null,// data ISO da DATA-BASE de referência do reajuste (data de elaboração do orçamento, quando citada). null se não explícita.
  "reajuste_elegivel_em": string|null, // data ISO em que o PRIMEIRO reajuste se torna elegível = data_base (ou vigencia_inicio se data_base ausente) + periodicidade. CALCULE.
  "consorcio": { "is": boolean, "composicao": string[] }, // consórcio? e empresas que o compõem
  "confianca": number,              // 0..1 confiança HONESTA geral da extração
  "avisos": string[]                // observações: campos ilegíveis, ambiguidade, doc é minuta/aditivo, datas estimadas, etc.
}
REGRAS:
- Use SOMENTE o que está no documento. Campo não encontrado = null (não invente).
- "valor_original": converta "R$ 152.173.654,15" para 152173654.15 (número puro).
- PRAZO EM DIAS × MESES (importante): contratos podem expressar o prazo em DIAS (ex.: "1.270 dias consecutivos") ou em MESES. Você DEVE:
  • Preencher prazo_vigencia_meses SEMPRE (se vier em dias, converta: meses = arredondar(dias / 30)). O mesmo vale para execução.
  • Preencher prazo_vigencia_dias / prazo_execucao_dias quando o documento expressar em dias (para o cálculo exato da data).
- DATAS E PRAZOS — calcule ativamente (não deixe null se der para calcular):
  • vigencia_fim = vigencia_inicio + prazo (use DIAS se houver prazo em dias; senão meses). Devolva a data ISO.
  • execucao_fim = execucao_inicio (ou assinatura) + prazo de execução (dias ou meses); com vários prazos, a data mais distante.
  • reajuste_elegivel_em = (reajuste_data_base ou vigencia_inicio) + reajuste_periodicidade_meses.
  • Sempre que estimar uma data (ex.: usar a assinatura/publicação como base por falta de data explícita), registre isso em "avisos".
- CONTRATANTE × INTERVENIENTE: o contratante é a parte que paga/contrata. Um órgão público citado como "interveniente anuente" NÃO é o contratante — nesse caso a natureza é "privado".
- Se o documento for uma MINUTA, ADITIVO ou APOSTILAMENTO (não o contrato-base), ainda extraia o que der e registre isso em "avisos".
- "confianca" baixa quando o documento for escaneado de baixa qualidade, parcial ou ambíguo.`
}

/** Soma `n` meses a uma data ISO "AAAA-MM-DD". Retorna ISO ou null. */
function addMonthsIso(iso: string | null, n: number | null): string | null {
  if (!iso || n == null || !Number.isFinite(n)) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return null
  const diaOriginal = d.getUTCDate()
  d.setUTCMonth(d.getUTCMonth() + n)
  // Corrige overflow de mês (ex.: 31 + 1 mês → cai no mês seguinte): trava no último dia.
  if (d.getUTCDate() < diaOriginal) d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}

/** Soma `n` dias a uma data ISO "AAAA-MM-DD". Retorna ISO ou null. */
function addDaysIso(iso: string | null, n: number | null): string | null {
  if (!iso || n == null || !Number.isFinite(n)) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function extrairJson(texto: string): unknown {
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

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  if (!OPENROUTER_API_KEY) return json({ error: 'OPENROUTER_API_KEY não configurada' }, 500)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
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
  const nome = body.nome?.trim() || 'contrato'
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
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sistemaPrompt() },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extraia as entidades do contrato no formato especificado.' },
          conteudoArquivo
        ]
      }
    ]
  }
  // file-parser só quando um engine foi explicitamente configurado; senão o
  // modelo lê o arquivo nativamente. Imagens vão sempre direto ao vision.
  if (!isImagem && PDF_ENGINE) {
    reqBody.plugins = [{ id: 'file-parser', pdf: { engine: PDF_ENGINE } }]
  }

  const t0 = Date.now()
  let raw: string
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'InfraWork Extração de Contrato'
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
    parsed = extrairJson(raw) as Record<string, unknown>
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : 'JSON inválido', detalhe: raw.slice(0, 400) },
      502
    )
  }

  // Normalização defensiva server-side (o app confia neste shape).
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : (v as number)
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  const consorcioRaw = (parsed.consorcio ?? {}) as { is?: unknown; composicao?: unknown }
  const avisos = Array.isArray(parsed.avisos)
    ? (parsed.avisos as unknown[]).map((a) => String(a))
    : []

  const vigenciaInicio = str(parsed.vigencia_inicio)
  const prazoVigenciaDias = num(parsed.prazo_vigencia_dias)
  const prazoExecucaoDias = num(parsed.prazo_execucao_dias)
  const periodicidade = num(parsed.reajuste_periodicidade_meses)
  const reajusteDataBase = str(parsed.reajuste_data_base)

  // Prazo em MESES: usa o que veio; se só houver dias, converte (÷30, arredondado).
  let prazoVigenciaMeses = num(parsed.prazo_vigencia_meses)
  if (prazoVigenciaMeses == null && prazoVigenciaDias != null) {
    prazoVigenciaMeses = Math.round(prazoVigenciaDias / 30)
    avisos.push(
      `prazo de vigência convertido de ${prazoVigenciaDias} dias → ${prazoVigenciaMeses} meses (÷30).`
    )
  }

  // Fim da vigência: usa dias (mais preciso) quando o contrato expressa em dias;
  // senão soma os meses. Rede de segurança caso o modelo deixe null.
  let vigenciaFim = str(parsed.vigencia_fim)
  if (!vigenciaFim) {
    const calc =
      prazoVigenciaDias != null
        ? addDaysIso(vigenciaInicio, prazoVigenciaDias)
        : addMonthsIso(vigenciaInicio, prazoVigenciaMeses)
    if (calc) {
      vigenciaFim = calc
      avisos.push('vigencia_fim calculada (início + prazo de vigência).')
    }
  }

  // Janela de execução: calcula o fim por dias/meses a partir do início (ou da
  // vigência) quando o modelo não devolveu.
  const execucaoInicio = str(parsed.execucao_inicio)
  let execucaoFim = str(parsed.execucao_fim)
  if (!execucaoFim) {
    const base = execucaoInicio ?? vigenciaInicio
    const calc = prazoExecucaoDias != null ? addDaysIso(base, prazoExecucaoDias) : null
    if (calc) {
      execucaoFim = calc
      avisos.push('execucao_fim calculada (início + prazo de execução em dias).')
    }
  }
  let reajusteElegivel = str(parsed.reajuste_elegivel_em)
  if (!reajusteElegivel) {
    const base = reajusteDataBase ?? vigenciaInicio
    const calc = addMonthsIso(base, periodicidade ?? 12)
    if (calc) {
      reajusteElegivel = calc
      if (!reajusteDataBase) {
        avisos.push(
          'reajuste_elegivel_em estimado a partir do início (data-base do orçamento não explícita).'
        )
      }
    }
  }

  const extraido = {
    numero: str(parsed.numero),
    contratante: str(parsed.contratante),
    processo_sei: str(parsed.processo_sei),
    natureza: parsed.natureza === 'privado' ? 'privado' : 'publico',
    lei: str(parsed.lei),
    objeto: str(parsed.objeto),
    modalidade_regime: str(parsed.modalidade_regime),
    vigencia_inicio: vigenciaInicio,
    prazo_vigencia_meses: prazoVigenciaMeses,
    vigencia_fim: vigenciaFim,
    execucao_inicio: execucaoInicio,
    execucao_fim: execucaoFim,
    valor_original: num(parsed.valor_original),
    fiscal_responsavel: str(parsed.fiscal_responsavel),
    reajuste_indice: str(parsed.reajuste_indice),
    reajuste_periodicidade_meses: periodicidade,
    reajuste_data_base: reajusteDataBase,
    reajuste_elegivel_em: reajusteElegivel,
    consorcio: {
      is: consorcioRaw.is === true,
      composicao: Array.isArray(consorcioRaw.composicao)
        ? (consorcioRaw.composicao as unknown[]).map((c) => String(c)).filter(Boolean)
        : []
    }
  }

  return json({
    extraido,
    confianca: num(parsed.confianca) ?? 0,
    avisos,
    _meta: {
      modelo: OPENROUTER_MODEL,
      engine: isImagem ? 'vision' : PDF_ENGINE || 'native',
      duracao_ms: Date.now() - t0
    }
  })
})
