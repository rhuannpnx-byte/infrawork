import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { CalendariosPagina } from '@/features/cronograma/components/calendarios/CalendariosPagina'

export function PlanejamentoCalendarioPage(): ReactNode {
  return (
    <RequireObra pageTitle="Calendários">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  return <CalendariosPagina obraId={scope.obraId!} obraNome={scope.obra?.nome ?? ''} />
}
