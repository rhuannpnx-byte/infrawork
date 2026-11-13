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
  // O motivo vem do banco; o travessão vira vírgula e o ponto final não se repete.
  const motivo = trava
    .replace(/\s+[—–]\s+/g, ', ')
    .trim()
    .replace(/\.$/, '')
  return (
    <div
      role="status"
      className="mx-5 mt-3 flex flex-wrap items-start gap-x-3 gap-y-1 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-text"
    >
      <Lock size={14} aria-hidden className="mt-0.5 shrink-0 text-warn" />
      <span className="min-w-0 flex-1 basis-64">
        <strong className="font-semibold">Somente leitura:</strong> {motivo}.
      </span>
      <button
        type="button"
        className="shrink-0 rounded font-semibold text-accent underline underline-offset-2 hover:text-accent-hover hover:no-underline"
        onClick={() => navigate({ to: '/planejamento/cronograma' })}
      >
        Ver linhas de base no cronograma
      </button>
    </div>
  )
}
