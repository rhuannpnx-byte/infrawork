import { useState, type ReactNode } from 'react'
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
}

export function ServicosTree({
  nodes,
  onAddChild,
  onSelect,
  selectedId,
  somenteFolhas
}: Props): ReactNode {
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
        />
      ))}
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
}

function ServicoRow({
  node,
  depth,
  onAddChild,
  onSelect,
  selectedId,
  somenteFolhas
}: RowProps): ReactNode {
  const [expanded, setExpanded] = useState(depth < 2)
  const toggleAtivo = useToggleAtivoServico()
  const temFilhos = node.children.length > 0
  const isFolha = node.unidade !== null
  const podeSelecionar = !somenteFolhas || isFolha

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 py-1 px-1 rounded hover:bg-bg-hover',
          selectedId === node.id ? 'bg-bg-active' : '',
          !node.ativo ? 'opacity-60' : ''
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="w-4 h-4 flex items-center justify-center text-text-dim hover:text-text"
          disabled={!temFilhos}
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
            podeSelecionar ? 'cursor-pointer hover:text-accent' : 'cursor-default text-text-muted'
          )}
        >
          <span className="text-text-dim mr-2">{node.codigo}</span>
          <span className="text-text">{node.nome}</span>
          {isFolha ? <span className="text-text-dim ml-2">({node.unidade})</span> : null}
        </button>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
          {!isFolha ? (
            <button
              type="button"
              onClick={() => onAddChild(node.id)}
              className="w-5 h-5 flex items-center justify-center text-text-dim hover:text-accent rounded hover:bg-bg-hover"
              title="Adicionar filho"
            >
              <Plus size={11} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => toggleAtivo.mutate({ id: node.id, ativo: !node.ativo })}
            className={cn(
              'w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover',
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
            />
          ))
        : null}
    </div>
  )
}
