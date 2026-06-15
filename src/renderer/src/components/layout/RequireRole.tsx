import { type ReactNode } from 'react'
import { EmptyState } from './EmptyState'
import { PageHeader } from './PageHeader'
import { useAuthStore } from '@/stores/auth-store'
import type { Role } from '@/types/auth'

/**
 * Gate de papel (defesa em profundidade) para rotas que não devem ser abertas
 * por determinados perfis mesmo via URL direta. A visibilidade no menu já é
 * controlada por `requiredRoles` em config/modules.ts; este guard impede o
 * acesso por deep-link.
 *
 * Uso: envolver o conteúdo da rota. Ex.: o Cliente não acessa Valor Agregado,
 * Alertas, Equipes nem Vínculo SIGA.
 */
export function RequireRole({
  allow,
  pageTitle,
  children
}: {
  allow: Role[]
  pageTitle?: string
  children: ReactNode
}): ReactNode {
  const role = useAuthStore((s) => s.profile?.role ?? null)

  if (!role || !allow.includes(role)) {
    return (
      <div className="flex flex-col h-full">
        {pageTitle ? <PageHeader title={pageTitle} /> : null}
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="shield"
            title="Sem permissão"
            description="Seu perfil não tem acesso a esta tela."
          />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
