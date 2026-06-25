import { type ReactNode } from 'react'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { TemplateEditor } from '@/features/documentacao/components/workspace/TemplateEditor'
import { PerfilObraPanel } from '@/features/documentacao/components/workspace/PerfilObraPanel'

/** Página do Template de Extração. NÃO depende do dossiê (edita-se antes de ingerir). */
export function DocumentacaoTemplatePage(): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle="Template de extração">
      <RequireObra pageTitle="Template de extração">
        <Inner />
      </RequireObra>
    </RequireRole>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Template de extração"
        subtitle="Estrutura fixa de campos/perguntas que a IA extrai dos documentos — editável e copiável entre obras."
      />
      <div className="px-5 pt-3">
        <PerfilObraPanel obraId={obraId} />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <TemplateEditor obraId={obraId} />
      </div>
    </div>
  )
}
