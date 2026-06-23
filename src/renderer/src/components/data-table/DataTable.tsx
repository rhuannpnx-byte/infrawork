import { useMemo, useState, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type Row,
  type SortingState,
  type RowSelectionState,
  type VisibilityState
} from '@tanstack/react-table'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Settings2,
  Download
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/dropdown'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import type { TableExportConfig } from './export-types'

interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  loading?: boolean
  onRowClick?: (row: T) => void
  globalSearchPlaceholder?: string
  /** Optional toolbar action slot (left side of toolbar) */
  toolbarLeft?: ReactNode
  /** Optional toolbar action slot (right side of toolbar) */
  toolbarRight?: ReactNode
  emptyMessage?: string
  emptyDescription?: string
  initialPageSize?: number
  /** Habilita coluna de checkbox de seleção. */
  enableRowSelection?: boolean
  /** Slot pra renderizar ações em lote no toolbar quando há seleção.
   *  Recebe as linhas selecionadas + callback pra limpar a seleção. */
  selectionActions?: (selectedRows: T[], clearSelection: () => void) => ReactNode
  /** Habilita exportação real (CSV/Excel/PDF). Recebe as linhas visíveis
   *  (filtro + ordenação atuais) e devolve a config de exportação. */
  getExportConfig?: (visibleRows: T[]) => TableExportConfig
  /** Controles do toolbar à direita (default: todos visíveis). */
  enableColumnVisibility?: boolean
  enableDensity?: boolean
  enableFilters?: boolean
  enableExport?: boolean
}

export function DataTable<T>({
  data,
  columns,
  loading = false,
  onRowClick,
  globalSearchPlaceholder = 'Filtrar…',
  toolbarLeft,
  toolbarRight,
  emptyMessage = 'Nenhum registro encontrado',
  emptyDescription,
  initialPageSize = 50,
  enableRowSelection = false,
  selectionActions,
  getExportConfig,
  enableColumnVisibility = true,
  enableDensity = true,
  enableFilters = true,
  enableExport = true
}: DataTableProps<T>): ReactNode {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const density = useUIStore((s) => s.density)
  const setDensity = useUIStore((s) => s.setDensity)
  const openModal = useUIStore((s) => s.openModal)

  // Pré-pende coluna de checkbox quando enableRowSelection. Mantém memoização
  // estável: o array de columns recebido como prop não muda, então o spread
  // só recalcula se enableRowSelection mudar.
  const effectiveColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!enableRowSelection) return columns
    const selectCol: ColumnDef<T, unknown> = {
      id: '__select__',
      size: 32,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            table.toggleAllPageRowsSelected(!table.getIsAllPageRowsSelected())
          }}
          className={cn(
            'w-3.5 h-3.5 inline-flex items-center justify-center rounded border',
            table.getIsAllPageRowsSelected()
              ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
              : table.getIsSomePageRowsSelected()
                ? 'border-accent bg-accent/40'
                : 'border-border-strong hover:border-accent'
          )}
          title="Selecionar todos nesta página"
        >
          {table.getIsAllPageRowsSelected() ? '✓' : table.getIsSomePageRowsSelected() ? '−' : ''}
        </button>
      ),
      cell: ({ row }: { row: Row<T> }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            row.toggleSelected(!row.getIsSelected())
          }}
          className={cn(
            'w-3.5 h-3.5 inline-flex items-center justify-center rounded border text-2xs',
            row.getIsSelected()
              ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
              : 'border-border-strong hover:border-accent'
          )}
        >
          {row.getIsSelected() ? '✓' : ''}
        </button>
      )
    }
    return [selectCol, ...columns]
  }, [columns, enableRowSelection])

  const table = useReactTable({
    data,
    columns: effectiveColumns,
    enableRowSelection,
    state: { sorting, globalFilter, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } }
  })

  const selectedCount = useMemo(() => Object.keys(rowSelection).length, [rowSelection])
  const selectedRows = useMemo<T[]>(
    () => table.getSelectedRowModel().rows.map((r) => r.original),
    // O `table` é estável; o que muda é rowSelection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowSelection]
  )
  const clearSelection = (): void => setRowSelection({})

  const rowHeight = density === 'compact' ? 'h-7' : 'h-8'
  const cellPad = density === 'compact' ? 'px-2 py-1' : 'px-3 py-1.5'

  return (
    // `min-h-0` é essencial: sem ele o min-height:auto padrão de item flex impede
    // a tabela de encolher abaixo da altura do conteúdo, estourando a página e
    // empurrando o footer de paginação para fora (rolagem externa). Com min-h-0 o
    // overflow fica contido aqui → tabela rola internamente, footer fixo.
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-panel">
        <div className="relative">
          <Search
            size={11}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
          />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={globalSearchPlaceholder}
            className="pl-7 w-[240px]"
          />
        </div>

        {selectedCount > 0 ? (
          <>
            <Badge variant="accent">
              {selectedCount} selecionado{selectedCount > 1 ? 's' : ''}
            </Badge>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Limpar seleção
            </Button>
            {selectionActions ? selectionActions(selectedRows, clearSelection) : null}
          </>
        ) : null}

        {toolbarLeft}

        <div className="flex-1" />

        {toolbarRight}

        {enableColumnVisibility ? (
          <Dropdown
            align="end"
            trigger={
              <Button variant="ghost" size="sm">
                <Settings2 size={11} /> Colunas
              </Button>
            }
          >
            <DropdownLabel>Visibilidade</DropdownLabel>
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <DropdownItem key={c.id} onClick={() => c.toggleVisibility()}>
                  <span
                    className={cn(
                      'w-3 h-3 mr-1 rounded-sm border',
                      c.getIsVisible() ? 'bg-accent border-accent' : 'border-border-strong'
                    )}
                  />
                  {(c.columnDef.meta as { label?: string } | undefined)?.label ?? c.id}
                </DropdownItem>
              ))}
          </Dropdown>
        ) : null}

        {enableDensity ? (
          <Dropdown
            align="end"
            trigger={
              <Button variant="ghost" size="sm">
                Densidade
              </Button>
            }
          >
            <DropdownItem onClick={() => setDensity('compact')}>Compacta</DropdownItem>
            <DropdownItem onClick={() => setDensity('normal')}>Normal</DropdownItem>
          </Dropdown>
        ) : null}

        {enableFilters ? (
          <Button variant="ghost" size="sm" onClick={() => openModal('filters')}>
            Filtros
          </Button>
        ) : null}

        {enableExport ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (getExportConfig) {
                const visibleRows = table.getSortedRowModel().rows.map((r) => r.original)
                openModal('export', getExportConfig(visibleRows))
              } else {
                // limpa payload anterior p/ não vazar config de outra tabela
                openModal('export', null)
              }
            }}
          >
            <Download size={11} /> Exportar
          </Button>
        ) : null}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs tabular">
          <thead className="sticky top-0 bg-bg-panel z-10 border-b border-border-strong">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sort = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      className={cn(
                        'text-left font-medium font-mono uppercase tracking-wider text-2xs text-text-dim',
                        'border-r border-border last:border-r-0',
                        cellPad,
                        canSort && 'cursor-pointer select-none hover:text-text-muted'
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort ? (
                          sort === 'asc' ? (
                            <ChevronUp size={9} />
                          ) : sort === 'desc' ? (
                            <ChevronDown size={9} />
                          ) : (
                            <ChevronsUpDown size={9} className="opacity-50" />
                          )
                        ) : null}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 12 }).map((_, i) => (
                <tr key={i} className={cn('border-b border-border', rowHeight)}>
                  {table.getAllLeafColumns().map((c) => (
                    <td key={c.id} className={cellPad}>
                      <div className="h-3 bg-bg-elevated rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-16 text-center">
                  <div className="text-text-muted text-sm">{emptyMessage}</div>
                  {emptyDescription ? (
                    <div className="text-text-dim text-xs mt-1">{emptyDescription}</div>
                  ) : null}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isSelected = row.getIsSelected()
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b border-border hover:bg-bg-hover transition-colors cursor-pointer',
                      isSelected && 'bg-accent-glow',
                      rowHeight
                    )}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          'border-r border-border last:border-r-0',
                          cellPad,
                          'text-text'
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-bg-panel">
        <div className="text-2xs font-mono text-text-dim">
          {table.getFilteredRowModel().rows.length}{' '}
          {table.getFilteredRowModel().rows.length === 1 ? 'item' : 'itens'}
          {table.getFilteredRowModel().rows.length !== data.length ? ` · ${data.length} total` : ''}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-text-dim">
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Página anterior"
          >
            <ChevronLeft size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Próxima página"
          >
            <ChevronRight size={12} />
          </Button>
        </div>
      </div>
    </div>
  )
}
