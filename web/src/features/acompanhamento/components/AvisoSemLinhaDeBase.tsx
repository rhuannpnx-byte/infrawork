import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { useBaseline } from '@/features/planejamento/hooks'

/**
 * O previsto (curva-S, previsto × realizado, avanço, alertas de prazo) vem só da linha de base vigente. Sem ela as
 * telas mostravam séries vazias sem explicar o motivo; aqui o aviso aponta onde resolver.
 */
export function AvisoSemLinhaDeBase({ obraId }: { obraId: string }): ReactNode {
  const navigate = useNavigate()
  const { data: lb, isLoading } = useBaseline(obraId)
  if (isLoading || (lb && !lb.provisoria)) return null
  return (
    <div className="mx-5 mt-3 flex items-center gap-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {lb
          ? `Sem linha de base vigente (replanejamento em andamento): o previsto usa "${lb.nome}" como referência provisória.`
          : 'Sem linha de base vigente: o previsto, o avanço e os alertas de prazo ficam vazios até um plano ser travado como linha de base e tornado vigente.'}
      </span>
      <button
        type="button"
        onClick={() => void navigate({ to: '/planejamento/cronograma' })}
        className="shrink-0 rounded border border-warn/50 px-2 py-1 font-medium hover:bg-warn/15"
      >
        Abrir o cronograma
      </button>
    </div>
  )
}
