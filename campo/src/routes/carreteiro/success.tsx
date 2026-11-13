import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { useIsAuthenticated } from '@/core/auth/SessionStore'
import { db } from '@/core/db/dexie'
import type { SyncStatus } from '@/core/db/entities'
import type { PushSummary } from '@/core/sync/fichaSync'
import { useCarreteiroStore } from '@/features/carreteiro/carreteiroStore'
import { SeloEnvio } from '@/features/common/SyncStatusIndicator'
import { ROTULO_ENVIO, TOM_ENVIO } from '@/features/common/rotulosEnvio'
import { cn } from '@/lib/cn'
import { contar, plural } from '@/lib/texto'

interface State {
  fichaId?: string
  pushResult?: PushSummary | null
  viagens?: number
}

/** Sem a ficha no banco local (tela aberta por um link antigo), vale o resultado do envio feito ao gravar. */
function situacaoDoEnvio(push: PushSummary | null | undefined): SyncStatus {
  if (push == null || push.networkError) return 'PENDING'
  return push.rejected > 0 ? 'REJEITADA' : 'SYNCED'
}

/**
 * Ficha gravada: a tela mostra a situação real do envio, lida da ficha no aparelho (enviada, aguardando rede ou
 * recusada com o motivo) e acompanha se ela mudar enquanto a tela está aberta.
 */
export function CarreteiroSuccessRoute() {
  const authed = useIsAuthenticated()
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as State
  const ficha = useLiveQuery(
    async () => (state.fichaId ? ((await db.out_ficha.get(state.fichaId)) ?? null) : null),
    [state.fichaId],
  )
  if (!authed) return <Navigate to="/login" replace />
  // ainda lendo a ficha: não mostra uma situação que pode estar errada
  if (ficha === undefined) return <main className="min-h-svh bg-bg-base" />

  const status: SyncStatus = ficha?.syncStatus ?? situacaoDoEnvio(state.pushResult)
  const tom = ROTULO_ENVIO[status].tom
  const n = ficha?.viagens.length ?? state.viagens ?? 0
  const viagens = `${contar(n, 'viagem', 'viagens')} ${plural(n, 'salva', 'salvas')} no aparelho.`

  const [Icone, titulo, texto] =
    status === 'SYNCED'
      ? [CheckCircle2, 'Ficha enviada', `${viagens} O escritório já recebeu a ficha.`]
      : status === 'REJEITADA'
        ? [
            AlertCircle,
            'Ficha recusada',
            `${viagens} O servidor não aceitou a ficha. Corrija e grave de novo.`,
          ]
        : status === 'FAILED'
          ? [
              AlertCircle,
              'Ficha gravada, envio com erro',
              `${viagens} O app tenta enviar de novo sozinho.`,
            ]
          : [
              Clock,
              'Ficha gravada no aparelho',
              `${viagens} Ainda não foi enviada: sai sozinha quando a rede voltar.`,
            ]

  function corrigir() {
    if (!ficha) return
    useCarreteiroStore.getState().abrir(ficha)
    navigate('/carreteiro/step1', { replace: true })
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-bg-base p-6">
      <div className="w-full max-w-md text-center" data-testid="ficha-situacao" data-status={status}>
        <Icone className={cn('mx-auto h-20 w-20', TOM_ENVIO[tom].texto)} aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold text-on-surface">{titulo}</h1>
        <div className="mt-3 flex justify-center">
          <SeloEnvio status={status} />
        </div>
        <p className="mt-3 text-sm text-on-surface-dim">{texto}</p>
        {(status === 'REJEITADA' || status === 'FAILED') && ficha?.failureReason && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-left text-sm text-on-surface"
          >
            <span className="rotulo block text-bad">Motivo</span>
            {ficha.failureReason}
          </p>
        )}
        {status === 'REJEITADA' && ficha && (
          <Button variant="primary" size="lg" onClick={corrigir} className="mt-8 w-full">
            Corrigir a ficha
          </Button>
        )}
        <Button
          variant={status === 'REJEITADA' && ficha ? 'outline' : 'primary'}
          size="lg"
          onClick={() => navigate('/carreteiro', { replace: true })}
          className={cn('w-full', status === 'REJEITADA' && ficha ? 'mt-3' : 'mt-8')}
        >
          Ver fichas
        </Button>
      </div>
    </main>
  )
}
