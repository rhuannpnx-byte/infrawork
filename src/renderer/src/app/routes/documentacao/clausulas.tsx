import { type ReactNode } from 'react'
import { DocPage } from '@/features/documentacao/components/DocPage'
import { ClausulasTab } from '@/features/documentacao/components/workspace/ClausulasTab'

export function DocumentacaoClausulasPage(): ReactNode {
  return (
    <DocPage
      title="Cláusulas & Risco"
      subtitle="Cláusulas extraídas e sinalização de risco, com fonte."
    >
      {({ dossie, abrirFonte }) => <ClausulasTab dossie={dossie} onAbrirFonte={abrirFonte} />}
    </DocPage>
  )
}
