import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import type { PushSummary } from '@/core/sync/fichaSync'

interface State {
  pushResult?: PushSummary | null
  viagens?: number
}

/** Ficha gravada: mostra se já foi ao servidor, se ficou na fila (sem sinal) ou se foi recusada. */
export function CarreteiroSuccessRoute() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as State
  if (!authed) return <Navigate to="/login" replace />
  const push = state.pushResult
  const [rotulo, tom] =
    push == null || push.networkError
      ? ['Sem conexão — a ficha fica na fila e sobe sozinha', 'warn']
      : push.rejected > 0
        ? ['Recusada pelo servidor — abra a ficha para ver o motivo', 'bad']
        : ['Enviada ao servidor', 'ok']
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-bg-base p-6">
      <div className="w-full max-w-md text-center">
        <CheckCircle2 className="mx-auto h-20 w-20 text-ok" />
        <h1 className="mt-4 text-2xl font-bold text-on-surface">Ficha gravada</h1>
        <p className="mt-2 text-on-surface-dim">
          {state.viagens ?? 0} viagem(ns) salva(s) no aparelho.
        </p>
        <div
          className={
            tom === 'ok'
              ? 'mt-6 rounded-lg bg-ok/10 px-4 py-3 text-sm text-ok'
              : tom === 'warn'
                ? 'mt-6 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn'
                : 'mt-6 rounded-lg bg-bad/10 px-4 py-3 text-sm text-bad'
          }
        >
          {rotulo}
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={() => navigate('/carreteiro', { replace: true })}
          className="mt-8 w-full"
        >
          Ver fichas
        </Button>
      </div>
    </main>
  )
}
