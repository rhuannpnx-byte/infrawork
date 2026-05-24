import { type ReactNode } from 'react'
import { Building2, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from './EmptyState'
import { PageHeader } from './PageHeader'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useUIStore } from '@/stores/ui-store'

/**
 * Gate para módulos operacionais que **exigem** uma obra selecionada — todos
 * os dados criados nesses módulos pertencem a uma obra específica (composições,
 * tarefas, medições, etc.).
 *
 * Comportamento:
 *   - God sem empresa: pede pra selecionar empresa primeiro.
 *   - God com empresa mas sem obra: pede obra.
 *   - Adm/Eng/Apoio sem obra: pede obra (empresa é fixa).
 *   - Com obra ativa: renderiza children.
 */
export function RequireObra({
  pageTitle,
  children
}: {
  pageTitle?: string
  children: ReactNode
}): ReactNode {
  const scope = useCurrentScope()
  const openModal = useUIStore((s) => s.openModal)

  if (scope.precisaSelecionarEmpresa) {
    return (
      <div className="flex flex-col h-full">
        {pageTitle ? <PageHeader title={pageTitle} /> : null}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="building-2"
            title="Selecione uma empresa para começar"
            description="Como God, você precisa escolher uma empresa antes de operar em qualquer módulo."
            action={
              <Button variant="default" size="sm" onClick={() => openModal('projectSwitcher')}>
                <Building2 size={11} /> Selecionar empresa
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  if (scope.precisaSelecionarObra) {
    return (
      <div className="flex flex-col h-full">
        {pageTitle ? <PageHeader title={pageTitle} /> : null}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="folder-open"
            title="Selecione uma obra para continuar"
            description="Este módulo opera dentro do escopo de uma obra — todos os dados aqui são herméticos por obra. Escolha uma para liberar a tela."
            action={
              <Button variant="default" size="sm" onClick={() => openModal('projectSwitcher')}>
                <FolderOpen size={11} /> Selecionar obra
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
