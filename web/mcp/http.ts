/**
 * MCP do InfraWork por HTTP (Streamable HTTP, sem estado) — função da Vercel em /mcp (ver vercel.json).
 *
 * Login:
 *  - OAuth 2.1 (Claude.ai, ChatGPT…): o próprio MCP é o servidor de autorização (oauth.ts): registro dinâmico,
 *    consentimento na tela /oauth/autorizar do web, PKCE e renovação. Os tokens emitidos são `iwk_…` de 1 h.
 *    Sem token → 401 com o endereço dos metadados (/.well-known/oauth-protected-resource).
 *  - Token pessoal (`iwk_…`, IDEs e agentes): trocado por uma sessão do dono (token-pessoal.ts).
 *  - JWT de sessão do Supabase (testes e o modo stdio).
 * Rotas extras: /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server (e
 * openid-configuration), POST /oauth/registrar, POST /oauth/token e POST /mcp?sessao=1 (token → sessão, stdio).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { criarCtx } from './contexto'
import { criarServidor } from './servidor'
import { PADRAO } from './padrao'
import { PREFIXO_TOKEN, sessaoDoToken } from './token-pessoal'
import {
  ErroOAuth,
  emitirTokens,
  metadadosRecurso,
  metadadosServidor,
  registrarCliente
} from './oauth'

const url = process.env.INFRAWORK_SUPABASE_URL ?? PADRAO.supabaseUrl
const anon = process.env.INFRAWORK_SUPABASE_ANON_KEY ?? PADRAO.supabaseAnonKey
;(globalThis as Record<string, unknown>).__IW_ENV__ = {
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: anon
}

type Req = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> }

function origem(req: Req): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host)
  const proto = (req.headers['x-forwarded-proto'] as string) ?? (local ? 'http' : 'https')
  return `${proto}://${host}`
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
  const formulario = String(req.headers['content-type'] ?? '').includes('x-www-form-urlencoded')
  let s: string
  if (req.body !== undefined) {
    if (typeof req.body !== 'string') return req.body
    s = req.body
  } else {
    const partes: Buffer[] = []
    for await (const p of req) partes.push(p as Buffer)
    s = Buffer.concat(partes).toString('utf8')
  }
  if (!s) return undefined
  return formulario ? Object.fromEntries(new URLSearchParams(s)) : JSON.parse(s)
}

export default async function handler(req: Req, res: ServerResponse): Promise<void> {
  const u = new URL(req.url ?? '/', origem(req))
  const meta = `${origem(req)}/.well-known/oauth-protected-resource`

  if (req.method === 'OPTIONS') return enviar(res, 204, null)

  const o = origem(req)
  if (
    u.searchParams.get('wk') === 'prm' ||
    u.pathname.startsWith('/.well-known/oauth-protected-resource')
  )
    return enviar(res, 200, metadadosRecurso(o))
  if (
    u.searchParams.get('wk') === 'as' ||
    u.pathname.startsWith('/.well-known/oauth-authorization-server') ||
    u.pathname.startsWith('/.well-known/openid-configuration')
  )
    return enviar(res, 200, metadadosServidor(o))

  const oauth = u.searchParams.get('oauth')
  if (oauth === 'registrar' || oauth === 'token') {
    if (req.method !== 'POST')
      return enviar(res, 405, { error: 'invalid_request' }, { Allow: 'POST' })
    try {
      const b = ((await corpo(req)) ?? {}) as Record<string, unknown>
      if (oauth === 'registrar') return enviar(res, 201, await registrarCliente(url, b))
      const p = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v)]))
      return enviar(res, 200, await emitirTokens(url, p), { 'Cache-Control': 'no-store' })
    } catch (e) {
      const err = e instanceof ErroOAuth ? e : new ErroOAuth('server_error', String(e), 500)
      return enviar(res, err.status, { error: err.codigo, error_description: err.message })
    }
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
