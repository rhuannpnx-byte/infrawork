/**
 * MCP do InfraWork por HTTP (Streamable HTTP, sem estado) — função da Vercel em /mcp (ver vercel.json).
 *
 * Login:
 *  - OAuth 2.1 (Claude.ai, ChatGPT…): o servidor de autorização é o Supabase Auth; o cliente manda o JWT do usuário.
 *    Sem token → 401 com o endereço dos metadados (/.well-known/oauth-protected-resource).
 *  - Token pessoal (`iwk_…`, IDEs e agentes): trocado por uma sessão do dono (token-pessoal.ts).
 * Rotas extras: GET /.well-known/oauth-protected-resource e /.well-known/oauth-authorization-server (proxy do
 * Supabase), e POST /mcp?sessao=1 (token pessoal → sessão, usado pelo modo stdio).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { criarCtx } from './contexto'
import { criarServidor } from './servidor'
import { PADRAO } from './padrao'
import { PREFIXO_TOKEN, sessaoDoToken } from './token-pessoal'

const url = process.env.INFRAWORK_SUPABASE_URL ?? PADRAO.supabaseUrl
const anon = process.env.INFRAWORK_SUPABASE_ANON_KEY ?? PADRAO.supabaseAnonKey
;(globalThis as Record<string, unknown>).__IW_ENV__ = {
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: anon
}
const emissor = `${url}/auth/v1`

type Req = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> }

function origem(req: Req): string {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https'
  return `${proto}://${req.headers['x-forwarded-host'] ?? req.headers.host}`
}

function enviar(
  res: ServerResponse,
  status: number,
  corpo: unknown,
  headers: Record<string, string> = {}
) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    ...headers
  })
  res.end(JSON.stringify(corpo))
}

async function corpo(req: Req): Promise<unknown> {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const partes: Buffer[] = []
  for await (const p of req) partes.push(p as Buffer)
  const s = Buffer.concat(partes).toString('utf8')
  return s ? JSON.parse(s) : undefined
}

export default async function handler(req: Req, res: ServerResponse): Promise<void> {
  const u = new URL(req.url ?? '/', origem(req))
  const recurso = `${origem(req)}/mcp`
  const meta = `${origem(req)}/.well-known/oauth-protected-resource`

  if (req.method === 'OPTIONS') return enviar(res, 204, null)

  if (
    u.searchParams.get('wk') === 'prm' ||
    u.pathname.startsWith('/.well-known/oauth-protected-resource')
  ) {
    return enviar(res, 200, {
      resource: recurso,
      authorization_servers: [emissor],
      bearer_methods_supported: ['header'],
      resource_name: 'InfraWork'
    })
  }
  if (
    u.searchParams.get('wk') === 'as' ||
    u.pathname.startsWith('/.well-known/oauth-authorization-server')
  ) {
    const r = await fetch(`${url}/.well-known/oauth-authorization-server/auth/v1`)
    return enviar(res, r.status, await r.json().catch(() => ({})))
  }

  const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
  const naoAutorizado = (msg: string) =>
    enviar(
      res,
      401,
      { error: msg },
      { 'WWW-Authenticate': `Bearer resource_metadata="${meta}", error="invalid_token"` }
    )
  if (!auth) return naoAutorizado('Faça login (OAuth) ou envie um token pessoal do InfraWork.')

  let jwt = auth
  if (auth.startsWith(PREFIXO_TOKEN)) {
    try {
      const s = await sessaoDoToken(url, anon, auth)
      if (u.searchParams.get('sessao') === '1')
        return enviar(res, 200, { access_token: s.access_token, refresh_token: s.refresh_token })
      jwt = s.access_token
    } catch (e) {
      return naoAutorizado(e instanceof Error ? e.message : String(e))
    }
  }

  let ctx
  try {
    ctx = await criarCtx(url, anon, jwt)
  } catch (e) {
    return naoAutorizado(e instanceof Error ? e.message : String(e))
  }

  if (req.method !== 'POST')
    return enviar(
      res,
      405,
      { error: 'Use POST (MCP Streamable HTTP, sem sessão).' },
      { Allow: 'POST' }
    )

  const servidor = criarServidor(async () => ctx)
  const transporte = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  res.on('close', () => {
    void transporte.close()
    void servidor.close()
  })
  res.setHeader('Access-Control-Allow-Origin', '*')
  await servidor.connect(transporte)
  await transporte.handleRequest(req, res, await corpo(req))
}
