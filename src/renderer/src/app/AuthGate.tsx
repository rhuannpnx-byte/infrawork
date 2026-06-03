import { useEffect, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useUpdateNotifier } from '@/hooks/useUpdateNotifier'
import { SystemTitleBar } from '@/components/layout/SystemTitleBar'
import { LoginPage } from './routes/LoginPage'

export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const status = useAuthStore((s) => s.status)
  const bootstrap = useAuthStore((s) => s.bootstrap)

  useUpdateNotifier()

  useEffect(() => {
    if (status === 'idle') void bootstrap()
  }, [status, bootstrap])

  if (status === 'idle' || status === 'loading') {
    return (
      <>
        <SystemTitleBar />
        <div className="flex items-center justify-center h-screen bg-bg">
          <div className="text-text-muted text-sm font-mono">Carregando…</div>
        </div>
      </>
    )
  }

  if (status === 'guest') {
    return (
      <>
        <SystemTitleBar />
        <LoginPage />
      </>
    )
  }

  return <>{children}</>
}
