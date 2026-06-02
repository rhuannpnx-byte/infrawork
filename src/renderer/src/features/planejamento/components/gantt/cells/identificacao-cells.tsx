// Cells do grupo "Identificação": NumeroCell, EapCell, DescricaoCell.
//
// As 3 são frozen (sticky-left no scroll horizontal). DescricaoCell carrega
// o ícone do tipo_no (Folder/CheckSquare/Flag), indent por depth e o chevron
// twisty quando hasChildren.

import { type ReactNode } from 'react'
import { ChevronRight, Folder, CheckSquare, Flag, GripVertical, Anchor } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InlineCell } from '@/components/InlineCell'
import { CONSTRAINT_LABEL } from '@/types/planejamento'
import type { CellProps } from './types'

// ─── NumeroCell ────────────────────────────────────────────────────────────
// Mostra a numeração sequencial (1, 2, 3...) MS Project-style. O ícone
// GripVertical é o drag handle pra reordenação vertical (handler de drag
// fica no GridRow). Sempre visível em modo editável — sem hover-only — pra
// dar affordance clara de que a linha pode ser arrastada.
export function NumeroCell({ node, ctx }: CellProps): ReactNode {
  const critico = node.is_critico
  const numero = ctx.numeroById.get(node.id) ?? '?'
  return (
    <div
      data-drag-handle
      title={ctx.readOnly ? undefined : 'Arraste para reordenar'}
      className={cn(
        'flex items-center justify-end gap-1 h-full px-1 select-none',
        ctx.readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      )}
    >
      {!ctx.readOnly && (
        <GripVertical
          size={12}
          className="text-text-dim hover:text-text shrink-0 transition-colors"
        />
      )}
      <span
        className={cn(
          'text-2xs font-mono tabular-nums',
          critico ? 'text-danger font-semibold' : 'text-text-muted'
        )}
      >
        {numero}
      </span>
    </div>
  )
}

// ─── EapCell ───────────────────────────────────────────────────────────────
// Código hierárquico ("1.2.3"). Read-only; vem da view via codigo_eap ou
// derivado client-side. Fallback: codigo do servico_grupo.
export function EapCell({ node }: CellProps): ReactNode {
  const codigo = node.codigo_eap ?? node.servico_grupo_codigo ?? '—'
  return (
    <div className="flex items-center h-full px-1 text-2xs font-mono text-text-dim">
      {codigo}
    </div>
  )
}

// ─── DescricaoCell ─────────────────────────────────────────────────────────
// Coluna mais importante: ícone por tipo + indent por depth + chevron de
// expansão (em grupos) + nome editável inline (para grupos/marcos; tarefas
// folha não permitem editar nome aqui — fica no orçamento).
interface DescricaoCellProps extends CellProps {
  expanded: boolean
  onToggleExpand: () => void
}
export function DescricaoCell({
  node,
  ctx,
  expanded,
  onToggleExpand
}: DescricaoCellProps): ReactNode {
  const tipo = node.tipo_no
  const indent = node.depth * 14

  // Ícone por tipo
  const Icon = tipo === 'grupo' ? Folder : tipo === 'marco' ? Flag : CheckSquare
  const iconColor =
    tipo === 'grupo'
      ? 'text-text-muted'
      : tipo === 'marco'
        ? 'text-milestone'
        : node.is_critico
          ? 'text-danger'
          : 'text-accent'

  const nome = node.nome_custom ?? node.servico_grupo_descricao ?? ''
  // Tarefa-folha não edita nome aqui (vem do item orçamentário); grupos/marcos sim.
  const editavel = !ctx.readOnly && (tipo === 'grupo' || tipo === 'marco')

  const hasConstraint = node.constraint_type != null
  const isAlap = node.schedule_mode === 'alap'

  return (
    <div className="flex items-center h-full pr-1 gap-1 min-w-0" style={{ paddingLeft: indent + 4 }}>
      {node.hasChildren ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="shrink-0 text-text-dim hover:text-text"
          title={expanded ? 'Colapsar' : 'Expandir'}
        >
          <ChevronRight
            size={11}
            className={cn('transition-transform', expanded && 'rotate-90')}
          />
        </button>
      ) : (
        <span className="shrink-0 w-[11px]" />
      )}
      <Icon size={11} className={cn('shrink-0', iconColor)} />
      {editavel ? (
        <InlineCell
          value={nome}
          onCommit={async (v) => {
            await ctx.commitNomeCustom(node.id, v.trim())
          }}
          placeholder={tipo === 'grupo' ? 'Nome do grupo' : 'Nome do marco'}
          className={cn('flex-1 min-w-0', tipo === 'grupo' && 'font-semibold')}
        />
      ) : (
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-xs',
            tipo === 'grupo' && 'font-semibold text-text',
            tipo === 'marco' && 'text-milestone',
            tipo === 'tarefa' && 'text-text'
          )}
          title={nome}
        >
          {nome || <span className="text-text-faint italic">(sem nome)</span>}
        </span>
      )}
      {hasConstraint ? (
        <span
          className="shrink-0 inline-flex items-center"
          title={`${CONSTRAINT_LABEL[node.constraint_type!]}${node.constraint_date ? ` ${node.constraint_date}` : ''}`}
          aria-label="Restrição"
        >
          <Anchor size={10} className="text-accent" />
        </span>
      ) : null}
      {isAlap ? (
        <span
          className="shrink-0 text-[9px] font-mono text-text-dim border border-border rounded px-1"
          title="O mais tarde possível"
        >
          ALAP
        </span>
      ) : null}
    </div>
  )
}
