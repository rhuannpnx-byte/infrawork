// Pipeline de visão via OpenRouter. Para cada imagem decide:
//   - é foto de serviço de obra? (descarta memes, prints, selfies, etc.)
//   - tem overlay de geolocalização queimado na imagem? (estilo GPS Map Camera)
//   - lat/lng e timestamp lidos do overlay
//   - qual serviço do catálogo da obra melhor descreve a foto

import { config } from './config.js'
import { logger } from './logger.js'

export interface ServicoCatalogoItem {
  codigo: string
  nome: string
  unidade?: string | null
}

export interface VisionResult {
  is_foto_servico: boolean
  tem_geo_overlay: boolean
  lat: number | null
  lng: number | null
  captured_at: string | null
  servico_codigo: string | null
  confianca: number
  descricao: string | null
}

const SYSTEM_PROMPT = `Você é um analista de fotos de obras de infraestrutura rodoviária/pavimentação.
Receberá UMA imagem enviada num grupo de WhatsApp de uma equipe de obra.
Responda SOMENTE com um objeto JSON válido (sem markdown, sem comentários) com os campos:
{
  "is_foto_servico": boolean,   // true se for foto de execução/serviço de obra (terraplenagem, pavimentação, drenagem, sinalização, etc.). false para memes, prints de conversa, selfies, documentos, fotos pessoais.
  "tem_geo_overlay": boolean,   // true se há coordenadas de GPS escritas/queimadas na própria imagem (overlay de apps tipo "GPS Map Camera", "Timestamp Camera").
  "lat": number|null,           // latitude lida do overlay em graus decimais (ex: -15.793889). null se não houver.
  "lng": number|null,           // longitude lida do overlay em graus decimais. null se não houver.
  "captured_at": string|null,   // data/hora lida do overlay em ISO 8601 (ex: "2026-06-18T14:30:00"). null se não houver.
  "servico_codigo": string|null,// código EXATO da lista fornecida que melhor descreve a execução na foto; null se NENHUM serviço da lista corresponder bem.
  "confianca": number,          // 0..1 confiança HONESTA da correspondência com o servico_codigo (baixa se a foto for ruim/ambígua).
  "descricao": string|null      // breve descrição (pt-BR) do que aparece na foto.
}
Regras para a GEOLOCALIZAÇÃO (muito importante):
- Apps como "GPS Map Camera", "Timestamp Camera", "GPS Camera" gravam um RODAPÉ/CARIMBO na foto com endereço, mapa em miniatura, data/hora E as coordenadas.
- PROCURE ATIVAMENTE pela latitude e longitude no carimbo. Elas costumam aparecer como:
  • "Lat -17.797000  Long -50.916000" / "Latitude/Longitude: -17.79, -50.91"
  • um par de números decimais com sinal e muitas casas (ex.: -17.797123, -50.916456)
  • formato GMS: 17°47'49.6"S 50°54'59.2"W
- No Brasil a latitude é ~ -1 a -34 e a longitude ~ -34 a -74 (ambas NEGATIVAS). Se achar números nessa faixa formando um par, são as coordenadas.
- Converta GMS para graus decimais. Sul e Oeste são NEGATIVOS.
- Se encontrar o par lat/long, defina tem_geo_overlay=true e preencha lat e lng. Só deixe null se realmente NÃO houver números de coordenadas no carimbo (endereço/rodovia/Km sozinhos NÃO são coordenadas).
- Se a imagem não for foto de serviço, ainda preencha os demais campos com null/false.

Regra para o SERVIÇO (qualidade > quantidade — queremos só as melhores fotos):
- Marque is_foto_servico=false para documentos, prints, recibos, fotos borradas/escuras/ruins, selfies ou qualquer coisa que não seja a execução de um serviço de obra.
- Escolha "servico_codigo" da lista SOMENTE se a foto claramente mostra aquele serviço. Não invente códigos fora da lista.
- Se nenhum serviço da lista corresponder com clareza, retorne servico_codigo=null.
- A "confianca" deve ser honesta: use valores baixos quando a foto for ambígua ou a correspondência for fraca.`

function extrairJson(texto: string): unknown {
  const limpo = texto.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio === -1 || fim === -1) throw new Error('Resposta sem JSON')
  return JSON.parse(limpo.slice(inicio, fim + 1))
}

function normalizar(raw: Record<string, unknown>): VisionResult {
  const numOrNull = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v) : (v as number)
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  }
  return {
    is_foto_servico: raw.is_foto_servico === true,
    tem_geo_overlay: raw.tem_geo_overlay === true,
    lat: numOrNull(raw.lat),
    lng: numOrNull(raw.lng),
    captured_at: typeof raw.captured_at === 'string' ? raw.captured_at : null,
    servico_codigo: typeof raw.servico_codigo === 'string' ? raw.servico_codigo : null,
    confianca: numOrNull(raw.confianca) ?? 0,
    descricao: typeof raw.descricao === 'string' ? raw.descricao : null
  }
}

export async function classificarFoto(
  imagem: Buffer,
  mime: string,
  catalogo: ServicoCatalogoItem[]
): Promise<VisionResult> {
  const catalogoTxt = catalogo
    .map((s) => `- ${s.codigo}: ${s.nome}${s.unidade ? ` (${s.unidade})` : ''}`)
    .join('\n')
  const dataUrl = `data:${mime || 'image/jpeg'};base64,${imagem.toString('base64')}`

  const body = {
    model: config.openrouterModel,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Catálogo de serviços desta obra (use o código exato):\n${catalogoTxt || '(catálogo vazio)'}`
          },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  }

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'InfraWork WhatsApp Agent'
    },
    body: JSON.stringify(body)
  })

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`OpenRouter ${resp.status}: ${txt.slice(0, 300)}`)
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter sem conteúdo')

  const parsed = normalizar(extrairJson(content) as Record<string, unknown>)
  logger.debug({ parsed }, 'classificação de visão')
  return parsed
}
