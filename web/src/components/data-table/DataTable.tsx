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
  Download,
  Check,
  Minus,
  Rows3
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/dropdown'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { contar } from '@/lib/rotulos'
import type { TableExportConfig } from './export-types'
import { useCurrentScope } from '@/hooks/useCurrentScope'

/** Valor de célula para a planilha: número fica número; data, texto dd/mm/aaaa; objeto, o nome. */
function valorExport(v: unknown): string | number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (v instanceof Date) return v.toLocaleDateString('pt-BR')
  if (typeof v === 'string')
    return /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleString('pt-BR') : v
  if (typeof v === 'object') {
    const o = v as { nome?: unknown; codigo?: unknown }
    if (typeof o.nome === 'string') return o.nome
    if (typeof o.codigo === 'string') return o.codigo
  }
  return String(v)
}

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
  /** Título e nome do arquivo da exportação padrão (sem `getExportConfig`): as colunas e linhas visíveis. */
  exportTitulo?: string
  /** Controles do toolbar à direita (default: todos visíveis). */
  enableColumnVisibility?: boolean
  enableDensity?: boolean
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
  enableExport = true,
  exportTitulo
}: DataTableProps<T>): ReactNode {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const density = useUIStore((s) => s.density)
  const setDensity = useUIStore((s) => s.setDensity)
  const openModal = useUIStore((s) => s.openModal)
  const scope = useCurrentScope()

  // Pré-pende coluna de checkbox quando enableRowSelection. Mantém memoização
  // estável: o array de columns recebido como prop não muda, então o spread
  // só recalcula se enableRowSelection mudar.
  const effectiveColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!enableRowSelection) return columns
    const selectCol: ColumnDef<T, unknown> = {
      id: '__select__',
      size: 36,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <button
          type="button"
          role="checkbox"
          aria-checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? 'mixed'
                : false
          }
          aria-label="Selecionar todas as linhas desta página"
          title="Selecionar todas as linhas desta página"
          onClick={(e) => {
            e.stopPropagation()
            table.toggleAllPageRowsSelected(!table.getIsAllPageRowsSelected())
          }}
          className={cn(
            'size-4 inline-flex items-center justify-center rounded-sm border align-middle',
            table.getIsAllPageRowsSelected()
              ? 'border-accent bg-accent text-[color:var(--on-accent)]'
              : table.getIsSomePageRowsSelected()
                ? 'border-accent bg-accent/40 text-[color:var(--on-accent)]'
                : 'border-border-strong bg-bg-panel hover:border-accent'
          )}
        >
          {table.getIsAllPageRowsSelected() ? (
            <Check size={12} strokeWidth={3} />
          ) : table.getIsSomePageRowsSelected() ? (
            <Minus size={12} strokeWidth={3} />
          ) : null}
        </button>
      ),
      cell: ({ row }: { row: Row<T> }) => (
        <button
          type="button"
          role="checkbox"
          aria-checked={row.getIsSelected()}
          aria-label="Selecionar a linha"
          onClick={(e) => {
            e.stopPropagation()
            row.toggleSelected(!row.getIsSelected())
          }}
          className={cn(
            'size-4 inline-flex items-center justify-center rounded-sm border align-middle',
            row.getIsSelected()
              ? 'border-accent bg-accent text-[color:var(--on-accent)]'
              : 'border-border-strong bg-bg-panel hover:border-accent'
          )}
        >
          {row.getIsSelected() ? <Check size={12} strokeWidth={3} /> : null}
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

  const rowHeight = density === 'compact' ? 'h-7' : 'h-9'
  const cellPad = density === 'compact' ? 'px-2 py-1' : 'px-3 py-1.5'

  // Número alinha à direita: vale o `meta.align` da coluna ou, sem ele, o tipo do valor nas primeiras linhas.
  const aDireita = useMemo(() => {
    const out = new Set<string>()
    const amostra = table.getCoreRowModel().rows.slice(0, 30)
    for (const c of table.getAllLeafColumns()) {
      const align = (c.columnDef.meta as { align?: 'left' | 'right' } | undefined)?.align
      if (align) {
        if (align === 'right') out.add(c.id)
        continue
      }
      if (c.accessorFn === undefined) continue
      let numeros = 0
      let outros = 0
      for (const r of amostra) {
        const v = r.getValue(c.id)
        if (v == null || v === '') continue
        if (typeof v === 'number') numeros++
        else outros++
      }
      if (numeros > 0 && outros === 0) out.add(c.id)
    }
    return out
    // `table` é estável; recalcula quando os dados ou as colunas mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, effectiveColumns])

  return (
    // `min-h-0` é essencial: sem ele o min-height:auto padrão de item flex impede
    // a tabela de encolher abaixo da altura do conteúdo, estourando a página e
    // empurrando o footer de paginação para fora (rolagem externa). Com min-h-0 o
    // overflow fica contido aqui → tabela rola internamente, footer fixo.
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-bg-panel">
        <div className="relative max-w-full">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
          />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={globalSearchPlaceholder}
            className="pl-7 w-[240px] max-w-full"
          />
        </div>

        {selectedCount > 0 ? (
          <>
            <Badge variant="accent">
              {selectedCount} {selectedCount > 1 ? 'selecionados' : 'selecionado'}
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
                <Settings2 size={12} /> Colunas
              </Button>
            }
          >
            <DropdownLabel>Colunas visíveis</DropdownLabel>
            {table
              .getAllLeafColumns()
              .filter((c) => c.getCanHide())
              .map((c) => (
                <DropdownItem key={c.id} onClick={() => c.toggleVisibility()}>
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 mr-1 rounded-sm border inline-flex items-center justify-center',
                      c.getIsVisible()
                        ? 'bg-accent border-accent text-[color:var(--on-accent)]'
                        : 'border-border-strong'
                    )}
                  >
                    {c.getIsVisible() ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                  {(c.columnDef.meta as { label?: string } | undefined)?.label ?? c.id}
                </DropdownItem>
              ))}
          </Dropdown>
        ) : null}

        {enableDensity ? (
          <Dropdown
            align="end"
            trigger={
              <Button variant="ghost" size="sm" title="Tamanho do texto e altura das linhas">
                <Rows3 size={12} /> {density === 'compact' ? 'Compacto' : 'Confortável'}
              </Button>
            }
          >
            <DropdownLabel>Tamanho do texto</DropdownLabel>
            <DropdownItem onClick={() => setDensity('normal')}>Confortável</DropdownItem>
            <DropdownItem onClick={() => setDensity('compact')}>Compacto</DropdownItem>
          </Dropdown>
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
                // exportação padrão: as colunas com dado e as linhas visíveis (filtro + ordenação atuais)
                const cols = table
                  .getVisibleLeafColumns()
                  .filter((c) => c.id !== '__select__' && c.accessorFn !== undefined)
                const titulo = exportTitulo ?? 'Tabela'
                openModal('export', {
                  filenameBase: `${titulo
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/[^\w]+/g, '-')
                    .toLowerCase()}`,
                  titulo,
                  obraNome: scope.obra?.nome ?? '',
                  colunas: cols.map((c) => {
                    const meta = c.columnDef.meta as { label?: string } | undefined
                    const h = c.columnDef.header
                    return { header: meta?.label || (typeof h === 'string' ? h : c.id) }
                  }),
                  linhas: table
                    .getSortedRowModel()
                    .rows.map((r) => cols.map((c) => valorExport(r.getValue(c.id))))
                } satisfies TableExportConfig)
              }
            }}
          >
            <Download size={12} /> Exportar
          </Button>
        ) : null}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm tabular">
          <thead className="sticky top-0 bg-bg-panel z-10 border-b border-border-strong">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort()
                  const sort = header.column.getIsSorted()
                  const direita = aDireita.has(header.column.id)
                  const conteudo = flexRender(header.column.columnDef.header, header.getContext())
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined
                      }
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      className={cn(
                        'font-semibold uppercase tracking-[0.08em] text-2xs text-text-dim',
                        'border-r border-border last:border-r-0',
                        direita ? 'text-right' : 'text-left',
                        cellPad
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          title="Ordenar por esta coluna"
                          className={cn(
                            'inline-flex items-center gap-1 uppercase tracking-[0.08em] font-semibold rounded-sm hover:text-text',
                            sort && 'text-text'
                          )}
                        >
                          {conteudo}
                          {sort === 'asc' ? (
                            <ChevronUp size={12} />
                          ) : sort === 'desc' ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronsUpDown size={12} className="opacity-50" />
                          )}
                        </button>
                      ) : (
                        conteudo
                      )}
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
                <td colSpan={table.getVisibleLeafColumns().length} className="py-16 text-center">
                  <div className="text-text text-md font-semibold">{emptyMessage}</div>
                  {emptyDescription ? (
                    <div className="text-text-muted text-sm mt-1">{emptyDescription}</div>
                  ) : null}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                const isSelected = row.getIsSelected()
                return (
                  <tr
                    key={row.id}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={cn(
                      'border-b border-border hover:bg-bg-hover transition-colors',
                      onRowClick &&
                        'cursor-pointer focus-visible:outline-none focus-visible:bg-bg-active',
                      isSelected && 'bg-accent-glow',
                      rowHeight
                    )}
                    onClick={() => onRowClick?.(row.original)}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === 'Enter' && e.target === e.currentTarget)
                              onRowClick(row.original)
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          'border-r border-border last:border-r-0',
                          cellPad,
                          'text-text',
                          aDireita.has(cell.column.id) && 'text-right'
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

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1.5 border-t border-border bg-bg-panel text-xs text-text-muted">
        <div>
          {contar(table.getFilteredRowModel().rows.length, 'item', 'itens')}
          {table.getFilteredRowModel().rows.length !== data.length
            ? ` de ${data.length.toLocaleString('pt-BR')}`
            : ''}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            Linhas por página
            <select
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="h-7 rounded border border-border-strong bg-bg-panel px-1.5 text-xs text-text"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="tabular">
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount() || 1}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Próxima página"
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}
