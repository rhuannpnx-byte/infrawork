import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { ParametrizacaoPagina } from '@/features/planejamento/components/parametrizacao/ParametrizacaoPagina'

export function PlanejamentoParametrizacaoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Parametrização dos serviços">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  return <ParametrizacaoPagina obraId={scope.obraId!} obraNome={scope.obra?.nome ?? ''} />
}
