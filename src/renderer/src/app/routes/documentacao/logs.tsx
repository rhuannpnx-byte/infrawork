import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { LogsTab } from '@/features/documentacao/components/workspace/LogsTab'

export function DocumentacaoLogsPage(): ReactNode {
  return (
    <DocPage
      title="Logs & Diagnóstico"
      subtitle="Validador de consistência, campos a conferir e meta técnica do dossiê."
    >
      {({ dossie, abrirFonte }) => <LogsTab dossie={dossie} onAbrirFonte={abrirFonte} />}
    </DocPage>
  )
}
