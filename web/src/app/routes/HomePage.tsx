import { type ReactNode } from 'react'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { PainelObra } from '@/features/painel/PainelObra'
import { InicioSemObra } from '@/features/painel/InicioSemObra'

/** Início: o painel da obra em uso; sem obra, as obras da empresa e o que pede atenção nelas. */
export function HomePage(): ReactNode {
  const { obra } = useCurrentScope()
  return obra ? <PainelObra obraId={obra.id} /> : <InicioSemObra />
}
