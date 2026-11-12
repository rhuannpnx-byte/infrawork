import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { EquipesEncarregados } from '@/features/planejamento/components/EquipesEncarregados'

export function AcompanhamentoEquipesPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Equipes & Encarregados">
      <RequireObra pageTitle="Equipes & Encarregados">
        <EquipesEncarregados />
      </RequireObra>
    </RequireRole>
  )
}
