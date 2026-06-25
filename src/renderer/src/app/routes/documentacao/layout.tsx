import { type ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'
import { VisualizadorModal } from '@/features/documentacao/components/workspace/VisualizadorModal'

/** Casca do módulo Documentação: renderiza a rota ativa e monta uma única vez o
 * Visualizador (modal global), que abre a qualquer tempo via documentacao-ui-store. */
export function DocumentacaoLayout(): ReactNode {
  return (
    <>
      <Outlet />
      <VisualizadorModal />
    </>
  )
}
