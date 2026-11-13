import { useEffect, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { LoginPage, RedefinirSenhaPage } from './routes/LoginPage'
import { OAuthConsentimento, PEDIDO_OAUTH } from './OAuthConsentimento'
import { CurvasDeNivel } from '@/components/layout/CurvasDeNivel'
import { Carregando } from '@/components/ui/estado'

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
      <div className="relative isolate flex h-screen items-center justify-center overflow-hidden bg-bg">
        <CurvasDeNivel className="-z-10" semente={7} />
        <Carregando texto="Abrindo o InfraWork…" className="py-0" />
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
        <h1 className="text-xl font-semibold text-text">Use o app de campo</h1>
        <p className="max-w-sm text-sm text-text-muted">
          Seu acesso é de apontador: produção, viagens e fotos são lançadas pelo aplicativo de campo
          do InfraWork.
        </p>
        {url ? (
          <a
            href={url}
            className="inline-flex h-9 items-center rounded border border-accent bg-accent px-3.5 text-sm font-semibold text-[color:var(--on-accent)] hover:bg-accent-hover"
          >
            Abrir o app de campo
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-sm text-text-muted underline hover:text-text"
        >
          Sair
        </button>
      </div>
    )
  }

  return <>{children}</>
}
