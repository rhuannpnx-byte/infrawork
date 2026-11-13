import { useMemo, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table/DataTable'
import { IconButton } from '@/components/ui/IconButton'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { INDIRETO_TIPO_LABEL, type Indireto, type IndiretoTipo } from '@/types/orcamento'
import { useDeleteIndireto } from '../hooks/indireto'
import { useConfirm } from '@/components/modals/ConfirmDialog'

interface Props {
  obraId: string
  data: Indireto[]
  loading: boolean
  podeEditar: boolean
}

export function IndiretoTable({ obraId, data, loading, podeEditar }: Props): ReactNode {
  const del = useDeleteIndireto()
  const confirm = useConfirm()

  const columns = useMemo<ColumnDef<Indireto, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        cell: (info) => <span className="text-text-dim">{String(info.getValue())}</span>,
        meta: { label: 'Código' },
        size: 100
      },
      {
        accessorKey: 'descricao',
        header: 'Descrição',
        cell: (info) => <span className="text-text">{String(info.getValue())}</span>,
        meta: { label: 'Descrição' }
      },
      {
        accessorKey: 'tipo',
        header: 'Tipo',
        cell: (info) => (
          <span className="text-text-muted">
            {INDIRETO_TIPO_LABEL[info.getValue() as IndiretoTipo]}
          </span>
        ),
        meta: { label: 'Tipo' },
        size: 170
      },
      {
        accessorKey: 'valor_total',
        header: 'Valor total',
        cell: (info) => <span className="text-text">{fmtBRL(info.getValue() as number)}</span>,
        meta: { label: 'Valor total', align: 'right' },
        size: 140
      },
      {
        accessorKey: 'distribuicao_perc',
        header: 'Distribuição',
        cell: (info) => (
          <span className="text-text-muted">{fmtPct2(info.getValue() as number)}</span>
        ),
        meta: { label: 'Distribuição', align: 'right' },
        size: 110
      },
      {
        id: 'efetivo',
        header: 'Valor efetivo',
        accessorFn: (row) => Number(row.valor_total) * Number(row.distribuicao_perc),
        cell: (info) => (
          <span className="font-semibold text-text">{fmtBRL(info.getValue() as number)}</span>
        ),
        meta: { label: 'Valor efetivo', align: 'right' },
        size: 160
      },
      ...(podeEditar
        ? [
            {
              id: 'acoes',
              header: '',
              size: 60,
              enableSorting: false,
              cell: ({ row }) => (
                <div className="flex justify-end">
                  <IconButton
                    size="sm"
                    variant="danger"
                    aria-label={`Excluir ${row.original.descricao}`}
                    title={`Excluir ${row.original.descricao}`}
                    disabled={del.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Excluir "${row.original.descricao}"?`,
                        description:
                          'O custo indireto sai do orçamento e deixa de contar na lucratividade. Não dá para desfazer.',
                        confirmLabel: 'Excluir',
                        variant: 'danger'
                      })
                      if (ok) del.mutate({ id: row.original.id, obra_id: obraId })
                    }}
                  >
                    <Trash2 size={12} aria-hidden />
                  </IconButton>
                </div>
              ),
              meta: { label: 'Ações' }
            } as ColumnDef<Indireto, unknown>
          ]
        : [])
    ],
    [confirm, del, obraId, podeEditar]
  )

  return (
    <DataTable
      exportTitulo="Indireto"
      data={data}
      columns={columns}
      loading={loading}
      globalSearchPlaceholder="Buscar custo indireto…"
      emptyMessage="Nenhum custo indireto encontrado"
      emptyDescription="Confira a busca ou cadastre um novo custo indireto."
    />
  )
}
