import { memo, useMemo, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
  Package,
  Plus,
  Trash2,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Move
} from 'lucide-react'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import { fmtBRL, fmtPct2 } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useDeleteItem, useReorderItem, useUpsertItem } from '../hooks/plan-orc'
import { PlanOrcInlineCell } from './PlanOrcInlineCell'
import type { ItemTreeNode } from '@/types/orcamento'

interface Props {
  obraId: string
  flat: ItemTreeNode[]
  podeEditar: boolean
  selectedIds: Set<string>
  onToggleSelect: (
    id: string,
    e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  ) => void
  onSelect: (id: string) => void
  onNewChild: (parent: ItemTreeNode | null) => void
  onMover: (node: ItemTreeNode) => void
  expandedIds: Set<string>
  setExpandedIds: (next: Set<string>) => void
}

const ROW_HEIGHT = 28

export function PlanOrcTree({
  obraId,
  flat,
  podeEditar,
  selectedIds,
  onToggleSelect,
  onSelect,
  onNewChild,
  onMover,
  expandedIds,
  setExpandedIds
}: Props): ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)

  // Filtra a flat para esconder filhos de nodes colapsados
  const visible = useMemo(() => {
    const out: ItemTreeNode[] = []
    let hideUntilDepth: number | null = null
    for (const node of flat) {
      if (hideUntilDepth !== null) {
        if (node.depth > hideUntilDepth) continue
        hideUntilDepth = null
      }
      out.push(node)
      const podeAgrupar = node.tipo === 'etapa' || node.tipo === 'servico_grupo'
      if (podeAgrupar && !expandedIds.has(node.id)) {
        hideUntilDepth = node.depth
      }
    }
    return out
  }, [flat, expandedIds])

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  const toggleExpand = (id: string): void => {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedIds(next)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center text-2xs font-mono uppercase tracking-wider text-text-dim bg-bg-elevated border-b border-border sticky top-0 z-10">
        <div className="px-2 py-1.5" style={{ width: 460 }}>
          Código · Descrição
        </div>
        <div className="px-2 py-1.5 text-center" style={{ width: 60 }}>
          Un.
        </div>
        <div className="px-2 py-1.5 text-right tabular-nums" style={{ width: 110 }}>
          Qtd
        </div>
        <div className="px-2 py-1.5 text-right tabular-nums" style={{ width: 130 }}>
          Venda unit.
        </div>
        <div className="px-2 py-1.5 text-right tabular-nums" style={{ width: 130 }}>
          Venda total
        </div>
        <div className="px-2 py-1.5 text-right tabular-nums" style={{ width: 130 }}>
          Custo total
        </div>
        <div className="px-2 py-1.5 text-right tabular-nums" style={{ width: 80 }}>
          Lucr.%
        </div>
        <div className="px-2 py-1.5 text-center flex-1" style={{ minWidth: 80 }}>
          Ações
        </div>
      </div>

      {/* Lista virtualizada */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const node = visible[vi.index]
            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  height: ROW_HEIGHT
                }}
              >
                <PlanOrcRow
                  node={node}
                  obraId={obraId}
                  podeEditar={podeEditar}
                  isSelected={selectedIds.has(node.id)}
                  isExpanded={expandedIds.has(node.id)}
                  onToggle={() => toggleExpand(node.id)}
                  onToggleSelect={(e) => onToggleSelect(node.id, e)}
                  onOpen={() => onSelect(node.id)}
                  onNewChild={() => onNewChild(node)}
                  onMover={() => onMover(node)}
                />
              </div>
            )
          })}
        </div>
        {visible.length === 0 ? (
          <div className="p-8 text-center text-xs text-text-muted font-mono">
            Nenhum item ainda. Crie o primeiro índice ou receita raiz.
          </div>
        ) : null}
      </div>
    </div>
  )
}

interface RowProps {
  node: ItemTreeNode
  obraId: string
  podeEditar: boolean
  isSelected: boolean
  isExpanded: boolean
  onToggle: () => void
  onToggleSelect: (e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onOpen: () => void
  onNewChild: () => void
  onMover: () => void
}

const PlanOrcRow = memo(function PlanOrcRow({
  node,
  obraId,
  podeEditar,
  isSelected,
  isExpanded,
  onToggle,
  onToggleSelect,
  onOpen,
  onNewChild,
  onMover
}: RowProps): ReactNode {
  const upsert = useUpsertItem()
  const del = useDeleteItem()
  const reorder = useReorderItem()
  const isEtapa = node.tipo === 'etapa'
  const isServicoGrupo = node.tipo === 'servico_grupo'
  const isReceita = node.tipo === 'receita'
  const expandivel = isEtapa || isServicoGrupo
  const editavelQtdRefManual = isServicoGrupo && node.qtd_ref_modo === 'manual'

  const onChangeReceita =
    (field: 'quantidade' | 'venda_unitaria') =>
    async (val: string): Promise<void> => {
      const num = val.trim() === '' ? null : Number(val.replace(',', '.'))
      if (val.trim() !== '' && (num === null || isNaN(num))) throw new Error('inválido')
      await upsert.mutateAsync({ id: node.id, obra_id: obraId, tipo: node.tipo, [field]: num })
    }

  const onChangeQtdRef = async (val: string): Promise<void> => {
    const num = val.trim() === '' ? null : Number(val.replace(',', '.'))
    if (val.trim() !== '' && (num === null || isNaN(num))) throw new Error('inválido')
    await upsert.mutateAsync({
      id: node.id,
      obra_id: obraId,
      tipo: node.tipo,
      quantidade_referencia: num
    })
  }

  return (
    <div
      className={cn(
        'flex items-center border-b border-border/40 group',
        isSelected ? 'bg-accent-glow' : 'hover:bg-bg-hover',
        'h-7'
      )}
    >
      {/* Código + descrição (com indentação) */}
      <div
        className="px-2 flex items-center gap-1 truncate"
        style={{ width: 460, paddingLeft: `${node.depth * 14 + 4}px` }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="w-4 h-4 flex items-center justify-center text-text-dim hover:text-text"
          disabled={!expandivel}
        >
          {expandivel ? isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}
        </button>
        {isEtapa ? (
          <Folder size={11} className="text-text-muted shrink-0" />
        ) : isServicoGrupo ? (
          <Package size={11} className="text-accent shrink-0" />
        ) : (
          <FileText size={11} className="text-text-dim shrink-0" />
        )}
        <button
          type="button"
          onClick={(e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
              onToggleSelect({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey })
            } else {
              onOpen()
            }
          }}
          className={cn(
            'flex-1 text-left truncate text-xs font-mono',
            isEtapa
              ? 'font-semibold text-text uppercase tracking-wide'
              : isServicoGrupo
                ? 'font-semibold text-accent'
                : 'text-text'
          )}
          title={`${node.codigo} ${node.descricao}`}
        >
          <span className="text-text-dim mr-2">{node.codigo}</span>
          {node.descricao}
        </button>
        {isReceita && podeEditar ? (
          <button
            type="button"
            onClick={() => onToggleSelect()}
            title="Selecionar para agrupar"
            className={cn(
              'w-4 h-4 inline-flex items-center justify-center rounded border text-2xs',
              isSelected
                ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
                : 'border-border opacity-0 group-hover:opacity-100 hover:border-accent'
            )}
          >
            ✓
          </button>
        ) : null}
      </div>

      {/* Unidade */}
      <div className="px-2 text-2xs text-text-muted font-mono text-center" style={{ width: 60 }}>
        {isReceita
          ? (node.unidade ?? '—')
          : isServicoGrupo
            ? (node.unidade_referencia ?? '—')
            : '—'}
      </div>

      {/* Quantidade */}
      <div className="px-1" style={{ width: 110 }}>
        {isReceita ? (
          <PlanOrcInlineCell
            value={node.quantidade !== null ? String(node.quantidade) : ''}
            onCommit={onChangeReceita('quantidade')}
            qtd
            align="right"
            disabled={!podeEditar}
          />
        ) : isServicoGrupo ? (
          <PlanOrcInlineCell
            value={node.quantidade_referencia !== null ? String(node.quantidade_referencia) : ''}
            onCommit={onChangeQtdRef}
            qtd
            align="right"
            disabled={!podeEditar || !editavelQtdRefManual}
            placeholder={
              node.qtd_ref_modo === 'heranca'
                ? 'auto (herança)'
                : node.qtd_ref_modo === 'soma_filhos'
                  ? 'auto (soma)'
                  : 'qtd ref'
            }
          />
        ) : (
          <span className="text-text-dim text-xs font-mono pl-1">—</span>
        )}
      </div>

      {/* Venda unitária */}
      <div className="px-1" style={{ width: 130 }}>
        {isReceita ? (
          <PlanOrcInlineCell
            value={node.venda_unitaria !== null ? String(node.venda_unitaria) : ''}
            onCommit={onChangeReceita('venda_unitaria')}
            money
            align="right"
            disabled={!podeEditar}
          />
        ) : (
          <span className="text-text-dim text-xs font-mono pl-1">—</span>
        )}
      </div>

      {/* Venda total */}
      <div
        className="px-2 text-xs font-mono text-right tabular-nums text-text"
        style={{ width: 130 }}
      >
        {fmtBRL(node.venda_total_calc)}
      </div>

      {/* Custo total */}
      <div
        className="px-2 text-xs font-mono text-right tabular-nums text-text-muted"
        style={{ width: 130 }}
      >
        {fmtBRL(node.custo_total_calc)}
      </div>

      {/* Lucratividade */}
      <div
        className={cn(
          'px-2 text-xs font-mono text-right tabular-nums',
          node.lucratividade_perc_calc !== null && node.lucratividade_perc_calc < 0
            ? 'text-danger'
            : node.lucratividade_perc_calc !== null && node.lucratividade_perc_calc < 0.1
              ? 'text-warn'
              : 'text-success'
        )}
        style={{ width: 80 }}
      >
        {node.lucratividade_perc_calc !== null ? fmtPct2(node.lucratividade_perc_calc) : '—'}
      </div>

      {/* Ações */}
      <div
        className="px-2 text-center flex items-center justify-center gap-1 flex-1"
        style={{ minWidth: 80 }}
      >
        {podeEditar ? (
          <>
            {isEtapa || isServicoGrupo ? (
              <button
                type="button"
                onClick={onNewChild}
                title={
                  isServicoGrupo ? 'Adicionar receita ao grupo' : 'Adicionar filho neste índice'
                }
                className="w-5 h-5 flex items-center justify-center rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-bg-elevated"
              >
                <Plus size={11} />
              </button>
            ) : null}
            <Dropdown
              align="end"
              trigger={
                <button
                  type="button"
                  className="w-5 h-5 flex items-center justify-center rounded text-text-dim opacity-0 group-hover:opacity-100 hover:text-text hover:bg-bg-elevated"
                >
                  <MoreVertical size={11} />
                </button>
              }
            >
              <DropdownItem
                onClick={() => reorder.mutate({ id: node.id, obra_id: obraId, direction: 'up' })}
              >
                <ArrowUp size={11} /> Subir
              </DropdownItem>
              <DropdownItem
                onClick={() => reorder.mutate({ id: node.id, obra_id: obraId, direction: 'down' })}
              >
                <ArrowDown size={11} /> Descer
              </DropdownItem>
              <DropdownItem onClick={onMover}>
                <Move size={11} /> Mover para…
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  if (confirm(`Excluir "${node.codigo} ${node.descricao}" e tudo abaixo?`)) {
                    del.mutate({ id: node.id, obra_id: obraId })
                  }
                }}
              >
                <Trash2 size={11} /> Excluir
              </DropdownItem>
            </Dropdown>
          </>
        ) : null}
      </div>
    </div>
  )
})
