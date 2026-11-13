import { useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ErroConsulta } from '@/components/ui/estado'
import { DataTable } from '@/components/data-table/DataTable'
import { useEmpresas } from '@/features/gerencial/hooks'
import { useAuthStore } from '@/stores/auth-store'
import { NewEmpresaDialog } from '@/features/gerencial/modals/NewEmpresaDialog'
import { formatDate } from '@/lib/format'
import type { Empresa } from '@/types/gerencial'

export function EmpresasPage(): ReactNode {
  const role = useAuthStore((s) => s.profile?.role)
  const { data: empresas = [], isLoading, error, refetch } = useEmpresas()
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
          <span className="tabular text-text-muted">{(info.getValue() as string) ?? '—'}</span>
        ),
        meta: { label: 'CNPJ' },
        size: 180
      },
      {
        // o valor da coluna é o rótulo, para a busca e a exportação
        id: 'ativo',
        header: 'Situação',
        accessorFn: (row) => (row.ativo ? 'Ativa' : 'Inativa'),
        cell: ({ row }) =>
          row.original.ativo ? <Badge variant="success">Ativa</Badge> : <Badge>Inativa</Badge>,
        meta: { label: 'Situação' },
        size: 100
      },
      {
        accessorKey: 'created_at',
        header: 'Criada em',
        cell: (info) => (
          <span className="tabular text-text-muted">{formatDate(info.getValue() as string)}</span>
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
            title="Sem permissão"
            description="Só o administrador geral cadastra e gerencia empresas."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Empresas"
        subtitle="Cada empresa tem os seus dados separados das demais."
        actions={
          <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
            <Plus size={12} /> Nova empresa
          </Button>
        }
      />
      {error ? (
        <ErroConsulta
          erro={error}
          oQue="as empresas"
          aoTentar={() => void refetch()}
          className="mx-3 my-2"
        />
      ) : null}
      {error && empresas.length === 0 ? null : empresas.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="building-2"
            title="Nenhuma empresa cadastrada"
            description="Cadastre a primeira empresa para começar a usar o sistema."
            action={
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={12} /> Nova empresa
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          exportTitulo="Empresas"
          data={empresas}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar empresa…"
          emptyMessage="Nenhuma empresa encontrada com essa busca."
        />
      )}

      <NewEmpresaDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  )
}
