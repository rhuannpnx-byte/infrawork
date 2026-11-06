/**
 * Servidor MCP do InfraWork: registra as ferramentas, o guia e os prompts. Cada chamada roda no contexto do
 * usuário (RLS do banco), obtido por `obterCtx` — sessão do stdio ou o token da requisição HTTP.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { comCtx, type Ctx } from './contexto'
import type { Ferramenta } from './ferramenta'
import { FERRAMENTAS } from './ferramentas'
import { GUIA } from './guia'
import { PROMPTS } from './prompts'

export const VERSAO = '1.0.0'
const LIMITE_TEXTO = 200_000

function texto(v: unknown): string {
  const s = JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x), 2)
  if (s.length <= LIMITE_TEXTO) return s
  return (
    s.slice(0, LIMITE_TEXTO) +
    `\n… (resposta cortada em ${LIMITE_TEXTO} caracteres de ${s.length}; peça menos linhas, filtre ou pagine)`
  )
}

export function criarServidor(obterCtx: () => Promise<Ctx>): McpServer {
  const s = new McpServer(
    { name: 'infrawork', title: 'InfraWork', version: VERSAO },
    {
      instructions:
        'InfraWork: orçamento, composições, planejamento (cronograma), acompanhamento de obras rodoviárias. ' +
        'Comece por quem_sou. Leia o recurso infrawork://guia antes de montar ou alterar uma obra. Ações ' +
        'destrutivas devolvem o impacto e só executam com confirmar=true depois de o usuário concordar.'
    }
  )

  for (const f of FERRAMENTAS as Ferramenta[]) {
    s.registerTool(
      f.nome,
      {
        title: f.titulo,
        description: f.descricao,
        inputSchema: f.entrada,
        annotations: {
          title: f.titulo,
          readOnlyHint: !!f.leitura,
          destructiveHint: !!f.destrutiva,
          openWorldHint: false
        }
      },
      async (args: Record<string, unknown>) => {
        try {
          const ctx = await obterCtx()
          const r = await comCtx(ctx, () => f.executar(args as never))
          return { content: [{ type: 'text' as const, text: texto(r) }] }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return { isError: true, content: [{ type: 'text' as const, text: `Erro: ${msg}` }] }
        }
      }
    )
  }

  s.registerResource(
    'guia',
    'infrawork://guia',
    {
      title: 'Guia do InfraWork para a IA',
      description:
        'Ordem das operações e regras do domínio (leia antes de montar ou alterar uma obra).',
      mimeType: 'text/markdown'
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIA }] })
  )

  for (const p of PROMPTS) {
    s.registerPrompt(
      p.nome,
      {
        title: p.titulo,
        description: p.descricao,
        argsSchema: Object.fromEntries(
          p.argumentos.map((a) => [a, z.string().optional()])
        ) as Record<string, z.ZodOptional<z.ZodString>>
      },
      (args: Record<string, string | undefined>) => ({
        messages: [
          { role: 'user' as const, content: { type: 'text' as const, text: p.texto(args) } }
        ]
      })
    )
  }
  return s
}
