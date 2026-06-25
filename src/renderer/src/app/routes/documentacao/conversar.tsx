import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { ConversarTab } from '@/features/documentacao/components/workspace/ConversarTab'

export function DocumentacaoConversarPage(): ReactNode {
  return (
    <DocPage
      title="Conversar"
      subtitle="Pergunte ao acervo — respostas com citação das fontes (RAG)."
    >
      {({ obraId, abrirFonte }) => <ConversarTab obraId={obraId} onAbrirFonte={abrirFonte} />}
    </DocPage>
  )
}
