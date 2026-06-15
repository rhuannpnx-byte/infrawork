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
import { formatDate, formatDateTimeShort, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Role } from '@/types/auth'
import type { UsuarioComEmpresa } from '@/types/gerencial'

const ROLE_VARIANT: Record<Role, 'accent' | 'success' | 'warn' | 'default'> = {
  god: 'accent',
  adm: 'warn',
  engenheiro: 'success',
  apoio: 'default',
  cliente: 'default'
}

/** "Online agora" = visto nos últimos 2,5 min (heartbeat roda a cada 60s). */
const ONLINE_THRESHOLD_MS = 150_000

function estaOnline(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false
  const t = new Date(lastSeen).getTime()
  return Number.isFinite(t) && Date.now() - t < ONLINE_THRESHOLD_MS
}

export function UsuariosPage(): ReactNode {
  const role = useAuthStore((s) => s.profile?.role)
  const ehGod = role === 'god'
  // Só God vê acesso/presença; refetch periódico mantém "Online" atualizado.
  const { data: usuarios = [], isLoading, error } = useUsuarios(
    ehGod ? { refetchInterval: 45_000 } : undefined
  )
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
      ...(ehGod
        ? ([
            {
              id: 'online',
              header: 'Online',
              accessorFn: (row) => row.last_seen_at ?? '',
              cell: (info) => {
                const lastSeen = info.row.original.last_seen_at
                if (estaOnline(lastSeen)) {
                  return (
                    <span className="inline-flex items-center gap-1.5 text-2xs font-mono text-success">
                      <span className="size-2 rounded-full bg-success animate-pulse" />
                      online
                    </span>
                  )
                }
                return (
                  <span className="text-2xs font-mono text-text-faint" title={lastSeen ? formatDateTimeShort(lastSeen) : undefined}>
                    {lastSeen ? timeAgo(lastSeen) : '—'}
                  </span>
                )
              },
              meta: { label: 'Online' },
              size: 110
            },
            {
              accessorKey: 'acessos_count',
              header: 'Acessos',
              cell: (info) => (
                <span className="font-mono tabular-nums text-text-muted">
                  {Number(info.getValue() ?? 0)}
                </span>
              ),
              meta: { label: 'Acessos' },
              size: 80
            },
            {
              accessorKey: 'last_access_at',
              header: 'Último acesso',
              cell: (info) => {
                const v = info.getValue() as string | null
                return (
                  <span className={cn('font-mono text-2xs', v ? 'text-text-dim' : 'text-text-faint')}>
                    {v ? formatDateTimeShort(v) : '—'}
                  </span>
                )
              },
              meta: { label: 'Último acesso' },
              size: 140
            }
          ] as ColumnDef<UsuarioComEmpresa, unknown>[])
        : []),
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
    [ehGod]
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
