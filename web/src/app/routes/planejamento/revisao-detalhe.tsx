import { useEffect, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { CronogramaPagina } from '@/features/cronograma/components/CronogramaPagina'
import { useCronogramaUi } from '@/features/cronograma/store'

export function PlanejamentoRevisaoDetalhePage(): ReactNode {
  return (
    <RequireObra pageTitle="Plano">
      <RevisaoInner />
    </RequireObra>
  )
}

function RevisaoInner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { id } = useParams({ from: '/planejamento/revisoes/$id' })
  const escolher = useCronogramaUi((s) => s.escolherPlano)
  useEffect(() => escolher(obraId, id), [escolher, obraId, id])
  return <CronogramaPagina obraId={obraId} obraNome={scope.obra?.nome ?? ''} />
}
