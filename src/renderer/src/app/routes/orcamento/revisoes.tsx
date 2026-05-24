import { useMemo, useState, type ReactNode } from 'react'
import { Plus, ArrowRight } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/layout/EmptyState'
import { Button } from '@/components/ui/button'
import { RequireObra } from '@/components/layout/RequireObra'
import { DataTable } from '@/components/data-table/DataTable'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { useAuthStore } from '@/stores/auth-store'
import { useRevisoes } from '@/features/orcamento/hooks/revisoes'
import { RevisaoStatusBadge } from '@/features/orcamento/components/RevisaoStatusBadge'
import { CriarRevisaoDialog } from '@/features/orcamento/modals/CriarRevisaoDialog'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { formatDate } from '@/lib/format'
import type { Revisao } from '@/types/orcamento'

export function RevisoesPage(): ReactNode {
  return (
    <RequireObra pageTitle="Revisões">
      <Revisoes />
    </RequireObra>
  )
}

function Revisoes(): ReactNode {
  const scope = useCurrentScope()
  const navigate = useNavigate()
  const role = useAuthStore((s) => s.profile?.role)
  const obraId = scope.obraId!
  const { data: revisoes = [], isLoading, error } = useRevisoes(obraId)
  const [openNew, setOpenNew] = useState(false)

  const podeEditar = role === 'god' || role === 'adm' || role === 'engenheiro'

  const columns = useMemo<ColumnDef<Revisao, unknown>[]>(
    () => [
      {
        accessorKey: 'versao',
        header: 'Versão',
        cell: (info) => (
          <span className="text-text font-mono font-semibold">v{String(info.getValue())}</span>
        ),
        meta: { label: 'Versão' },
        size: 80
      },
      {
        accessorKey: 'rotulo',
        header: 'Rótulo',
        cell: (info) => (
          <span className="text-text">{(info.getValue() as string | null) ?? '—'}</span>
        ),
        meta: { label: 'Rótulo' }
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (info) => <RevisaoStatusBadge status={info.getValue() as Revisao['status']} />,
        meta: { label: 'Status' },
        size: 130
      },
      {
        accessorKey: 'venda_total',
        header: 'Venda',
        cell: (info) => (
          <span className="font-mono text-text tabular-nums">
            {fmtBRL(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Venda' },
        size: 130
      },
      {
        accessorKey: 'custo_total',
        header: 'Custo',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtBRL(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Custo' },
        size: 130
      },
      {
        accessorKey: 'lucratividade_perc',
        header: 'Lucr.%',
        cell: (info) => {
          const v = info.getValue() as number | null
          return (
            <span className="font-mono tabular-nums text-text-muted">
              {v !== null ? fmtPct2(v) : '—'}
            </span>
          )
        },
        meta: { label: 'Lucratividade' },
        size: 90
      },
      {
        accessorKey: 'criada_em',
        header: 'Criada em',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">
            {formatDate(info.getValue() as string)}
          </span>
        ),
        meta: { label: 'Criada em' },
        size: 130
      },
      {
        id: 'acoes',
        header: '',
        size: 60,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                navigate({ to: '/orcamento/obra/revisoes/$id', params: { id: row.original.id } })
              }
              className="w-6 h-6 inline-flex items-center justify-center rounded text-text-dim hover:text-accent hover:bg-bg-hover"
              title="Ver detalhes"
            >
              <ArrowRight size={12} />
            </button>
          </div>
        ),
        meta: { label: '' }
      }
    ],
    [navigate]
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Revisões"
        subtitle={`${scope.obra?.nome ?? ''} — histórico de versões do orçamento`}
        actions={
          podeEditar ? (
            <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
              <Plus size={11} /> Nova revisão
            </Button>
          ) : null
        }
      />
      {error ? (
        <div className="mx-3 my-2 text-2xs font-mono text-danger bg-danger/10 border border-danger/30 rounded px-2 py-1.5">
          {error.message}
        </div>
      ) : null}
      {revisoes.length === 0 && !isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon="history"
            title="Nenhuma revisão"
            description="Crie a primeira revisão para congelar uma versão do orçamento."
            action={
              podeEditar ? (
                <Button variant="default" size="sm" onClick={() => setOpenNew(true)}>
                  <Plus size={11} /> Criar primeira revisão
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <DataTable
          data={revisoes}
          columns={columns}
          loading={isLoading}
          globalSearchPlaceholder="Buscar revisão…"
          emptyMessage="Nenhuma revisão"
          onRowClick={(row) =>
            navigate({ to: '/orcamento/obra/revisoes/$id', params: { id: row.id } })
          }
        />
      )}

      <CriarRevisaoDialog open={openNew} onOpenChange={setOpenNew} obraId={obraId} />
    </div>
  )
}
