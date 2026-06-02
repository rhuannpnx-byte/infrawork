import { type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { CronogramaShell } from '@/features/planejamento/components/gantt/CronogramaShell'

export function PlanejamentoRevisaoDetalhePage(): ReactNode {
  return (
    <RequireObra pageTitle="Revisão">
      <RevisaoInner />
    </RequireObra>
  )
}

function RevisaoInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { id } = useParams({ from: '/planejamento/revisoes/$id' })
  return (
    <CronogramaShell
      obraId={obraId}
      obraNome={scope.obra?.nome ?? ''}
      forcedPlanejamentoId={id}
      forceReadOnly
    />
  )
}
