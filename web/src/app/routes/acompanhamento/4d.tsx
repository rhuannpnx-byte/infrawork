import { type ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { RequireRole } from '@/components/layout/RequireRole'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { Pagina4D } from '@/features/modelo4d/components/Pagina4D'

export function Acompanhamento4DPage(): ReactNode {
  return (
    <RequireRole allow={['god', 'adm', 'engenheiro', 'apoio']} pageTitle="Acompanhamento 4D">
      <RequireObra pageTitle="Acompanhamento 4D">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obra = scope.obra
  return (
    <Pagina4D obraId={scope.obraId!} obraRotulo={obra ? `${obra.codigo} · ${obra.nome}` : 'Obra'} />
  )
}
