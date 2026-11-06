/**
 * Servidor OAuth 2.1 do MCP (RFC 8414 metadados, RFC 7591 registro dinâmico, PKCE S256, renovação com rotação).
 * O consentimento é a tela /oauth/autorizar do web (o usuário entra com a conta do InfraWork e permite); ela emite o
 * código pela RPC mcp_oauth_autorizar. Aqui o código vira um par de tokens guardados em mcp_token (tipo 'oauth'):
 * o de acesso (iwk_…, 1 h) é validado como um token pessoal; o de renovação (iwr_…, 90 dias) troca de valor a cada uso.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const ESCOPO = 'infrawork'
const ACESSO_S = 3600
const RENOVACAO_S = 90 * 86400

const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex')
const aleatorio = (): string => randomBytes(32).toString('base64url')

export class ErroOAuth extends Error {
  constructor(
    public codigo: string,
    mensagem: string,
    public status = 400
  ) {
    super(mensagem)
  }
}

function admin(url: string): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new ErroOAuth('server_error', 'Servidor sem a service key.', 500)
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function metadadosServidor(origem: string) {
  return {
    issuer: origem,
    authorization_endpoint: `${origem}/oauth/autorizar`,
    token_endpoint: `${origem}/oauth/token`,
    registration_endpoint: `${origem}/oauth/registrar`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [ESCOPO],
    service_documentation: `${origem}/`
  }
}

export function metadadosRecurso(origem: string) {
  return {
    resource: `${origem}/mcp`,
    authorization_servers: [origem],
    bearer_methods_supported: ['header'],
    scopes_supported: [ESCOPO],
    resource_name: 'InfraWork'
  }
}

const redirectValido = (u: string): boolean => {
  try {
    const x = new URL(u)
    if (x.hash) return false
    if (x.protocol === 'https:') return true
    if (x.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)
    // apps nativos (esquema próprio, ex.: cursor://)
    return (
      /^[a-z][a-z0-9+.-]*:$/.test(x.protocol) &&
      !['javascript:', 'data:', 'file:'].includes(x.protocol)
    )
  } catch {
    return false
  }
}

/** RFC 7591: registro dinâmico (clientes públicos, sem segredo, com PKCE). */
export async function registrarCliente(url: string, corpo: Record<string, unknown>) {
  const uris = Array.isArray(corpo.redirect_uris) ? corpo.redirect_uris.map(String) : []
  if (uris.length === 0 || uris.length > 10 || !uris.every(redirectValido))
    throw new ErroOAuth(
      'invalid_redirect_uri',
      'redirect_uris inválidos (https, localhost ou esquema de app).'
    )
  const nome = String(corpo.client_name ?? 'Aplicativo de IA').slice(0, 80)
  const client_id = `iwc_${randomUUID()}`
  const { error } = await admin(url)
    .from('mcp_oauth_cliente')
    .insert({ client_id, nome, redirect_uris: uris })
  if (error) throw new ErroOAuth('server_error', error.message, 500)
  return {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: nome,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: ESCOPO
  }
}

interface Emitidos {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

function novoPar() {
  const acesso = `iwk_${aleatorio()}`
  const renovacao = `iwr_${aleatorio()}`
  return {
    acesso,
    renovacao,
    campos: {
      hash: sha256hex(acesso),
      prefixo: acesso.slice(0, 10),
      expira_em: new Date(Date.now() + ACESSO_S * 1000).toISOString(),
      refresh_hash: sha256hex(renovacao),
      refresh_expira_em: new Date(Date.now() + RENOVACAO_S * 1000).toISOString()
    }
  }
}

const resposta = (acesso: string, renovacao: string): Emitidos => ({
  access_token: acesso,
  token_type: 'Bearer',
  expires_in: ACESSO_S,
  refresh_token: renovacao,
  scope: ESCOPO
})

/** /oauth/token: authorization_code (com PKCE) ou refresh_token (com rotação). */
export async function emitirTokens(url: string, p: Record<string, string>): Promise<Emitidos> {
  const adm = admin(url)
  const { data: cli } = await adm
    .from('mcp_oauth_cliente')
    .select('id, nome')
    .eq('client_id', p.client_id ?? '')
    .maybeSingle()
  if (!cli) throw new ErroOAuth('invalid_client', 'client_id desconhecido.', 401)

  if (p.grant_type === 'authorization_code') {
    if (!p.code || !p.code_verifier)
      throw new ErroOAuth('invalid_request', 'Faltam code e code_verifier.')
    const { data: c } = await adm
      .from('mcp_oauth_codigo')
      .select('hash, cliente_id, user_id, redirect_uri, code_challenge, expira_em, usado_em')
      .eq('hash', sha256hex(p.code))
      .maybeSingle()
    if (!c || c.cliente_id !== cli.id) throw new ErroOAuth('invalid_grant', 'Código inválido.')
    if (c.usado_em) throw new ErroOAuth('invalid_grant', 'Código já usado.')
    if (new Date(c.expira_em).getTime() < Date.now())
      throw new ErroOAuth('invalid_grant', 'Código expirado.')
    if (p.redirect_uri && p.redirect_uri !== c.redirect_uri)
      throw new ErroOAuth('invalid_grant', 'redirect_uri diferente do da autorização.')
    const desafio = createHash('sha256').update(p.code_verifier).digest('base64url')
    if (desafio !== c.code_challenge) throw new ErroOAuth('invalid_grant', 'PKCE não confere.')
    const { data: marcado } = await adm
      .from('mcp_oauth_codigo')
      .update({ usado_em: new Date().toISOString() })
      .eq('hash', c.hash)
      .is('usado_em', null)
      .select('hash')
    if (!marcado?.length) throw new ErroOAuth('invalid_grant', 'Código já usado.')
    const { data: perfil } = await adm
      .from('profiles')
      .select('ativo')
      .eq('id', c.user_id)
      .maybeSingle()
    if (!perfil?.ativo) throw new ErroOAuth('invalid_grant', 'Usuário inativo.')
    const par = novoPar()
    const { error } = await adm.from('mcp_token').insert({
      user_id: c.user_id,
      nome: `${cli.nome} (login)`,
      tipo: 'oauth',
      cliente_id: cli.id,
      ...par.campos
    })
    if (error) throw new ErroOAuth('server_error', error.message, 500)
    return resposta(par.acesso, par.renovacao)
  }

  if (p.grant_type === 'refresh_token') {
    if (!p.refresh_token) throw new ErroOAuth('invalid_request', 'Falta refresh_token.')
    const antigo = sha256hex(p.refresh_token)
    const { data: t } = await adm
      .from('mcp_token')
      .select('id, user_id, cliente_id, revogado_em, refresh_expira_em')
      .eq('refresh_hash', antigo)
      .maybeSingle()
    if (!t || t.cliente_id !== cli.id || t.revogado_em)
      throw new ErroOAuth('invalid_grant', 'Renovação inválida ou revogada.')
    if (!t.refresh_expira_em || new Date(t.refresh_expira_em).getTime() < Date.now())
      throw new ErroOAuth('invalid_grant', 'Renovação expirada — entre de novo.')
    const { data: perfil } = await adm
      .from('profiles')
      .select('ativo')
      .eq('id', t.user_id)
      .maybeSingle()
    if (!perfil?.ativo) throw new ErroOAuth('invalid_grant', 'Usuário inativo.')
    const par = novoPar()
    const { data: ok } = await adm
      .from('mcp_token')
      .update(par.campos)
      .eq('id', t.id)
      .eq('refresh_hash', antigo)
      .select('id')
    if (!ok?.length) throw new ErroOAuth('invalid_grant', 'Renovação já usada.')
    return resposta(par.acesso, par.renovacao)
  }

  throw new ErroOAuth('unsupported_grant_type', 'Use authorization_code ou refresh_token.')
}
