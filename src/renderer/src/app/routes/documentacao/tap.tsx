import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { TapTab } from '@/features/documentacao/components/workspace/TapTab'

export function DocumentacaoTapPage(): ReactNode {
  return (
    <DocPage
      title="Emitir TAP"
      subtitle="Termo de Abertura do Projeto — bloco documental preenchido pelo Raio-X; campos manuais editáveis."
    >
      {({ dossie, obraId }) => <TapTab dossie={dossie} obraId={obraId} />}
    </DocPage>
  )
}
