import { useEffect, type ReactNode } from 'react'
import { useSearch } from '@tanstack/react-router'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { CronogramaPagina } from '@/features/cronograma/components/CronogramaPagina'
import { useCronogramaUi } from '@/features/cronograma/store'

export function PlanejamentoCronogramaPage(): ReactNode {
  return (
    <RequireObra pageTitle="Cronograma">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const search = useSearch({ strict: false }) as { plan?: string }
  const escolher = useCronogramaUi((s) => s.escolherPlano)
  // link direto para um plano (?plan=…): passa a ser o escolhido da obra
  const plan = typeof search.plan === 'string' ? search.plan : null
  useEffect(() => {
    if (plan) escolher(obraId, plan)
  }, [plan, obraId, escolher])
  return <CronogramaPagina obraId={obraId} obraNome={scope.obra?.nome ?? ''} />
}
