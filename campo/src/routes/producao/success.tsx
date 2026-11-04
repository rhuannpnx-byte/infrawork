import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import type { PushSummary } from '@/core/sync/producaoSync'

interface State {
  savedCount?: number
  pushResult?: PushSummary | null
}

/**
 * Tela de sucesso após finalizar uma sessão (replica `SuccessScreen.kt`).
 *
 * Exibe contagem gravada + status da sincronização imediata:
 *  - se aceito tudo: "Sincronizado"
 *  - se push falhou (rede): "Aguardando sincronização"
 *  - se backend rejeitou alguns: lista os motivos
 */
export function ProducaoSuccessRoute() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as State

  if (!authed) return <Navigate to="/login" replace />

  const saved = state.savedCount ?? 0
  const push = state.pushResult

  let statusLabel: string
  let statusTone: 'ok' | 'warn' | 'bad'
  let statusDetail: string | null = null

  if (push == null) {
    statusLabel = 'Aguardando sincronização'
    statusTone = 'warn'
  } else if (push.networkError) {
    statusLabel = 'Sem conexão — fila pendente'
    statusTone = 'warn'
    statusDetail = push.networkError
  } else if (push.rejected > 0) {
    statusLabel = `${push.accepted} aceito(s), ${push.rejected} rejeitado(s) pelo servidor`
    statusTone = 'bad'
    statusDetail = push.reasons.join(', ')
  } else {
    statusLabel = 'Sincronizado com o servidor'
    statusTone = 'ok'
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-bg-base p-6">
      <div className="w-full max-w-md text-center">
        <CheckCircle2 className="mx-auto h-20 w-20 text-ok" />
        <h1 className="mt-4 text-2xl font-bold text-on-surface">Sessão gravada</h1>
        <p className="mt-2 text-on-surface-dim">{saved} apontamento(s) salvo(s) localmente.</p>

        <div
          className={
            statusTone === 'ok'
              ? 'mt-6 rounded-lg bg-ok/10 px-4 py-3 text-sm text-ok'
              : statusTone === 'warn'
                ? 'mt-6 rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn'
                : 'mt-6 rounded-lg bg-bad/10 px-4 py-3 text-sm text-bad'
          }
        >
          <p className="font-medium">{statusLabel}</p>
          {statusDetail && <p className="mt-1 text-xs opacity-80">{statusDetail}</p>}
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={() => navigate('/producao', { replace: true })}
          className="mt-8 w-full"
        >
          Ver sessões
        </Button>
      </div>
    </main>
  )
}
