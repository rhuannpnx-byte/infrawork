import { useEffect, useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Consentimento do login OAuth do MCP do InfraWork (o próprio MCP é o servidor de autorização — mcp/oauth.ts).
 * O cliente (Claude.ai, ChatGPT…) abre /oauth/autorizar?response_type=code&client_id=…&redirect_uri=…&state=…
 * &code_challenge=…&code_challenge_method=S256. Com o usuário logado, "Permitir" emite o código (RPC
 * mcp_oauth_autorizar) e volta ao cliente. O pedido é lido no carregamento do módulo — antes do url-sync das abas.
 */
export interface PedidoOAuth {
  response_type: string
  client_id: string
  redirect_uri: string
  state: string | null
  code_challenge: string
  code_challenge_method: string
  scope: string | null
}

export const PEDIDO_OAUTH: PedidoOAuth | null = (() => {
  if (typeof window === 'undefined') return null
  if (!window.location.pathname.startsWith('/oauth/autorizar')) return null
  const q = new URLSearchParams(window.location.search)
  return {
    response_type: q.get('response_type') ?? '',
    client_id: q.get('client_id') ?? '',
    redirect_uri: q.get('redirect_uri') ?? '',
    state: q.get('state'),
    code_challenge: q.get('code_challenge') ?? '',
    code_challenge_method: q.get('code_challenge_method') ?? '',
    scope: q.get('scope')
  }
})()

function voltar(p: PedidoOAuth, params: Record<string, string>): void {
  const u = new URL(p.redirect_uri)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  if (p.state) u.searchParams.set('state', p.state)
  u.searchParams.set('iss', window.location.origin)
  window.location.href = u.toString()
}

export function OAuthConsentimento({ pedido }: { pedido: PedidoOAuth }): ReactNode {
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const [cliente, setCliente] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (pedido.response_type !== 'code')
      return setErro('Pedido inválido: response_type precisa ser "code".')
    if (pedido.code_challenge_method !== 'S256' || pedido.code_challenge.length < 43)
      return setErro('Pedido inválido: o aplicativo precisa usar PKCE (S256).')
    void supabase
      .rpc('mcp_oauth_cliente_info', {
        _client_id: pedido.client_id,
        _redirect_uri: pedido.redirect_uri
      })
      .then(({ data, error }) => {
        if (error) setErro(error.message)
        else setCliente((data as { nome: string }).nome)
      })
  }, [pedido])

  async function permitir(): Promise<void> {
    setEnviando(true)
    const { data, error } = await supabase.rpc('mcp_oauth_autorizar', {
      _client_id: pedido.client_id,
      _redirect_uri: pedido.redirect_uri,
      _code_challenge: pedido.code_challenge,
      _escopo: pedido.scope
    })
    if (error) {
      setEnviando(false)
      setErro(error.message)
      return
    }
    voltar(pedido, { code: data as string })
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md space-y-4 rounded border border-border bg-bg-panel p-6 text-xs">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <ShieldCheck size={16} className="text-accent" /> Conectar IA ao InfraWork
        </div>
        {erro ? (
          <p className="text-danger" data-testid="oauth-erro">
            {erro}
          </p>
        ) : !cliente ? (
          <p className="text-text-muted">Carregando o pedido…</p>
        ) : (
          <>
            <p className="text-text">
              <strong data-testid="oauth-cliente">{cliente}</strong> quer acessar o InfraWork como{' '}
              <strong>{profile?.nome}</strong> ({profile?.email}).
            </p>
            <p className="text-text-muted">
              A IA poderá ler e alterar o que você pode ler e alterar no InfraWork (orçamento,
              planejamento, acompanhamento), sempre com as suas permissões. Ações que apagam ou
              mexem em muita coisa pedem confirmação. Você pode revogar o acesso a qualquer momento
              no menu do usuário › Conectar IA.
            </p>
            <p className="break-all font-mono text-2xs text-text-dim">
              Retorno: {pedido.redirect_uri}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                disabled={enviando}
                onClick={() => voltar(pedido, { error: 'access_denied' })}
              >
                Negar
              </Button>
              <Button
                disabled={enviando}
                onClick={() => void permitir()}
                data-testid="oauth-permitir"
              >
                Permitir
              </Button>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-2xs font-mono text-text-dim underline hover:text-text"
        >
          entrar com outra conta
        </button>
      </div>
    </div>
  )
}
