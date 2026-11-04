import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Plus, Power, Folder, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToggleAtivoServico } from '../hooks/servicos'
import type { ServicoTreeNode } from '@/types/orcamento'

interface Props {
  nodes: ServicoTreeNode[]
  onAddChild: (parentId: string | null) => void
  onSelect?: (id: string) => void
  selectedId?: string | null
  /** Mostra apenas folhas (serviços com unidade). Útil pra seleção. */
  somenteFolhas?: boolean
  /** Termo de busca (case-insensitive). Filtra nós + ancestrais pra preservar contexto. */
  filter?: string
  /** Set controlado de IDs expandidos. Quando null/undefined, cada linha gerencia o próprio estado. */
  expandedIds?: Set<string> | null
  /** Notificação de toggle (modo controlado). */
  onToggleExpand?: (id: string) => void
  /** Seleção em lote (checkbox por linha). Null = desabilitado. */
  selectedIds?: Set<string> | null
  onToggleSelect?: (id: string) => void
}

/**
 * Computa o subconjunto de nós que matcham o filtro + seus ancestrais.
 * Retorna `null` se não há filtro (mostra tudo).
 */
function computeMatchedSet(
  nodes: ServicoTreeNode[],
  filter: string
): { matched: Set<string>; ancestors: Set<string> } | null {
  const term = filter.trim().toLowerCase()
  if (!term) return null
  const matched = new Set<string>()
  const ancestors = new Set<string>()
  const walk = (n: ServicoTreeNode, path: ServicoTreeNode[]): void => {
    const hit = n.codigo.toLowerCase().includes(term) || n.nome.toLowerCase().includes(term)
    if (hit) {
      matched.add(n.id)
      for (const p of path) ancestors.add(p.id)
    }
    for (const c of n.children) walk(c, [...path, n])
  }
  for (const root of nodes) walk(root, [])
  return { matched, ancestors }
}

export function ServicosTree({
  nodes,
  onAddChild,
  onSelect,
  selectedId,
  somenteFolhas,
  filter,
  expandedIds,
  onToggleExpand,
  selectedIds,
  onToggleSelect
}: Props): ReactNode {
  const filterResult = useMemo(
    () => (filter ? computeMatchedSet(nodes, filter) : null),
    [nodes, filter]
  )
  return (
    <div className="text-xs font-mono">
      {nodes.map((n) => (
        <ServicoRow
          key={n.id}
          node={n}
          depth={0}
          onAddChild={onAddChild}
          onSelect={onSelect}
          selectedId={selectedId}
          somenteFolhas={somenteFolhas}
          filterResult={filterResult}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
        />
      ))}
      {filterResult && filterResult.matched.size === 0 ? (
        <div className="text-2xs text-text-dim italic px-2 py-3">
          Nenhum serviço corresponde a “{filter}”.
        </div>
      ) : null}
    </div>
  )
}

interface RowProps {
  node: ServicoTreeNode
  depth: number
  onAddChild: (parentId: string | null) => void
  onSelect?: (id: string) => void
  selectedId?: string | null
  somenteFolhas?: boolean
  filterResult: { matched: Set<string>; ancestors: Set<string> } | null
  expandedIds?: Set<string> | null
  onToggleExpand?: (id: string) => void
  selectedIds?: Set<string> | null
  onToggleSelect?: (id: string) => void
}

function ServicoRow({
  node,
  depth,
  onAddChild,
  onSelect,
  selectedId,
  somenteFolhas,
  filterResult,
  expandedIds,
  onToggleExpand,
  selectedIds,
  onToggleSelect
}: RowProps): ReactNode {
  const controlled = expandedIds != null
  const [localExpanded, setLocalExpanded] = useState(depth < 2)
  const expanded = controlled ? expandedIds!.has(node.id) : localExpanded
  const toggleAtivo = useToggleAtivoServico()
  const temFilhos = node.children.length > 0
  const isFolha = node.unidade !== null
  const podeSelecionar = !somenteFolhas || isFolha

  // Filtro: pula linha que não match nem é ancestral de match.
  if (filterResult) {
    const visivel = filterResult.matched.has(node.id) || filterResult.ancestors.has(node.id)
    if (!visivel) return null
  }

  const toggle = (): void => {
    if (controlled) onToggleExpand?.(node.id)
    else setLocalExpanded((e) => !e)
  }

  const matchedDirect = filterResult?.matched.has(node.id) ?? false

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 py-1 px-1 rounded relative',
          // Bg distinto por tipo de nó:
          !isFolha ? 'bg-bg-elevated/30' : '',
          // Hover sólido (sem transparência).
          'hover:bg-bg-hover',
          selectedId === node.id ? 'bg-bg-active' : '',
          matchedDirect ? 'ring-1 ring-accent/40' : '',
          !node.ativo ? 'opacity-60' : ''
        )}
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        {/* Linha guia vertical da hierarquia (depth > 0) */}
        {depth > 0 ? (
          <span
            aria-hidden
            className="absolute top-0 bottom-0 border-l border-border/60 pointer-events-none"
            style={{ left: `${(depth - 1) * 20 + 10}px` }}
          />
        ) : null}

        {/* Checkbox de seleção em lote (quando habilitado). */}
        {selectedIds && onToggleSelect ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect(node.id)
            }}
            className={cn(
              'w-4 h-4 inline-flex items-center justify-center rounded border text-2xs shrink-0',
              selectedIds.has(node.id)
                ? 'border-accent bg-accent text-[color:var(--primary-foreground)]'
                : 'border-border text-text-faint hover:border-accent hover:text-text-dim'
            )}
            title={selectedIds.has(node.id) ? 'Desmarcar' : 'Selecionar'}
          >
            {selectedIds.has(node.id) ? '✓' : ''}
          </button>
        ) : null}

        <button
          type="button"
          onClick={toggle}
          className={cn(
            'w-4 h-4 flex items-center justify-center text-text-dim hover:text-text',
            !temFilhos && 'invisible'
          )}
          disabled={!temFilhos}
          title={temFilhos ? (expanded ? 'Colapsar' : 'Expandir') : undefined}
        >
          {temFilhos ? expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}
        </button>
        {isFolha ? (
          <FileText size={11} className="text-text-dim shrink-0" />
        ) : (
          <Folder size={11} className="text-accent shrink-0" />
        )}
        <button
          type="button"
          onClick={() => podeSelecionar && onSelect?.(node.id)}
          className={cn(
            'flex-1 text-left truncate',
            podeSelecionar
              ? isFolha
                ? 'cursor-pointer hover:text-accent hover:underline'
                : 'cursor-pointer hover:text-text font-semibold'
              : 'cursor-default text-text-muted',
            !isFolha && 'text-text font-semibold'
          )}
        >
          <span className="text-text-dim mr-2">{node.codigo}</span>
          <span>{node.nome}</span>
          {isFolha ? (
            <span className="text-text-dim ml-2 font-normal">({node.unidade})</span>
          ) : temFilhos ? (
            <span className="text-text-faint ml-2 font-normal text-2xs">
              ({node.children.length})
            </span>
          ) : null}
          {!node.ativo ? (
            <span className="ml-2 text-warn text-2xs font-normal">· inativo</span>
          ) : null}
        </button>
        {/* Ações sempre visíveis (mutadas por default, realçam ao hover do próprio botão). */}
        <div className="flex items-center gap-0.5">
          {!isFolha ? (
            <button
              type="button"
              onClick={() => onAddChild(node.id)}
              className="w-5 h-5 flex items-center justify-center text-text-dim hover:text-accent rounded hover:bg-bg-elevated"
              title="Adicionar filho"
            >
              <Plus size={11} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => toggleAtivo.mutate({ id: node.id, ativo: !node.ativo })}
            className={cn(
              'w-5 h-5 flex items-center justify-center rounded hover:bg-bg-elevated',
              node.ativo ? 'text-text-dim hover:text-warn' : 'text-warn hover:text-text-muted'
            )}
            title={node.ativo ? 'Desativar' : 'Reativar'}
          >
            <Power size={11} />
          </button>
        </div>
      </div>
      {expanded && temFilhos
        ? node.children.map((c) => (
            <ServicoRow
              key={c.id}
              node={c}
              depth={depth + 1}
              onAddChild={onAddChild}
              onSelect={onSelect}
              selectedId={selectedId}
              somenteFolhas={somenteFolhas}
              filterResult={filterResult}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))
        : null}
    </div>
  )
}
