import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { TempoCaminhoPagina } from '@/features/cronograma/components/tempo-caminho/TempoCaminhoPagina'

export function PlanejamentoTempoCaminhoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Tempo-caminho">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  return <TempoCaminhoPagina obraId={scope.obraId!} />
}
