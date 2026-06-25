import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { RaioXTab } from '@/features/documentacao/components/workspace/RaioXTab'

export function DocumentacaoIndex(): ReactNode {
  return (
    <DocPage
      title="Raio-X da obra"
      subtitle="Dossiê com proveniência, alimentado pelo agente de ingestão (DeepSeek + Qwen-VL)."
    >
      {({ dossie, obraId }) => <RaioXTab dossie={dossie} obraId={obraId} />}
    </DocPage>
  )
}
