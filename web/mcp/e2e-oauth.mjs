// E2E do login OAuth do MCP (stack local + web em 5174): cliente do SDK do MCP (descoberta, registro dinâmico,
// PKCE), consentimento na tela /oauth/autorizar (Playwright), troca do código, uso no MCP, renovação com rotação e
// revogação pela tela de tokens. Usa o usuário adm de teste (E2E_EMAIL/E2E_PASSWORD).
//   node mcp/build.mjs --modo=local && E2E_EMAIL=… E2E_PASSWORD=… node mcp/e2e-oauth.mjs
import { createRequire } from 'node:module'
import http from 'node:http'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const W = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(W + '/package.json')
const EMAIL = process.env.E2E_EMAIL
const SENHA = process.env.E2E_PASSWORD
if (!EMAIL || !SENHA) throw new Error('E2E_EMAIL e E2E_PASSWORD são obrigatórios')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js')
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const env = Object.fromEntries(
  execSync('npx supabase status -o env', { cwd: W, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
)
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY
const { default: handler } = await import(new URL('./dist/http.mjs', import.meta.url).href)
const BASE = 'http://localhost:3999'
const WEB = 'http://localhost:5174'
const srv = http
  .createServer((req, res) => {
    const u = new URL(req.url, BASE)
    if (u.pathname === '/oauth/autorizar') {
      res.writeHead(302, { Location: WEB + req.url })
      return res.end()
    }
    if (u.pathname === '/oauth/registrar') req.url = '/api/mcp?oauth=registrar'
    if (u.pathname === '/oauth/token') req.url = '/api/mcp?oauth=token'
    return handler(req, res)
  })
  .listen(3999)
let falha = 0
const check = (n, c, i = '') => {
  console.log(`${c ? '✓' : '✗'} ${n}${i ? ' — ' + i : ''}`)
  if (!c) falha++
}

let info, toks, verifier, urlAut
const REDIRECT = 'http://localhost:9999/callback'
const provider = {
  get redirectUrl() {
    return REDIRECT
  },
  get clientMetadata() {
    return {
      client_name: 'Teste SDK',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  },
  clientInformation: () => info,
  saveClientInformation: (i) => {
    info = i
  },
  tokens: () => toks,
  saveTokens: (t) => {
    toks = t
  },
  redirectToAuthorization: (u) => {
    urlAut = u
  },
  saveCodeVerifier: (v) => {
    verifier = v
  },
  codeVerifier: () => verifier
}
let transport = new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { authProvider: provider })
let c = new Client({ name: 'teste-oauth', version: '1' })
try {
  await c.connect(transport)
  check('deveria pedir login', false)
} catch (e) {
  check(
    'sem login → fluxo OAuth iniciado (descoberta + registro dinâmico)',
    e instanceof UnauthorizedError && !!info?.client_id && !!urlAut,
    info?.client_id ?? String(e)
  )
}
check(
  'URL de autorização com PKCE S256',
  urlAut?.searchParams.get('code_challenge_method') === 'S256' && urlAut?.pathname === '/oauth/autorizar',
  urlAut?.toString().slice(0, 80)
)

const b = await chromium.launch()
const pg = await (await b.newContext({ viewport: { width: 1200, height: 800 }, locale: 'pt-BR' })).newPage()
let codigo = null
await pg.route('http://localhost:9999/**', (r) => {
  codigo = new URL(r.request().url()).searchParams.get('code')
  r.fulfill({ body: 'ok' })
})
await pg.goto(urlAut.toString())
await pg.waitForURL(/5174\/oauth\/autorizar/)
await pg.fill('input[type="email"]', EMAIL)
await pg.fill('input[type="password"]', SENHA)
await pg.getByRole('button', { name: /Entrar/ }).click()
await pg.getByTestId('oauth-cliente').waitFor({ timeout: 20000 })
check('tela de consentimento mostra o aplicativo', (await pg.getByTestId('oauth-cliente').innerText()) === 'Teste SDK')
await pg.getByTestId('oauth-permitir').click()
for (let i = 0; i < 40 && !codigo; i++) await new Promise((r) => setTimeout(r, 250))
check('Permitir devolve o código ao aplicativo', !!codigo)
await b.close()

await transport.finishAuth(codigo)
check(
  'código trocado por tokens (PKCE)',
  toks?.access_token?.startsWith('iwk_') && toks?.refresh_token?.startsWith('iwr_'),
  `expira em ${toks?.expires_in}s`
)
transport = new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { authProvider: provider })
c = new Client({ name: 'teste-oauth', version: '1' })
await c.connect(transport)
const eu = JSON.parse((await c.callTool({ name: 'quem_sou', arguments: {} })).content[0].text)
check('MCP com o token do login: quem_sou', eu.usuario?.email === EMAIL)
await c.close()

const post = (corpo) =>
  fetch(BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corpo)
  })
const chamar = (tk) =>
  fetch(BASE + '/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  })
const reuso = await post({ grant_type: 'authorization_code', code: codigo, code_verifier: verifier, client_id: info.client_id, redirect_uri: REDIRECT })
check('código não pode ser usado de novo', reuso.status === 400, (await reuso.json()).error_description)
const r1 = await post({ grant_type: 'refresh_token', refresh_token: toks.refresh_token, client_id: info.client_id })
const n1 = await r1.json()
check('renovação emite novo par', r1.ok && n1.access_token !== toks.access_token && n1.refresh_token !== toks.refresh_token)
const r2 = await post({ grant_type: 'refresh_token', refresh_token: toks.refresh_token, client_id: info.client_id })
check('renovação antiga não vale mais (rotação)', r2.status === 400)
check('token de acesso antigo deixa de valer', (await chamar(toks.access_token)).status === 401)
check('token novo vale', (await chamar(n1.access_token)).status === 200)

const sb = createClient(env.API_URL, env.PUBLISHABLE_KEY ?? env.ANON_KEY, { auth: { persistSession: false } })
await sb.auth.signInWithPassword({ email: EMAIL, password: SENHA })
const { data: lista } = await sb.from('mcp_token').select('id, nome, tipo').eq('tipo', 'oauth')
check('login aparece na lista de tokens do usuário', lista?.some((t) => t.nome === 'Teste SDK (login)'), JSON.stringify(lista?.map((t) => t.nome)))
for (const t of lista ?? []) await sb.rpc('mcp_token_revogar', { _id: t.id })
const r3 = await post({ grant_type: 'refresh_token', refresh_token: n1.refresh_token, client_id: info.client_id })
check('revogado: renovação e acesso recusados', r3.status === 400 && (await chamar(n1.access_token)).status === 401)
const ruim = await fetch(BASE + '/oauth/registrar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'x', redirect_uris: ['javascript:alert(1)'] })
})
check('registro recusa redirect perigoso', ruim.status === 400)
srv.close()
console.log(falha ? `${falha} falha(s)` : 'TUDO OK')
process.exit(falha ? 1 : 0)
