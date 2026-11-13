import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { FaixaIndicadores, Indicador } from '@/components/ui/indicador'
import { useAuthStore } from '@/stores/auth-store'
import { useEmpresas, useObras, useUsuarios } from '@/features/gerencial/hooks'
import { contar } from '@/lib/rotulos'

export function GerencialIndex(): ReactNode {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const empresa = useAuthStore((s) => s.empresa)

  const isGod = profile?.role === 'god'
  const canSeeObras = profile?.role === 'god' || profile?.role === 'adm'

  const { data: empresas = [] } = useEmpresas()
  const { data: usuarios = [] } = useUsuarios()
  const { data: obras = [] } = useObras()

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Gerencial"
        subtitle={
          isGod
            ? 'Administração de empresas, usuários e obras do sistema.'
            : empresa
              ? `Administração de ${empresa.nome}.`
              : 'Sua conta está sem empresa atribuída.'
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <FaixaIndicadores rotulo="Cadastros">
          {isGod ? (
            <Indicador
              rotulo="Empresas"
              valor={empresas.length.toLocaleString('pt-BR')}
              aoClicar={() => void navigate({ to: '/gerencial/empresas' })}
            >
              <span>cadastradas</span>
            </Indicador>
          ) : null}
          <Indicador
            rotulo="Usuários"
            valor={usuarios.length.toLocaleString('pt-BR')}
            aoClicar={() => void navigate({ to: '/gerencial/usuarios' })}
          >
            <span>
              {contar(
                usuarios.filter((u) => u.role === 'adm').length,
                'administrador',
                'administradores'
              )}{' '}
              ·{' '}
              {contar(
                usuarios.filter((u) => u.role === 'engenheiro').length,
                'engenheiro',
                'engenheiros'
              )}{' '}
              · {usuarios.filter((u) => u.role === 'apoio').length} de apoio
            </span>
          </Indicador>
          {canSeeObras ? (
            <Indicador
              rotulo="Obras"
              valor={obras.length.toLocaleString('pt-BR')}
              aoClicar={() => void navigate({ to: '/gerencial/obras' })}
            >
              <span>{isGod ? 'em todas as empresas' : 'na sua empresa'}</span>
            </Indicador>
          ) : null}
        </FaixaIndicadores>

        <div className="rounded border border-border bg-bg-panel p-4">
          <h2 className="text-lg font-semibold text-text mb-1">
            Seu papel: {labelRole(profile?.role)}
          </h2>
          <p className="text-sm text-text-muted max-w-[75ch]">{descricaoRole(profile?.role)}</p>
        </div>
      </div>
    </div>
  )
}

function labelRole(r: string | undefined): string {
  switch (r) {
    case 'god':
      return 'Administrador geral (todas as empresas)'
    case 'adm':
      return 'Administrador da empresa'
    case 'engenheiro':
      return 'Engenheiro'
    case 'apoio':
      return 'Apoio'
    default:
      return '—'
  }
}

function descricaoRole(r: string | undefined): string {
  switch (r) {
    case 'god':
      return 'Você pode criar empresas, usuários de qualquer papel e obras em qualquer empresa, e conceder ou revogar o acesso a qualquer obra.'
    case 'adm':
      return 'Você pode criar usuários (administrador, engenheiro e apoio) e obras na sua empresa, e conceder ou revogar o acesso dos engenheiros às obras.'
    case 'engenheiro':
      return 'Você pode criar usuários de apoio vinculados a você. O acesso às obras é concedido pelo administrador da sua empresa.'
    case 'apoio':
      return 'Você vê as obras do engenheiro a quem está vinculado. Este papel não tem ações administrativas.'
    default:
      return ''
  }
}
