import { useMemo, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table/DataTable'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { INDIRETO_TIPO_LABEL, type Indireto, type IndiretoTipo } from '@/types/orcamento'
import { useDeleteIndireto } from '../hooks/indireto'

interface Props {
  obraId: string
  data: Indireto[]
  loading: boolean
  podeEditar: boolean
}

export function IndiretoTable({ obraId, data, loading, podeEditar }: Props): ReactNode {
  const del = useDeleteIndireto()

  const columns = useMemo<ColumnDef<Indireto, unknown>[]>(
    () => [
      {
        accessorKey: 'codigo',
        header: 'Código',
        cell: (info) => (
          <span className="font-mono text-2xs text-text-dim">{String(info.getValue())}</span>
        ),
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
          <span className="text-text-muted font-mono text-2xs">
            {INDIRETO_TIPO_LABEL[info.getValue() as IndiretoTipo]}
          </span>
        ),
        meta: { label: 'Tipo' },
        size: 150
      },
      {
        accessorKey: 'valor_total',
        header: 'Valor total',
        cell: (info) => (
          <span className="font-mono text-text tabular-nums text-right">
            {fmtBRL(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Valor total' },
        size: 140
      },
      {
        accessorKey: 'distribuicao_perc',
        header: 'Dist.',
        cell: (info) => (
          <span className="font-mono text-text-muted tabular-nums">
            {fmtPct2(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Distribuição' },
        size: 80
      },
      {
        id: 'efetivo',
        header: 'Efetivo',
        accessorFn: (row) => Number(row.valor_total) * Number(row.distribuicao_perc),
        cell: (info) => (
          <span className="font-mono text-accent tabular-nums">
            {fmtBRL(info.getValue() as number)}
          </span>
        ),
        meta: { label: 'Efetivo' },
        size: 140
      },
      ...(podeEditar
        ? [
            {
              id: 'acoes',
              header: '',
              size: 60,
              cell: ({ row }) => (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Excluir "${row.original.descricao}"?`)) {
                        del.mutate({ id: row.original.id, obra_id: obraId })
                      }
                    }}
                    className="w-6 h-6 inline-flex items-center justify-center rounded text-text-dim hover:text-danger hover:bg-danger/10"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ),
              meta: { label: '' }
            } as ColumnDef<Indireto, unknown>
          ]
        : [])
    ],
    [del, obraId, podeEditar]
  )

  return (
    <DataTable
      data={data}
      columns={columns}
      loading={loading}
      globalSearchPlaceholder="Buscar indireto…"
      emptyMessage="Nenhum custo indireto cadastrado"
    />
  )
}
