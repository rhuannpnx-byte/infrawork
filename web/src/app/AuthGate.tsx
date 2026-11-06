import { useEffect, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { LoginPage, RedefinirSenhaPage } from './routes/LoginPage'
import { OAuthConsentimento, PEDIDO_OAUTH } from './OAuthConsentimento'

export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const status = useAuthStore((s) => s.status)
  const bootstrap = useAuthStore((s) => s.bootstrap)
  const recuperacaoSenha = useAuthStore((s) => s.recuperacaoSenha)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const signOut = useAuthStore((s) => s.signOut)

  useEffect(() => {
    if (status === 'idle') void bootstrap()
  }, [status, bootstrap])

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="text-text-muted text-sm font-mono">Carregando…</div>
      </div>
    )
  }

  if (status === 'guest') {
    return <LoginPage />
  }

  if (recuperacaoSenha) {
    return <RedefinirSenhaPage />
  }

  if (PEDIDO_OAUTH) {
    return <OAuthConsentimento pedido={PEDIDO_OAUTH} />
  }

  // apontador: só o app de campo
  if (role === 'apontador') {
    const url = import.meta.env.VITE_CAMPO_URL as string | undefined
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <div className="text-sm font-semibold text-text">Use o app de campo</div>
        <p className="max-w-sm text-xs text-text-muted">
          Seu acesso é de apontador: produção, viagens e fotos são lançadas pelo aplicativo de campo
          do InfraWork.
        </p>
        {url ? (
          <a href={url} className="text-xs text-accent underline">
            Abrir o app de campo
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-2xs font-mono text-text-dim underline hover:text-text"
        >
          sair
        </button>
      </div>
    )
  }

  return <>{children}</>
}
