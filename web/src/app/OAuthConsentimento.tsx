import { useEffect, useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Consentimento do OAuth (MCP): o Supabase Auth manda o usuário para /oauth/consentir?authorization_id=… quando um
 * cliente (Claude.ai, ChatGPT…) pede acesso. O pedido é lido no carregamento do módulo — antes do url-sync
 * reescrever a URL das abas.
 */
export const PEDIDO_OAUTH: string | null = (() => {
  if (typeof window === 'undefined') return null
  if (!window.location.pathname.startsWith('/oauth/consentir')) return null
  return new URLSearchParams(window.location.search).get('authorization_id')
})()

interface Detalhes {
  client: { name: string; uri?: string; logo_uri?: string }
  scope?: string
  user?: { email: string }
}

export function OAuthConsentimento({ authorizationId }: { authorizationId: string }): ReactNode {
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const [det, setDet] = useState<Detalhes | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (error || !data)
        return setErro(
          /disabled/i.test(error?.message ?? '')
            ? 'O login de IAs (OAuth) ainda não foi ligado no servidor do InfraWork.'
            : (error?.message ?? 'Pedido de acesso não encontrado.')
        )
      if ('redirect_url' in data && data.redirect_url) {
        window.location.href = data.redirect_url
        return
      }
      setDet(data as unknown as Detalhes)
    })
  }, [authorizationId])

  async function responder(permitir: boolean): Promise<void> {
    if (!supabase) return
    setEnviando(true)
    const api = supabase.auth.oauth
    const { data, error } = permitir
      ? await api.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await api.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
    if (error || !data?.redirect_url) {
      setEnviando(false)
      setErro(error?.message ?? 'Não foi possível responder ao pedido.')
      return
    }
    window.location.href = data.redirect_url
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
        ) : !det ? (
          <p className="text-text-muted">Carregando o pedido…</p>
        ) : (
          <>
            <p className="text-text">
              <strong>{det.client.name}</strong> quer acessar o InfraWork como{' '}
              <strong>{profile?.nome ?? det.user?.email}</strong> (
              {profile?.email ?? det.user?.email}
              ).
            </p>
            <p className="text-text-muted">
              A IA poderá ler e alterar o que você pode ler e alterar no InfraWork (orçamento,
              planejamento, acompanhamento), sempre com as suas permissões. Ações que apagam ou
              mexem em muita coisa pedem confirmação. Você pode revogar o acesso a qualquer momento
              no próprio cliente.
            </p>
            {det.client.uri ? (
              <p className="font-mono text-2xs text-text-dim">{det.client.uri}</p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" disabled={enviando} onClick={() => void responder(false)}>
                Negar
              </Button>
              <Button
                disabled={enviando}
                onClick={() => void responder(true)}
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
