import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBaseline } from '@/features/planejamento/hooks'
import { useAuthStore } from '@/stores/auth-store'

/**
 * O previsto (curva-S, previsto × realizado, avanço, alertas de prazo) vem só da linha de base vigente. Sem ela as
 * telas mostravam séries vazias sem explicar o motivo; aqui o aviso aponta onde resolver.
 */
export function AvisoSemLinhaDeBase({ obraId }: { obraId: string }): ReactNode {
  const navigate = useNavigate()
  const { data: lb, isLoading, error } = useBaseline(obraId)
  const podePlanejar = useAuthStore((s) => !!s.profile && s.profile.role !== 'cliente')
  // o cliente não lê os planos: para ele a consulta vem vazia mesmo com linha de base vigente
  if (!podePlanejar || isLoading || error || (lb && !lb.provisoria)) return null
  return (
    <div
      role="status"
      className="mx-5 mt-3 flex flex-wrap items-center gap-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text"
    >
      <AlertTriangle size={15} className="shrink-0 text-warn" />
      <span className="min-w-0 flex-1">
        {lb
          ? `Sem linha de base vigente (replanejamento em andamento): o previsto usa "${lb.nome}" como referência provisória.`
          : 'Sem linha de base vigente: o previsto, o avanço e os alertas de prazo ficam vazios até um plano ser travado como linha de base e tornado vigente.'}
      </span>
      {podePlanejar ? (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => void navigate({ to: '/planejamento/cronograma' })}
        >
          Abrir o cronograma
        </Button>
      ) : null}
    </div>
  )
}
