import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { PainelObra } from '@/features/painel/PainelObra'

/** Painel da obra: a situação da obra escolhida numa folha só (aberto pelo cartão da obra no Início). */
export function AcompanhamentoPainelPage(): ReactNode {
  return (
    <RequireObra pageTitle="Painel da obra">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const { obraId } = useCurrentScope()
  return <PainelObra obraId={obraId!} />
}
