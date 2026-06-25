import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { RepositorioTab } from '@/features/documentacao/components/workspace/RepositorioTab'

export function DocumentacaoRepositorioPage(): ReactNode {
  return (
    <DocPage
      title="Repositório"
      subtitle="Acervo da obra por categoria. Ingestão por pasta ou arrasto."
    >
      {({ dossie, obraId, abrirFonte }) => (
        <RepositorioTab obraId={obraId} documentos={dossie.documentos} abrirFonte={abrirFonte} />
      )}
    </DocPage>
  )
}
