import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Plus, Power, Folder, FileText } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { contar } from '@/lib/rotulos'
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
  /** Esconde as ações de linha (adicionar dentro do grupo, desativar). */
  somenteLeitura?: boolean
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
  onToggleSelect,
  somenteLeitura
}: Props): ReactNode {
  const filterResult = useMemo(
    () => (filter ? computeMatchedSet(nodes, filter) : null),
    [nodes, filter]
  )
  return (
    <div className="text-sm">
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
          somenteLeitura={somenteLeitura}
        />
      ))}
      {filterResult && filterResult.matched.size === 0 ? (
        <p className="px-2 py-3 text-sm text-text-muted">
          Nenhum serviço corresponde a “{filter}”. Confira o código ou o nome digitado.
        </p>
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
  somenteLeitura?: boolean
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
  onToggleSelect,
  somenteLeitura
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

  const marcado = selectedIds?.has(node.id) ?? false
  const rotuloNo = `${node.codigo} ${node.nome}`

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 py-0.5 px-1 rounded relative',
          'hover:bg-bg-hover',
          selectedId === node.id ? 'bg-bg-active' : '',
          matchedDirect ? 'ring-1 ring-accent/40' : ''
        )}
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        {/* Linha guia vertical da hierarquia (depth > 0) */}
        {depth > 0 ? (
          <span
            aria-hidden
            className="absolute top-0 bottom-0 border-l border-border pointer-events-none"
            style={{ left: `${(depth - 1) * 20 + 10}px` }}
          />
        ) : null}

        {/* Checkbox de seleção em lote (quando habilitado). */}
        {selectedIds && onToggleSelect ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={marcado}
            aria-label={`Selecionar ${rotuloNo}`}
            title={marcado ? 'Desmarcar' : 'Selecionar'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect(node.id)
            }}
            className="h-7 w-6 inline-flex items-center justify-center rounded shrink-0 group/caixa"
          >
            <span
              aria-hidden
              className={cn(
                'size-4 inline-flex items-center justify-center rounded-sm border',
                marcado
                  ? 'border-accent bg-accent text-[color:var(--on-accent)]'
                  : 'border-border-strong bg-bg-panel group-hover/caixa:border-accent'
              )}
            >
              {marcado ? <Check size={12} strokeWidth={3} /> : null}
            </span>
          </button>
        ) : null}

        {temFilhos ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${rotuloNo}`}
            title={expanded ? 'Recolher' : 'Expandir'}
            className="h-7 w-6 shrink-0 inline-flex items-center justify-center rounded text-text-muted hover:text-text hover:bg-bg-hover"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span aria-hidden className="w-6 shrink-0" />
        )}
        {isFolha ? (
          <FileText size={14} aria-hidden className="text-text-dim shrink-0" />
        ) : (
          <Folder size={14} aria-hidden className="text-accent shrink-0" />
        )}
        <button
          type="button"
          onClick={() => {
            if (podeSelecionar) onSelect?.(node.id)
            // Grupo não abre painel: o clique no nome abre ou recolhe os filhos.
            if (!isFolha && temFilhos) toggle()
          }}
          title={isFolha && podeSelecionar ? 'Abrir as composições do serviço' : undefined}
          className={cn(
            'flex-1 min-w-0 h-7 text-left truncate rounded',
            !node.ativo ? 'text-text-muted' : 'text-text',
            isFolha
              ? podeSelecionar
                ? 'cursor-pointer hover:text-accent hover:underline'
                : 'cursor-default'
              : 'cursor-pointer font-semibold'
          )}
        >
          <span className="tabular text-text-dim mr-2">{node.codigo}</span>
          <span>{node.nome}</span>
          {isFolha ? (
            <span className="text-text-muted ml-2 font-normal">({node.unidade})</span>
          ) : temFilhos ? (
            <span
              className="tabular text-text-muted ml-2 font-normal text-xs"
              title={contar(node.children.length, 'item no grupo', 'itens no grupo')}
            >
              ({node.children.length})
            </span>
          ) : null}
          {!node.ativo ? (
            <span className="ml-2 text-xs font-semibold text-warn">Inativo</span>
          ) : null}
        </button>
        {somenteLeitura ? null : (
          <div className="flex items-center gap-0.5">
            {!isFolha ? (
              <IconButton
                size="sm"
                variant="accent"
                onClick={() => onAddChild(node.id)}
                aria-label={`Adicionar serviço dentro de ${rotuloNo}`}
                title="Adicionar serviço dentro deste grupo"
              >
                <Plus size={14} aria-hidden />
              </IconButton>
            ) : null}
            <IconButton
              size="sm"
              variant="ghost"
              disabled={toggleAtivo.isPending}
              onClick={() => toggleAtivo.mutate({ id: node.id, ativo: !node.ativo })}
              className={node.ativo ? undefined : 'text-warn'}
              aria-label={`${node.ativo ? 'Desativar' : 'Reativar'} ${rotuloNo}`}
              title={node.ativo ? 'Desativar' : 'Reativar'}
            >
              <Power size={14} aria-hidden />
            </IconButton>
          </div>
        )}
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
              somenteLeitura={somenteLeitura}
            />
          ))
        : null}
    </div>
  )
}
