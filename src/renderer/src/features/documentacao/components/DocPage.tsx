import { type ReactNode } from 'react'
import { RequireRole } from '@/components/layout/RequireRole'
import { RequireObra } from '@/components/layout/RequireObra'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useDossie } from '@/features/documentacao/hooks/dossie'
import { useDocumentacaoUIStore } from '@/stores/documentacao-ui-store'
import type { ObraDossier } from '@/types/documentacao'

export type AbrirFonte = (docId: string | null, pagina: number | null) => void

interface Props {
  title: string
  subtitle?: string
  /** Render-prop com o dossiê pronto. `abrirFonte` navega ao Visualizador. */
  children: (ctx: { dossie: ObraDossier; obraId: string; abrirFonte: AbrirFonte }) => ReactNode
}

/**
 * Casca comum das páginas do módulo Documentação: guarda de papel/obra, header,
 * carregamento do ObraDossier e navegação ao Visualizador (abrirFonte). Mantém
 * as páginas finas e consistentes com os demais módulos (uma view por rota).
 */
export function DocPage({ title, subtitle, children }: Props): ReactNode {
  return (
    <RequireRole allow={['god']} pageTitle={title}>
      <RequireObra pageTitle={title}>
        <Inner title={title} subtitle={subtitle}>
          {children}
        </Inner>
      </RequireObra>
    </RequireRole>
  )
}

function Inner({ title, subtitle, children }: Props): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: dossie, isLoading, isError } = useDossie(obraId)
  const abrir = useDocumentacaoUIStore((s) => s.abrir)

  // Abre o Visualizador como modal global (sobe por cima da página atual).
  const abrirFonte: AbrirFonte = (docId, pagina) => abrir(docId, pagina)

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-2xs font-mono text-text-dim">
            Montando o dossiê da obra…
          </div>
        ) : isError || !dossie ? (
          <EmptyState
            icon="alert-triangle"
            title="Não foi possível montar o dossiê"
            description="Ingira documentos no Repositório ou tente novamente."
          />
        ) : (
          children({ dossie, obraId, abrirFonte })
        )}
      </div>
    </div>
  )
}
