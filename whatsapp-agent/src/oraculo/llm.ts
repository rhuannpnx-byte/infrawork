// Chamada ao OpenRouter com tool-calling para o Oráculo. Reaproveita o padrão
// de fetch de vision.ts. Faz o loop: resposta → executa tools → re-chama, até
// o modelo devolver texto final (ou bater o teto de iterações).

import { config } from '../config.js'
import { logger } from '../logger.js'
import { TOOL_DEFS, executarTool, type ToolCtx } from './tools.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

const MAX_ITER = 4

async function chamarOpenRouter(messages: ChatMessage[]): Promise<{
  content: string | null
  tool_calls?: ToolCall[]
}> {
  const body = {
    model: config.openrouterModelRag,
    temperature: 0.2,
    // Cap explícito: sem isto o OpenRouter reserva o máximo do modelo como
    // caução de crédito e devolve 402 mesmo com saldo para a resposta real.
    max_tokens: config.oraculoMaxTokens,
    messages,
    tools: TOOL_DEFS,
    tool_choice: 'auto'
  }
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'InfraWork Oráculo'
    },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`OpenRouter ${resp.status}: ${txt.slice(0, 300)}`)
  }
  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>
  }
  const msg = json.choices?.[0]?.message
  return { content: msg?.content ?? null, tool_calls: msg?.tool_calls }
}

/** Roda a conversa com o LLM. Retorna o texto final e os nomes das tools usadas. */
export async function responder(
  messages: ChatMessage[],
  ctx: ToolCtx
): Promise<{ texto: string; toolsUsadas: string[] }> {
  const toolsUsadas: string[] = []
  const msgs = [...messages]

  for (let i = 0; i < MAX_ITER; i++) {
    const r = await chamarOpenRouter(msgs)

    if (r.tool_calls && r.tool_calls.length > 0) {
      // registra a mensagem do assistente com os tool_calls
      msgs.push({ role: 'assistant', content: r.content ?? null, tool_calls: r.tool_calls })
      for (const tc of r.tool_calls) {
        let args: Record<string, unknown> = {}
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
        } catch {
          args = {}
        }
        toolsUsadas.push(tc.function.name)
        const resultado = await executarTool(tc.function.name, args, ctx)
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: resultado })
      }
      continue
    }

    return { texto: r.content?.trim() || 'Não consegui formular uma resposta.', toolsUsadas }
  }

  logger.warn({ obra: ctx.obra.codigo }, 'oráculo bateu o teto de iterações de tools')
  return {
    texto: 'Precisei consultar vários dados e não consegui finalizar. Pode reformular a pergunta?',
    toolsUsadas
  }
}
