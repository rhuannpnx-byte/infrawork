import {
  memo,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
  Filter,
  Plus,
  Trash2,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Move,
  Split,
  Unlink
} from 'lucide-react'
import { toast } from 'sonner'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import { Popover } from '@/components/ui/popover'
import { fmtBRL, fmtPct2, parseBR } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useDeleteItem, useReorderItem, useUpsertItem } from '../hooks/plan-orc'
import { PlanOrcInlineCell } from './PlanOrcInlineCell'
import { AlocacaoGlyph } from './AlocacaoGlyph'
import { DRAG_RECEITAS } from '../lib/alocacao-ui'
import {
  ALOC_STATUS_LABEL,
  type AlocInfo,
  type AlocStatus,
  type ItemTreeNode
} from '@/types/orcamento'
import { useConfirm } from '@/components/modals/ConfirmDialog'

interface Props {
  obraId: string
  flat: ItemTreeNode[]
  /** Editar a planilha de venda (quantidade, preço, itens). */
  podeEditar: boolean
  /** Agrupar/ratear esta receita (com a cadeia travada: só receitas de aditivo). */
  podeAlocar: (node: ItemTreeNode) => boolean
  selectedIds: Set<string>
  /** Setter direto do estado de seleção — usado pelo "selecionar todos" no header. */
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>
  onToggleSelect: (
    id: string,
    e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  ) => void
  onSelect: (id: string) => void
  onNewChild: (parent: ItemTreeNode | null) => void
  onMover: (node: ItemTreeNode) => void
  expandedIds: Set<string>
  setExpandedIds: (next: Set<string>) => void
  /** Situação de alocação por receita/etapa. */
  alocInfo: Map<string, AlocInfo>
  /** Filtro da coluna de alocação (vazio = todos). */
  filtroAloc: Set<AlocStatus>
  setFiltroAloc: (next: Set<AlocStatus>) => void
  /** Receitas do serviço destacado no painel → fração (null = sem destaque). */
  destaque: Map<string, number> | null
  onRatear: (node: ItemTreeNode) => void
  onRemoverAlocacao: (node: ItemTreeNode) => void
}

const ROW_HEIGHT = 28
const FILTROS: AlocStatus[] = ['sem', 'saldo', 'rateado', 'unico']

export function PlanOrcTree({
  obraId,
  flat,
  podeEditar,
  podeAlocar,
  selectedIds,
  setSelectedIds,
  onToggleSelect,
  onSelect,
  onNewChild,
  onMover,
  expandedIds,
  setExpandedIds,
  alocInfo,
  filtroAloc,
  setFiltroAloc,
  destaque,
  onRatear,
  onRemoverAlocacao
}: Props): ReactNode {
  const parentRef = useRef<HTMLDivElement>(null)
  const [filtroAberto, setFiltroAberto] = useState(false)

  // Filtro por situação de alocação: receitas que batem + seus ancestrais.
  const permitidos = useMemo(() => {
    if (filtroAloc.size === 0) return null
    const byId = new Map(flat.map((n) => [n.id, n]))
    const ok = new Set<string>()
    for (const n of flat) {
      if (n.tipo !== 'receita') continue
      const st = alocInfo.get(n.id)?.status ?? 'sem'
      if (!filtroAloc.has(st)) continue
      let cur: ItemTreeNode | undefined = n
      while (cur && !ok.has(cur.id)) {
        ok.add(cur.id)
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
      }
    }
    return ok
  }, [flat, alocInfo, filtroAloc])

  // Esconde filhos de etapas recolhidas (e, com filtro, o que não bate)
  const visible = useMemo(() => {
    const out: ItemTreeNode[] = []
    let hideUntilDepth: number | null = null
    for (const node of flat) {
      if (hideUntilDepth !== null) {
        if (node.depth > hideUntilDepth) continue
        hideUntilDepth = null
      }
      if (permitidos && !permitidos.has(node.id)) continue
      out.push(node)
      if (node.tipo === 'etapa' && !expandedIds.has(node.id)) hideUntilDepth = node.depth
    }
    return out
  }, [flat, expandedIds, permitidos])

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

  // Tri-state do checkbox "selecionar todos" — baseado em itens VISÍVEIS
  const visibleIds = useMemo(() => visible.map((n) => n.id), [visible])
  const visibleSelectedCount = useMemo(
    () => visibleIds.reduce((acc, id) => acc + (selectedIds.has(id) ? 1 : 0), 0),
    [visibleIds, selectedIds]
  )
  const headerSelectState: 'none' | 'some' | 'all' =
    visibleSelectedCount === 0
      ? 'none'
      : visibleSelectedCount === visibleIds.length
        ? 'all'
        : 'some'
  const onToggleSelectAll = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (visibleSelectedCount === visibleIds.length && visibleIds.length > 0) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  // Arrastar: a receita (ou todas as receitas selecionadas, se ela estiver na seleção)
  const receitasSelecionadas = useMemo(
    () => flat.filter((n) => n.tipo === 'receita' && selectedIds.has(n.id)).map((n) => n.id),
    [flat, selectedIds]
  )
  const onDragStart = (e: DragEvent, node: ItemTreeNode): void => {
    const ids =
      selectedIds.has(node.id) && receitasSelecionadas.length > 0 ? receitasSelecionadas : [node.id]
    e.dataTransfer.setData(DRAG_RECEITAS, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const toggleFiltro = (st: AlocStatus): void => {
    const next = new Set(filtroAloc)
    if (next.has(st)) next.delete(st)
    else next.add(st)
    setFiltroAloc(next)
  }

  return (
    <div data-density="compact" className="flex flex-col h-full">
      <div className="flex items-center text-2xs font-mono uppercase tracking-wider text-text-dim bg-bg-elevated border-b border-border sticky top-0 z-10">
        <div
          className="px-2 py-1.5 flex items-center justify-center"
          style={{ width: 32 }}
          title={
            podeEditar
              ? headerSelectState === 'all'
                ? 'Desmarcar todos visíveis'
                : 'Selecionar todos visíveis'
              : undefined
          }
        >
          {podeEditar ? (
            <button
              type="button"
              onClick={onToggleSelectAll}
              disabled={visibleIds.length === 0}
              className={cn(
                'w-4 h-4 inline-flex items-center justify-center rounded border text-2xs',
                headerSelectState === 'all'
                  ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
                  : headerSelectState === 'some'
                    ? 'border-accent bg-accent/40 text-[color:var(--primary-foreground)]'
                    : 'border-border-strong hover:border-accent text-text-faint'
              )}
            >
              {headerSelectState === 'all' ? '✓' : headerSelectState === 'some' ? '−' : ''}
            </button>
          ) : null}
        </div>
        {/* Alocação: filtro */}
        <div className="flex items-center justify-center" style={{ width: 26 }}>
          <Popover
            open={filtroAberto}
            onOpenChange={setFiltroAberto}
            trigger={
              <button
                type="button"
                onClick={() => setFiltroAberto((o) => !o)}
                title="Filtrar por situação de agrupamento"
                className={cn(
                  'w-5 h-5 grid place-items-center rounded hover:bg-bg-hover',
                  filtroAloc.size > 0 ? 'text-accent' : 'text-text-dim'
                )}
              >
                <Filter size={12} className={filtroAloc.size > 0 ? 'fill-current' : ''} />
              </button>
            }
            className="w-[220px] p-1 normal-case tracking-normal font-sans"
          >
            <div className="px-2 py-1 text-2xs text-text-dim">Mostrar receitas</div>
            {FILTROS.map((st) => (
              <label
                key={st}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text hover:bg-bg-hover cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={filtroAloc.has(st)}
                  onChange={() => toggleFiltro(st)}
                  className="accent-[var(--accent)]"
                />
                <AlocacaoGlyph info={exemplo(st)} />
                {ALOC_STATUS_LABEL[st]}
              </label>
            ))}
            {filtroAloc.size > 0 ? (
              <button
                type="button"
                onClick={() => setFiltroAloc(new Set())}
                className="w-full text-left px-2 py-1.5 text-2xs text-accent hover:underline"
              >
                Limpar filtro
              </button>
            ) : null}
          </Popover>
        </div>
        <div className="px-2 py-1.5" style={{ width: 410 }}>
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
                  podeAlocar={podeAlocar(node)}
                  isSelected={selectedIds.has(node.id)}
                  isExpanded={expandedIds.has(node.id)}
                  info={alocInfo.get(node.id)}
                  destaque={destaque ? (destaque.get(node.id) ?? null) : null}
                  emDestaque={destaque !== null}
                  onToggle={() => toggleExpand(node.id)}
                  onToggleSelect={(e) => onToggleSelect(node.id, e)}
                  onOpen={() => onSelect(node.id)}
                  onNewChild={() => onNewChild(node)}
                  onMover={() => onMover(node)}
                  onRatear={() => onRatear(node)}
                  onRemoverAlocacao={() => onRemoverAlocacao(node)}
                  onDragStart={(e) => onDragStart(e, node)}
                />
              </div>
            )
          })}
        </div>
        {visible.length === 0 ? (
          <div className="p-8 text-center text-xs text-text-muted font-mono">
            {filtroAloc.size > 0
              ? 'Nenhuma receita nessa situação.'
              : 'Nenhum item ainda. Crie o primeiro índice ou receita raiz.'}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Info fictícia só para desenhar o símbolo de cada filtro. */
function exemplo(st: AlocStatus): AlocInfo {
  if (st === 'rateado')
    return {
      status: 'rateado',
      fracao: 1,
      destinos: [0.6, 0.4].map((f) => ({
        servico: { id: '', codigo: '', descricao: '' } as never,
        alocacao: { fracao: f } as never
      }))
    }
  return { status: st, fracao: st === 'saldo' ? 0.6 : st === 'unico' ? 1 : 0, destinos: [] }
}

interface RowProps {
  node: ItemTreeNode
  obraId: string
  podeEditar: boolean
  podeAlocar: boolean
  isSelected: boolean
  isExpanded: boolean
  info: AlocInfo | undefined
  /** Fração desta receita no serviço destacado (null = não pertence). */
  destaque: number | null
  /** Há um serviço destacado no painel. */
  emDestaque: boolean
  onToggle: () => void
  onToggleSelect: (e?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onOpen: () => void
  onNewChild: () => void
  onMover: () => void
  onRatear: () => void
  onRemoverAlocacao: () => void
  onDragStart: (e: DragEvent) => void
}

const PlanOrcRow = memo(function PlanOrcRow({
  node,
  obraId,
  podeEditar,
  podeAlocar,
  isSelected,
  isExpanded,
  info,
  destaque,
  emDestaque,
  onToggle,
  onToggleSelect,
  onOpen,
  onNewChild,
  onMover,
  onRatear,
  onRemoverAlocacao,
  onDragStart
}: RowProps): ReactNode {
  const upsert = useUpsertItem()
  const del = useDeleteItem()
  const reorder = useReorderItem()
  const confirm = useConfirm()
  const isEtapa = node.tipo === 'etapa'
  const isReceita = node.tipo === 'receita'
  const alocada = isReceita && (info?.destinos.length ?? 0) > 0

  const onChangeReceita =
    (field: 'quantidade' | 'venda_unitaria') =>
    async (val: string): Promise<void> => {
      const num = val.trim() === '' ? null : parseBR(val).toNumber()
      if (val.trim() !== '' && (num === null || isNaN(num))) throw new Error('inválido')
      await upsert.mutateAsync({ id: node.id, obra_id: obraId, tipo: node.tipo, [field]: num })
    }

  return (
    <div
      draggable={podeAlocar && isReceita}
      onDragStart={isReceita ? onDragStart : undefined}
      className={cn(
        'flex items-center border-b border-border group h-7 border-l-2',
        isSelected ? 'bg-accent-glow' : 'hover:bg-bg-hover',
        destaque !== null ? 'border-l-accent bg-accent-glow' : 'border-l-transparent',
        emDestaque && destaque === null && isReceita && 'opacity-60'
      )}
    >
      {/* Seleção */}
      <div className="px-2 flex items-center justify-center" style={{ width: 32 }}>
        {podeEditar || podeAlocar ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey })
            }}
            title={isReceita ? 'Selecionar (agrupar / excluir)' : 'Selecionar (excluir em lote)'}
            className={cn(
              'w-4 h-4 inline-flex items-center justify-center rounded border text-2xs',
              isSelected
                ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
                : 'border-border text-text-faint hover:border-accent hover:text-text-dim'
            )}
          >
            {isSelected ? '✓' : ''}
          </button>
        ) : null}
      </div>
      {/* Alocação */}
      <div className="flex items-center justify-center" style={{ width: 26 }}>
        <AlocacaoGlyph info={info} />
      </div>
      {/* Código + descrição (com indentação) */}
      <div
        className="px-2 flex items-center gap-1 truncate"
        style={{ width: 410, paddingLeft: `${node.depth * 14 + 4}px` }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="w-4 h-4 flex items-center justify-center text-text-dim hover:text-text"
          disabled={!isEtapa}
        >
          {isEtapa ? isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
        </button>
        {isEtapa ? (
          <Folder size={12} className="text-text-muted shrink-0" />
        ) : (
          <FileText size={12} className="text-text-dim shrink-0" />
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
            isEtapa ? 'font-semibold text-text uppercase tracking-wide' : 'text-text'
          )}
          title={`${node.codigo} ${node.descricao}`}
        >
          <span className="text-text-dim mr-2">{node.codigo}</span>
          {node.descricao}
        </button>
        {node.aditivo_id ? (
          <span
            className="shrink-0 rounded border border-accent-line px-1 text-2xs font-mono text-accent"
            title="Item incluído por aditivo"
          >
            aditivo
          </span>
        ) : null}
        {destaque !== null ? (
          <span className="shrink-0 rounded px-1 text-2xs font-mono bg-accent text-[color:var(--primary-foreground)]">
            {fmtPct2(destaque)}
          </span>
        ) : null}
      </div>

      {/* Unidade */}
      <div className="px-2 text-2xs text-text-muted font-mono text-center" style={{ width: 60 }}>
        {isReceita ? (node.unidade ?? '—') : '—'}
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

      {/* Custo total (apropriado dos serviços) */}
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
            {isEtapa ? (
              <button
                type="button"
                onClick={onNewChild}
                title="Adicionar filho neste índice"
                className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-accent hover:bg-bg-elevated"
              >
                <Plus size={12} />
              </button>
            ) : null}
            <Dropdown
              align="end"
              trigger={
                <button
                  type="button"
                  className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-text hover:bg-bg-elevated"
                >
                  <MoreVertical size={12} />
                </button>
              }
            >
              {isReceita ? (
                <DropdownItem onClick={onRatear}>
                  <Split size={12} /> {alocada ? 'Editar rateio…' : 'Ratear…'}
                </DropdownItem>
              ) : null}
              {alocada ? (
                <DropdownItem onClick={onRemoverAlocacao}>
                  <Unlink size={12} /> Remover alocação
                </DropdownItem>
              ) : null}
              <DropdownItem
                onClick={() => reorder.mutate({ id: node.id, obra_id: obraId, direction: 'up' })}
              >
                <ArrowUp size={12} /> Subir
              </DropdownItem>
              <DropdownItem
                onClick={() => reorder.mutate({ id: node.id, obra_id: obraId, direction: 'down' })}
              >
                <ArrowDown size={12} /> Descer
              </DropdownItem>
              <DropdownItem onClick={onMover}>
                <Move size={12} /> Mover para…
              </DropdownItem>
              <DropdownItem
                onClick={async () => {
                  if (alocada) {
                    toast.error('Receita alocada em serviço — remova a alocação antes de excluir.')
                    return
                  }
                  const ok = await confirm({
                    title: `Excluir "${node.codigo} ${node.descricao}"?`,
                    description: isEtapa
                      ? 'Todos os itens abaixo (filhos) também serão excluídos.'
                      : 'A receita será excluída da planilha de venda.',
                    confirmLabel: 'Excluir',
                    variant: 'danger'
                  })
                  if (ok)
                    del.mutate(
                      { id: node.id, obra_id: obraId },
                      {
                        onError: (err) => toast.error(err.message)
                      }
                    )
                }}
              >
                <Trash2 size={12} /> Excluir
              </DropdownItem>
            </Dropdown>
          </>
        ) : podeAlocar && isReceita ? (
          <Dropdown
            align="end"
            trigger={
              <button
                type="button"
                className="w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-text hover:bg-bg-elevated"
              >
                <MoreVertical size={12} />
              </button>
            }
          >
            <DropdownItem onClick={onRatear}>
              <Split size={12} /> {alocada ? 'Editar rateio…' : 'Ratear…'}
            </DropdownItem>
            {alocada ? (
              <DropdownItem onClick={onRemoverAlocacao}>
                <Unlink size={12} /> Remover alocação
              </DropdownItem>
            ) : null}
          </Dropdown>
        ) : null}
      </div>
    </div>
  )
})
