import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ErroConsulta } from '@/components/ui/estado'
import { DataTable } from '@/components/data-table/DataTable'
import { useObras } from '@/features/gerencial/hooks'
import { useAuthStore } from '@/stores/auth-store'
import { NewObraDialog } from '@/features/gerencial/modals/NewObraDialog'
import { rotuloStatusObra } from '@/features/gerencial/lib/status-obra'
import { formatDate } from '@/lib/format'
import type { ObraComEmpresa } from '@/types/gerencial'

export function ObrasPage(): ReactNode {
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const { data: obras = [], isLoading, error, refetch } = useObras()
  const [openNew, setOpenNew] = useState(false)

  const podeAcessar = role === 'god' || role === 'adm'

  const columns = useMemo<ColumnDef<ObraComEmpresa, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        cell: (info) => <span className="font-medium text-accent">{String(info.getValue())}</span>,
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
        // o valor da coluna é o rótulo, para a busca e a exportação não mostrarem o código do banco
        id: 'status',
        header: 'Status',
        accessorFn: (row) => rotuloStatusObra(row.status),
        cell: ({ row }) => {
          const v = row.original.status
          const variant =
            v === 'concluido'
              ? 'success'
              : v === 'paralisado'
                ? 'warn'
                : v === 'em_andamento'
                  ? 'accent'
                  : 'default'
          return (
            <Badge variant={variant as 'success' | 'warn' | 'accent' | 'default'}>
              {rotuloStatusObra(v)}
            </Badge>
          )
        },
        meta: { label: 'Status' },
        size: 130
      },
      {
        id: 'ativa',
        header: 'Situação',
        accessorFn: (row) => (row.ativa ? 'Ativa' : 'Desabilitada'),
        cell: ({ row }) =>
          row.original.ativa ? (
            <span className="text-text-muted">Ativa</span>
          ) : (
            <Badge variant="warn">Desabilitada</Badge>
          ),
        meta: { label: 'Situação' },
        size: 120
      },
      {
        accessorKey: 'created_at',
        header: 'Criada em',
        cell: (info) => (
          <span className="tabular text-text-muted">{formatDate(info.getValue() as string)}</span>
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
            description="Só o administrador cadastra e gerencia obras. Peça ao administrador da sua empresa."
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
          role === 'god'
            ? 'Obras de todas as empresas.'
            : 'Obras da sua empresa. Abra uma obra para editar os dados e os acessos.'
        }
        actions={
          <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
            <Plus size={12} /> Nova obra
          </Button>
        }
      />
      {error ? (
        <ErroConsulta
          erro={error}
          oQue="as obras"
          aoTentar={() => void refetch()}
          className="mx-3 my-2"
        />
      ) : null}
      {error && obras.length === 0 ? null : obras.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="folder"
            title="Nenhuma obra cadastrada"
            description="Cadastre a primeira obra para montar o orçamento e dar acesso aos engenheiros."
            action={
              <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                <Plus size={12} /> Nova obra
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          exportTitulo="Obras"
          data={obras}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar por código ou nome…"
          emptyMessage="Nenhuma obra encontrada com essa busca."
          onRowClick={(row) => navigate({ to: `/gerencial/obras/${row.id}` })}
        />
      )}

      <NewObraDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  )
}
