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
  initialPageSize = 50
}: DataTableProps<T>): ReactNode {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const density = useUIStore((s) => s.density)
  const setDensity = useUIStore((s) => s.setDensity)
  const openModal = useUIStore((s) => s.openModal)

  const table = useReactTable({
    data,
    columns,
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

  const rowHeight = density === 'compact' ? 'h-7' : 'h-8'
  const cellPad = density === 'compact' ? 'px-2 py-1' : 'px-3 py-1.5'

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-panel">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={globalSearchPlaceholder}
            className="pl-7 w-[240px]"
          />
        </div>

        {selectedCount > 0 ? (
          <Badge variant="accent">{selectedCount} selecionado{selectedCount > 1 ? 's' : ''}</Badge>
        ) : null}

        {toolbarLeft}

        <div className="flex-1" />

        {toolbarRight}

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
                <span className={cn('w-3 h-3 mr-1 rounded-sm border', c.getIsVisible() ? 'bg-accent border-accent' : 'border-border-strong')} />
                {(c.columnDef.meta as { label?: string } | undefined)?.label ?? c.id}
              </DropdownItem>
            ))}
        </Dropdown>

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

        <Button variant="ghost" size="sm" onClick={() => openModal('filters')}>
          Filtros
        </Button>

        <Button variant="secondary" size="sm" onClick={() => openModal('export')}>
          <Download size={11} /> Exportar
        </Button>
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
          {table.getFilteredRowModel().rows.length} {table.getFilteredRowModel().rows.length === 1 ? 'item' : 'itens'}
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
