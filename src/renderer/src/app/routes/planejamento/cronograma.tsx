import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { CronogramaShell } from '@/features/planejamento/components/gantt/CronogramaShell'

export function PlanejamentoCronogramaPage(): ReactNode {
  return (
    <RequireObra pageTitle="Cronograma">
      <CronogramaInner />
    </RequireObra>
  )
}

function CronogramaInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const obraNome = scope.obra?.nome ?? ''
  return <CronogramaShell obraId={obraId} obraNome={obraNome} />
}
