import { useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table/DataTable'
import { useEmpresas } from '@/features/gerencial/hooks'
import { useAuthStore } from '@/stores/auth-store'
import { NewEmpresaDialog } from '@/features/gerencial/modals/NewEmpresaDialog'
import { formatDate } from '@/lib/format'
import type { Empresa } from '@/types/gerencial'

export function EmpresasPage(): ReactNode {
  const role = useAuthStore((s) => s.profile?.role)
  const { data: empresas = [], isLoading, error } = useEmpresas()
  const [openNew, setOpenNew] = useState(false)

  const columns = useMemo<ColumnDef<Empresa, unknown>[]>(
    () => [
      {
        accessorKey: 'nome',
        header: 'Razão social',
        cell: (info) => <span className="text-text font-medium">{String(info.getValue())}</span>,
        meta: { label: 'Razão social' }
      },
      {
        accessorKey: 'cnpj',
        header: 'CNPJ',
        cell: (info) => (
          <span className="font-mono text-text-muted">{(info.getValue() as string) ?? '—'}</span>
        ),
        meta: { label: 'CNPJ' },
        size: 180
      },
      {
        accessorKey: 'ativo',
        header: 'Status',
        cell: (info) =>
          (info.getValue() as boolean) ? (
            <Badge variant="success">ativa</Badge>
          ) : (
            <Badge>inativa</Badge>
          ),
        meta: { label: 'Status' },
        size: 100
      },
      {
        accessorKey: 'created_at',
        header: 'Criada em',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">{formatDate(info.getValue() as string)}</span>
        ),
        meta: { label: 'Criada em' },
        size: 130
      }
    ],
    []
  )

  if (role !== 'god') {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="Empresas" />
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="shield"
            title="Apenas para God"
            description="Somente o papel God tem permissão para gerenciar empresas."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Empresas"
        subtitle="Cadastro das empresas do sistema. Cada empresa é um tenant isolado."
        actions={
          <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
            <Plus size={11} /> Nova empresa
          </Button>
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {empresas.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="building-2"
            title="Nenhuma empresa cadastrada"
            description="Cadastre a primeira empresa para começar a usar o sistema."
            action={
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={11} /> Nova empresa
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          data={empresas}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar empresa…"
          emptyMessage="Nenhuma empresa encontrada"
        />
      )}

      <NewEmpresaDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  )
}
