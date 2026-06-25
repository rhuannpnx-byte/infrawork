import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { GrafoTab } from '@/features/documentacao/components/workspace/GrafoTab'

export function DocumentacaoGrafoPage(): ReactNode {
  return (
    <DocPage title="Grafo" subtitle="O contrato como nó central — consórcio, ARTs e eventos.">
      {({ dossie }) => <GrafoTab dossie={dossie} />}
    </DocPage>
  )
}
