import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useCadeiaTrava } from '@/features/planejamento/hooks/planejamentos'

/**
 * Aviso de cadeia travada (orçamento, composições, recursos, indiretos): há
 * plano vigente, ou só linhas de base sem plano em edição.
 */
export function CadeiaTravaBanner({ obraId }: { obraId: string }): ReactNode {
  const { data: trava } = useCadeiaTrava(obraId)
  const navigate = useNavigate()
  if (!trava) return null
  return (
    <div className="mx-5 mt-3 flex items-start gap-2 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
      <Lock size={13} className="mt-px shrink-0" />
      <span className="flex-1">
        <strong>Somente leitura:</strong> {trava}.
      </span>
      <button
        type="button"
        className="shrink-0 underline hover:no-underline"
        onClick={() => navigate({ to: '/planejamento/cronograma' })}
      >
        Linhas de base no cronograma
      </button>
    </div>
  )
}
