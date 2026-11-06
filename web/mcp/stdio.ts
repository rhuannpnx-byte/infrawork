/**
 * MCP do InfraWork no modo local (stdio), para Claude Code, Claude Desktop, Cursor etc. na própria máquina.
 *
 * Variáveis:
 *   INFRAWORK_SUPABASE_URL, INFRAWORK_SUPABASE_ANON_KEY  — projeto (padrão: o remoto de produção)
 *   INFRAWORK_EMAIL + INFRAWORK_SENHA                     — login com a conta do usuário, ou
 *   INFRAWORK_TOKEN                                       — token pessoal (gerado no web, Perfil › Tokens de IA)
 *   INFRAWORK_SITE                                        — site do web para trocar o token (padrão: produção)
 */
import { createClient } from '@supabase/supabase-js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { criarCtx, type Ctx } from './contexto'
import { criarServidor } from './servidor'
import { PADRAO } from './padrao'

const url = process.env.INFRAWORK_SUPABASE_URL ?? PADRAO.supabaseUrl
const anon = process.env.INFRAWORK_SUPABASE_ANON_KEY ?? PADRAO.supabaseAnonKey
const site = process.env.INFRAWORK_SITE ?? PADRAO.site
;(globalThis as Record<string, unknown>).__IW_ENV__ = {
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: anon
}

const auth = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
})

async function entrar(): Promise<void> {
  const email = process.env.INFRAWORK_EMAIL
  const senha = process.env.INFRAWORK_SENHA
  const token = process.env.INFRAWORK_TOKEN
  if (token) {
    const r = await fetch(`${site}/api/mcp?sessao=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })
    const j = (await r.json().catch(() => null)) as {
      access_token?: string
      refresh_token?: string
      error?: string
    } | null
    if (!r.ok || !j?.access_token || !j.refresh_token)
      throw new Error(`Token recusado: ${j?.error ?? r.statusText}`)
    const { error } = await auth.auth.setSession({
      access_token: j.access_token,
      refresh_token: j.refresh_token
    })
    if (error) throw error
    return
  }
  if (!email || !senha)
    throw new Error('Defina INFRAWORK_TOKEN ou INFRAWORK_EMAIL e INFRAWORK_SENHA.')
  const { error } = await auth.auth.signInWithPassword({ email, password: senha })
  if (error) throw new Error(`Login recusado: ${error.message}`)
}

let cache: Ctx | null = null
async function obterCtx(): Promise<Ctx> {
  const { data } = await auth.auth.getSession()
  const jwt = data.session?.access_token
  if (!jwt) throw new Error('Sessão encerrada; reinicie o MCP.')
  if (cache?.jwt !== jwt) cache = await criarCtx(url, anon, jwt)
  return cache
}

await entrar()
await criarServidor(obterCtx).connect(new StdioServerTransport())
