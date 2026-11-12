import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { EquipesEncarregados } from '@/features/planejamento/components/EquipesEncarregados'

export function PlanejamentoEquipesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Equipes">
      <EquipesEncarregados />
    </RequireObra>
  )
}
