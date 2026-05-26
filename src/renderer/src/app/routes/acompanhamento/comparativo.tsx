import { type ReactNode, useMemo, useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireObra } from '@/components/layout/RequireObra'
import { DataTable } from '@/components/data-table/DataTable'
import { useCurrentScope } from '@/hooks/useCurrentScope'
import { usePrevistoXRealizado, useCurvaS } from '@/features/acompanhamento/hooks/comparativo'
import { CurvaSComProjecoes } from '@/features/acompanhamento/components/comparativo/CurvaSComProjecoes'
import { ProgressBarPrevReal } from '@/features/acompanhamento/components/comparativo/ProgressBarPrevReal'
import { StatusComparativoChip } from '@/features/acompanhamento/components/comparativo/StatusComparativoChip'
import type { PrevistoRealizadoItem } from '@/types/acompanhamento'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

export function AcompanhamentoComparativoPage(): ReactNode {
  return (
    <RequireObra pageTitle="Previsto × Realizado">
      <Inner />
    </RequireObra>
  )
}

function Inner(): ReactNode {
  const scope = useCurrentScope()
  const obraId = scope.obraId!
  const { data: itens = [], isLoading } = usePrevistoXRealizado(obraId)
  const { data: curva = [] } = useCurvaS(obraId, 180)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const itemSelecionado = useMemo(
    () => (selectedId ? itens.find((i) => i.item_orcamentario_id === selectedId) : null) ?? null,
    [selectedId, itens]
  )

  const curvaFiltrada = useMemo(
    () => (selectedId ? curva.filter((p) => p.item_orcamentario_id === selectedId) : curva),
    [selectedId, curva]
  )

  const columns = useMemo<ColumnDef<PrevistoRealizadoItem, unknown>[]>(() => [
    {
      header: 'Código',
      accessorKey: 'codigo',
      cell: ({ row }) => (
        <span className={cn('font-mono text-xs', row.original.item_orcamentario_id === selectedId && 'text-accent font-semibold')}>
          {row.original.codigo}
        </span>
      )
    },
    {
      header: 'Descrição',
      accessorKey: 'descricao',
      cell: ({ row }) => (
        <span className="text-xs truncate block max-w-[280px]" title={row.original.descricao}>
          {row.original.descricao}
        </span>
      )
    },
    {
      header: 'Qtd planejada',
      accessorKey: 'qtd_plan',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-xs">
          {row.original.qtd_plan != null
            ? formatNumber(Number(row.original.qtd_plan), 1)
            : '—'}
          {row.original.unidade ? <span className="text-text-dim ml-1">{row.original.unidade}</span> : null}
        </span>
      )
    },
    {
      header: 'Qtd realizada',
      accessorKey: 'qtd_real',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-xs">
          {formatNumber(Number(row.original.qtd_real ?? 0), 1)}
        </span>
      )
    },
    {
      header: 'Avanço',
      accessorKey: 'pct_avanco',
      cell: ({ row }) => (
        <ProgressBarPrevReal
          pct={row.original.pct_avanco}
          esperado={row.original.pct_esperado_hoje}
          status={row.original.status}
        />
      )
    },
    {
      header: 'Dias plan',
      accessorKey: 'dias_plan',
      cell: ({ row }) => <span className="font-mono tabular-nums text-xs">{row.original.dias_plan ?? '—'}</span>
    },
    {
      header: 'Dias real',
      accessorKey: 'dias_real',
      cell: ({ row }) => <span className="font-mono tabular-nums text-xs">{row.original.dias_real ?? '—'}</span>
    },
    {
      header: 'Δ dias',
      accessorKey: 'desvio_dias_estimado',
      cell: ({ row }) => {
        const d = row.original.desvio_dias_estimado
        if (d == null) return <span className="text-text-dim text-xs">—</span>
        const v = Number(d)
        return (
          <span className={`font-mono tabular-nums text-xs ${v < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {v > 0 ? '+' : ''}{v}
          </span>
        )
      }
    },
    {
      header: 'Status',
      accessorKey: 'status',
      cell: ({ row }) => <StatusComparativoChip status={row.original.status} />
    }
  ], [selectedId])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Previsto × Realizado"
        subtitle={`${scope.obra?.nome ?? ''} · ${itens.length} servico_grupos no baseline${selectedId ? ' · filtrando 1 serviço' : ''}`}
        actions={
          selectedId && (
            <button
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-2xs font-mono text-text-dim hover:text-text"
            >
              <X size={11} /> Limpar filtro
            </button>
          )
        }
      />
      <div className="flex-1 overflow-auto p-5 space-y-4">
        <CurvaSComProjecoes pontos={curvaFiltrada} item={itemSelecionado} altura={360} />

        {!selectedId && (
          <div className="text-2xs font-mono text-text-dim">
            Clique em uma linha da tabela para filtrar a curva-S por serviço e ativar projeções de término.
          </div>
        )}

        <DataTable
          data={itens}
          columns={columns}
          loading={isLoading}
          emptyMessage="Sem comparativo disponível"
          emptyDescription="Defina baseline no Planejamento e vincule serviços do SIGA."
          onRowClick={(row) => setSelectedId((cur) => cur === row.item_orcamentario_id ? null : row.item_orcamentario_id)}
        />
      </div>
    </div>
  )
}
