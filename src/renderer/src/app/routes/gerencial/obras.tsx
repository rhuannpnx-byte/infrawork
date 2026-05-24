import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { useObras } from '@/features/gerencial/hooks'
import { useAuthStore } from '@/stores/auth-store'
import { NewObraDialog } from '@/features/gerencial/modals/NewObraDialog'
import { formatDate } from '@/lib/format'
import type { ObraComEmpresa } from '@/types/gerencial'

export function ObrasPage(): ReactNode {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const { data: obras = [], isLoading, error } = useObras()
  const [openNew, setOpenNew] = useState(false)

  const podeAcessar = role === 'god' || role === 'adm'

  const columns = useMemo<ColumnDef<ObraComEmpresa, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        cell: (info) => <span className="font-mono text-accent">{String(info.getValue())}</span>,
        meta: { label: 'Código' },
        size: 130
      },
      {
        accessorKey: 'nome',
        header: 'Nome',
        cell: (info) => <span className="text-text font-medium">{String(info.getValue())}</span>,
        meta: { label: 'Nome' }
      },
      {
        id: 'empresa',
        header: 'Empresa',
        accessorFn: (row) => row.empresa?.nome ?? '—',
        cell: (info) => <span className="text-text-muted">{String(info.getValue())}</span>,
        meta: { label: 'Empresa' }
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (info) => {
          const v = String(info.getValue())
          const variant =
            v === 'concluido' ? 'success' : v === 'paralisado' ? 'warn' : v === 'em_andamento' ? 'accent' : 'default'
          return <Badge variant={variant as 'success' | 'warn' | 'accent' | 'default'}>{v.replace('_', ' ')}</Badge>
        },
        meta: { label: 'Status' },
        size: 130
      },
      {
        accessorKey: 'created_at',
        header: 'Criada em',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">{formatDate(info.getValue() as string)}</span>
        ),
        meta: { label: 'Criada em' },
        size: 110
      }
    ],
    []
  )

  if (!podeAcessar) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Obras" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="shield"
            title="Sem permissão"
            description="Você não tem permissão para gerenciar obras."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Obras"
        subtitle={
          role === 'god' ? 'Obras de todas as empresas.' : 'Obras da sua empresa. Clique em uma obra para gerenciar permissões.'
        }
        actions={
          <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
            <Plus size={11} /> Nova obra
          </Button>
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {obras.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="folder"
            title="Nenhuma obra cadastrada"
            description="Cadastre a primeira obra para começar a alocar engenheiros."
            action={
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={11} /> Nova obra
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          data={obras}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar por código ou nome…"
          emptyMessage="Nenhuma obra encontrada"
          onRowClick={(row) => navigate({ to: `/gerencial/obras/${row.id}` })}
        />
      )}

      <NewObraDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  )
}
