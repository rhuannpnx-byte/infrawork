import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { TimelineTab } from '@/features/documentacao/components/workspace/TimelineTab'

export function DocumentacaoTimelinePage(): ReactNode {
  return (
    <DocPage title="Timeline" subtitle="Linha do tempo dos marcos documentais da obra.">
      {({ dossie, abrirFonte }) => <TimelineTab dossie={dossie} onAbrirFonte={abrirFonte} />}
    </DocPage>
  )
}
