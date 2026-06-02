// Cells do grupo "Alocação": EquipesCell, PredecessorasCell, NotasCell.
//
// Equipes: pills com sigla + cor + X para remover. "+" abre popover.
// Predecessoras: pills "NN FS +5d" + X para remover. "+" abre dialog existente.
// Notas: ícone FileText (highlight se tem notas) — abre NotasModal.

import { useRef, type ReactNode } from 'react'
import { Plus, X, FileText, MessageSquareText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PredecessoraRef } from '@/types/planejamento'
import type { CellProps } from './types'

// ─── EquipesCell ───────────────────────────────────────────────────────────
export function EquipesCell({ node, ctx }: CellProps): ReactNode {
  const btnRef = useRef<HTMLButtonElement>(null)
  if (node.tipo_no !== 'tarefa') {
    return <Dash />
  }
  const equipes = node.equipes ?? []
  const onAdd = (): void => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) ctx.abrirAddEquipe(node.id, rect)
  }
  return (
    <div className="flex items-center gap-1 h-full px-1 overflow-hidden">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto min-w-0 scrollbar-hide">
        {equipes.map((e) => (
          <span
            key={e.id}
            className={cn(
              'inline-flex items-center gap-1 h-5 pl-1 pr-0.5 rounded-sm shrink-0',
              'text-2xs font-mono border'
            )}
            style={{
              borderColor: `${e.cor}55`,
              backgroundColor: `${e.cor}22`,
              color: e.cor
            }}
            title={`${e.nome} · ${e.tipo}${e.qtd_equipes > 1 ? ` × ${e.qtd_equipes}` : ''}`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: e.cor }} />
            <span className="max-w-[64px] truncate">{e.nome}</span>
            {e.qtd_equipes > 1 && <span className="opacity-70">×{e.qtd_equipes}</span>}
            {!ctx.readOnly && (
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation()
                  ctx.removerEquipe(node.id, e.id)
                }}
                className="ml-0.5 hover:bg-bg-hover rounded-sm"
                title="Remover"
              >
                <X size={9} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!ctx.readOnly && (
        <button
          ref={btnRef}
          type="button"
          onClick={onAdd}
          className="inline-flex items-center justify-center h-5 w-5 rounded text-text-faint hover:text-accent hover:bg-accent/10 shrink-0"
          title="Adicionar equipe"
        >
          <Plus size={11} />
        </button>
      )}
    </div>
  )
}

// ─── PredecessorasCell ─────────────────────────────────────────────────────
const DEP_LABEL: Record<PredecessoraRef['tipo'], string> = {
  FS: 'FS',
  SS: 'SS',
  FF: 'FF',
  SF: 'SF'
}
const DEP_COLOR: Record<PredecessoraRef['tipo'], string> = {
  FS: 'text-accent',
  SS: 'text-success',
  FF: 'text-warn',
  SF: 'text-milestone'
}

export function PredecessorasCell({ node, ctx }: CellProps): ReactNode {
  if (node.tipo_no === 'grupo') {
    return <Dash />
  }
  const preds = node.predecessoras ?? []
  return (
    <div className="flex items-center gap-1 h-full px-1 overflow-hidden">
      <div className="flex items-center gap-1 flex-1 overflow-x-auto min-w-0 scrollbar-hide">
        {preds.map((p) => {
          const predNum = ctx.numeroById.get(p.predecessora_id) ?? '?'
          const pred = ctx.tarefasById.get(p.predecessora_id)
          const predNome = pred?.nome_custom ?? pred?.servico_grupo_descricao ?? '?'
          const lag = p.lag_dias > 0 ? `+${p.lag_dias}d` : p.lag_dias < 0 ? `${p.lag_dias}d` : ''
          return (
            <span
              key={p.id}
              className={cn(
                'inline-flex items-center gap-0.5 h-5 px-1 rounded-sm shrink-0',
                'bg-bg-elevated border border-border text-2xs font-mono text-text-muted'
              )}
              title={`${predNome}${lag ? ' · lag ' + lag : ''}`}
            >
              <span className="tabular-nums">{predNum}</span>
              <span className={cn('font-semibold', DEP_COLOR[p.tipo])}>{DEP_LABEL[p.tipo]}</span>
              {lag && <span className="text-text-dim">{lag}</span>}
              {!ctx.readOnly && (
                <button
                  type="button"
                  onClick={() => ctx.removerPredecessora(p.id)}
                  className="ml-0.5 hover:bg-bg-hover rounded-sm"
                  title="Remover dependência"
                >
                  <X size={9} />
                </button>
              )}
            </span>
          )
        })}
      </div>
      {!ctx.readOnly && (
        <button
          type="button"
          onClick={() => ctx.abrirAddDep(node.id)}
          className="inline-flex items-center justify-center h-5 w-5 rounded text-text-faint hover:text-accent hover:bg-accent/10 shrink-0"
          title="Adicionar predecessora"
        >
          <Plus size={11} />
        </button>
      )}
    </div>
  )
}

// ─── NotasCell ─────────────────────────────────────────────────────────────
export function NotasCell({ node, ctx }: CellProps): ReactNode {
  const hasNotas = !!node.notas && node.notas.trim() !== ''
  const Icon = hasNotas ? MessageSquareText : FileText
  return (
    <button
      type="button"
      onClick={() => ctx.abrirNotas(node.id)}
      className={cn(
        'flex items-center justify-center h-full w-full',
        hasNotas ? 'text-accent' : 'text-text-faint hover:text-text-dim'
      )}
      title={hasNotas ? 'Ver notas' : 'Adicionar nota'}
    >
      <Icon size={11} />
    </button>
  )
}

function Dash(): ReactNode {
  return (
    <div className="flex items-center justify-center h-full text-text-faint text-xs">—</div>
  )
}
