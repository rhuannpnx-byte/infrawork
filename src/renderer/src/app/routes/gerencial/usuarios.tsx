import { useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { useUsuarios } from '@/features/gerencial/hooks'
import { useAuthStore } from '@/stores/auth-store'
import { NewUsuarioDialog } from '@/features/gerencial/modals/NewUsuarioDialog'
import { formatDate } from '@/lib/format'
import type { Role } from '@/types/auth'
import type { UsuarioComEmpresa } from '@/types/gerencial'

const ROLE_VARIANT: Record<Role, 'accent' | 'success' | 'warn' | 'default'> = {
  god: 'accent',
  adm: 'warn',
  engenheiro: 'success',
  apoio: 'default'
}

export function UsuariosPage(): ReactNode {
  const role = useAuthStore((s) => s.profile?.role)
  const { data: usuarios = [], isLoading, error } = useUsuarios()
  const [openNew, setOpenNew] = useState(false)

  const podeAcessar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const columns = useMemo<ColumnDef<UsuarioComEmpresa, unknown>[]>(
    () => [
      {
        accessorKey: 'nome',
        header: 'Nome',
        cell: (info) => <span className="text-text font-medium">{String(info.getValue())}</span>,
        meta: { label: 'Nome' }
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: (info) => <span className="font-mono text-text-muted">{String(info.getValue())}</span>,
        meta: { label: 'Email' }
      },
      {
        accessorKey: 'role',
        header: 'Papel',
        cell: (info) => {
          const r = info.getValue() as Role
          return <Badge variant={ROLE_VARIANT[r]}>{r}</Badge>
        },
        meta: { label: 'Papel' },
        size: 110
      },
      {
        id: 'empresa',
        header: 'Empresa',
        accessorFn: (row) => row.empresa?.nome ?? '—',
        cell: (info) => <span className="text-text-muted">{String(info.getValue())}</span>,
        meta: { label: 'Empresa' }
      },
      {
        id: 'engenheiro',
        header: 'Eng. responsável',
        accessorFn: (row) => row.engenheiro?.nome ?? (row.role === 'apoio' ? '—' : ''),
        cell: (info) => {
          const v = String(info.getValue() ?? '')
          return v ? <span className="text-text-muted">{v}</span> : <span className="text-text-faint">—</span>
        },
        meta: { label: 'Engenheiro' }
      },
      {
        accessorKey: 'ativo',
        header: 'Status',
        cell: (info) =>
          (info.getValue() as boolean) ? (
            <Badge variant="success">ativo</Badge>
          ) : (
            <Badge>inativo</Badge>
          ),
        meta: { label: 'Status' },
        size: 90
      },
      {
        accessorKey: 'created_at',
        header: 'Criado em',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">{formatDate(info.getValue() as string)}</span>
        ),
        meta: { label: 'Criado em' },
        size: 110
      }
    ],
    []
  )

  if (!podeAcessar) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Usuários" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="shield"
            title="Sem permissão"
            description="Você não tem permissão para gerenciar usuários."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Usuários"
        subtitle={
          role === 'god'
            ? 'Todos os usuários do sistema.'
            : role === 'engenheiro'
              ? 'Usuários da sua empresa. Você só pode criar Apoios vinculados a si.'
              : 'Usuários da sua empresa.'
        }
        actions={
          <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
            <Plus size={11} /> Novo usuário
          </Button>
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {usuarios.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="users"
            title="Nenhum usuário"
            description={
              role === 'engenheiro'
                ? 'Você ainda não cadastrou nenhum Apoio.'
                : 'Cadastre o primeiro usuário.'
            }
            action={
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={11} /> Novo usuário
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          data={usuarios}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar por nome ou email…"
          emptyMessage="Nenhum usuário encontrado"
        />
      )}

      <NewUsuarioDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  )
}
