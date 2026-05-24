import { type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Building2, Users, Folder, ArrowRight, Shield } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useEmpresas, useObras, useUsuarios } from '@/features/gerencial/hooks'
import { cn } from '@/lib/utils'

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
        <div className="grid grid-cols-3 gap-3">
          {isGod ? (
            <Card
              icon={<Building2 size={16} />}
              label="Empresas"
              value={empresas.length.toString()}
              hint="cadastradas"
              onClick={() => navigate({ to: '/gerencial/empresas' })}
            />
          ) : null}
          <Card
            icon={<Users size={16} />}
            label="Usuários"
            value={usuarios.length.toString()}
            hint={
              `${usuarios.filter((u) => u.role === 'adm').length} adm · ${usuarios.filter((u) => u.role === 'engenheiro').length} eng · ${usuarios.filter((u) => u.role === 'apoio').length} apoio`
            }
            onClick={() => navigate({ to: '/gerencial/usuarios' })}
          />
          {canSeeObras ? (
            <Card
              icon={<Folder size={16} />}
              label="Obras"
              value={obras.length.toString()}
              hint={isGod ? 'em todas as empresas' : 'na sua empresa'}
              onClick={() => navigate({ to: '/gerencial/obras' })}
            />
          ) : null}
        </div>

        <div className="rounded border border-border bg-bg-panel p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded bg-accent-glow flex items-center justify-center text-accent">
              <Shield size={14} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-text mb-1">Seu papel: {labelRole(profile?.role)}</h3>
              <p className="text-xs text-text-muted leading-relaxed">{descricaoRole(profile?.role)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Card({
  icon,
  label,
  value,
  hint,
  onClick
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group text-left rounded border border-border bg-bg-panel p-4 transition-colors',
        'hover:border-border-accent hover:bg-bg-hover'
      )}
    >
      <div className="flex items-center justify-between text-text-dim mb-2">
        <div className="flex items-center gap-2 text-2xs font-mono uppercase tracking-wider">
          {icon}
          {label}
        </div>
        <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="text-2xl font-semibold text-text font-mono">{value}</div>
      {hint ? <div className="text-2xs text-text-muted font-mono mt-1">{hint}</div> : null}
    </button>
  )
}

function labelRole(r: string | undefined): string {
  switch (r) {
    case 'god':
      return 'God (acesso global)'
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
      return 'Você pode criar empresas, qualquer tipo de usuário em qualquer empresa, obras em qualquer empresa e conceder/revogar acessos em qualquer obra.'
    case 'adm':
      return 'Você pode criar usuários (Adm, Engenheiro, Apoio) na sua empresa, criar obras na sua empresa e conceder/revogar acesso de Engenheiros às obras.'
    case 'engenheiro':
      return 'Você pode criar usuários do tipo Apoio vinculados a você. O acesso às obras é concedido pelo Adm da sua empresa.'
    case 'apoio':
      return 'Suas obras são herdadas do Engenheiro a quem você está vinculado. Não há ações administrativas neste nível.'
    default:
      return ''
  }
}
