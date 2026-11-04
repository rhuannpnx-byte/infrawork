import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { RecursosPagina } from '@/features/cronograma/components/recursos/RecursosPagina'

export function PlanejamentoRecursosPage(): ReactNode {
  return (
    <RequireObra pageTitle="Recursos">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  return <RecursosPagina obraId={scope.obraId!} obraNome={scope.obra?.nome ?? ''} />
}
