import type { ReactNode } from 'react'
import { RequireObra } from '@/components/layout/RequireObra'
import { LocaisPagina } from '@/features/planejamento/components/locais/LocaisPagina'

/** Rota /planejamento/trechos — a página Locais (eixos, áreas e quantidades por local). */
export function PlanejamentoTrechosPage(): ReactNode {
  return (
    <RequireObra pageTitle="Locais">
      <LocaisPagina />
    </RequireObra>
  )
}
