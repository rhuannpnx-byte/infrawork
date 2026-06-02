// GridRow — uma linha (tarefa/grupo/marco) do Grid.
//
// Renderiza as células visíveis na ordem da config (`cols`), aplicando sticky-
// left nas frozen. Bg/seleção/hover por estado externo (selectedIds, hoverId).
//
// Drag-to-reorder: NumeroCell tem `data-drag-handle`; o GridRow detecta
// mousedown nele e dispara `onDragStart` (ghost rendering fica no Grid pai).

import { memo, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { GridColumnConfig } from '../../lib/grid-columns'
import {
  DescricaoCell,
  EapCell,
  NumeroCell
} from './cells/identificacao-cells'
import { PosCell, TrechoCell } from './cells/localizacao-cells'
import {
  ProdDiaCell,
  QtdAlocadaCell,
  UnidadeCell
} from './cells/quantitativos-cells'
import { DuracaoCell, FimCell, InicioCell } from './cells/cronograma-cells'
import {
  EquipesCell,
  NotasCell,
  PredecessorasCell
} from './cells/alocacao-cells'
import type { CellContext, VisibleNode } from './cells/types'

interface GridRowProps {
  node: VisibleNode
  cols: GridColumnConfig[]
  ctx: CellContext
  rowHeight: number
  top: number
  selected: boolean
  hover: boolean
  expanded: boolean
  /** Quantidade vinculada já computada pelo Grid pai (NULL se sem vínculo). */
  qtdLinkValue: number | null
  /** Lado da linha onde o cursor de drag está — 'top' = inserir antes,
   *  'bottom' = inserir depois, null = não é drop target. */
  dragOverSide?: 'top' | 'bottom' | null
  onSelect: (id: string, opts?: { add?: boolean }) => void
  onHover: (id: string | null) => void
  onToggleExpand: (id: string) => void
  onDragStart: (id: string, e: React.MouseEvent) => void
  onContextMenu: (id: string, x: number, y: number) => void
}

function GridRowImpl({
  node,
  cols,
  ctx,
  rowHeight,
  top,
  selected,
  hover,
  expanded,
  qtdLinkValue,
  dragOverSide = null,
  onSelect,
  onHover,
  onToggleExpand,
  onDragStart,
  onContextMenu
}: GridRowProps): ReactNode {
  // Pré-computa offsets cumulativos das frozen + índice da última (sem mutação no map → compatível com react-compiler).
  const frozenOffsets: number[] = []
  let lastFrozenVisibleIdx = -1
  let cumulative = 0
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]
    frozenOffsets.push(cumulative)
    if (c.visible && c.frozen) {
      lastFrozenVisibleIdx = i
      cumulative += c.width
    }
  }

  // Fundo do row — SEMPRE opaco. As cells frozen são position:sticky e ficam
  // por cima das cells não-frozen durante o scroll horizontal; se tivesse
  // qualquer transparência, os caracteres das duas se sobreporiam.
  const rowBg = selected
    ? 'var(--bg-active)'
    : hover
      ? 'var(--bg-hover)'
      : node.tipo_no === 'grupo'
        ? 'var(--bg-elevated)'
        : 'var(--bg-panel)'

  return (
    <div
      data-row-id={node.id}
      className={cn(
        'grid-row absolute left-0 right-0 flex border-b border-border/40'
      )}
      style={{
        top,
        height: rowHeight,
        backgroundColor: rowBg,
        // Indicador lateral azul 2px à esquerda quando selecionado.
        // Durante drag de reorder, drop-target mostra linha 2px accent no topo
        // (inserir ANTES) ou no rodapé (inserir DEPOIS) — assim o usuário vê
        // exatamente onde a tarefa vai pousar, inclusive nas pontas (1º/último).
        boxShadow:
          dragOverSide === 'top'
            ? 'inset 0 2px 0 var(--accent)'
            : dragOverSide === 'bottom'
              ? 'inset 0 -2px 0 var(--accent)'
              : selected
                ? 'inset 2px 0 0 var(--accent)'
                : undefined
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => onSelect(node.id, { add: e.metaKey || e.ctrlKey || e.shiftKey })}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(node.id, e.clientX, e.clientY)
      }}
      onMouseDown={(e) => {
        // Drag-to-reorder: só inicia se mousedown em data-drag-handle
        const target = e.target as HTMLElement
        if (target.closest('[data-drag-handle]')) {
          onDragStart(node.id, e)
        }
      }}
    >
      {cols.map((c, idx) => {
        if (!c.visible) return null
        const isLastFrozen = c.frozen && idx === lastFrozenVisibleIdx
        const stickyStyle: CSSProperties = c.frozen
          ? {
              position: 'sticky',
              left: frozenOffsets[idx],
              zIndex: 2,
              // Sombra divisória SÓ na última frozen visível — cria a borda nítida
              // entre a "parte fixa" e a "parte móvel" que rola atrás dela.
              boxShadow: isLastFrozen ? '1px 0 0 var(--border-strong)' : undefined
            }
          : {}

        return (
          <div
            key={c.key}
            className={cn(
              // Frozen NÃO leva border-r (a sombra na última cobre); não-frozen leva separador sutil.
              'shrink-0 overflow-hidden',
              !c.frozen && 'border-r border-border/60'
            )}
            style={{
              width: c.width,
              ...stickyStyle,
              // Frozen cells precisam do MESMO bg opaco do row — sem ele, durante
              // scroll horizontal as cells não-frozen aparecem por baixo das
              // frozen e os caracteres se sobrepõem.
              backgroundColor: c.frozen ? rowBg : undefined
            }}
          >
            <Cell
              colKey={c.key}
              node={node}
              ctx={ctx}
              expanded={expanded}
              qtdLinkValue={qtdLinkValue}
              onToggleExpand={() => onToggleExpand(node.id)}
            />
          </div>
        )
      })}
    </div>
  )
}

interface CellProps {
  colKey: GridColumnConfig['key']
  node: VisibleNode
  ctx: CellContext
  expanded: boolean
  qtdLinkValue: number | null
  onToggleExpand: () => void
}
function Cell({
  colKey,
  node,
  ctx,
  expanded,
  qtdLinkValue,
  onToggleExpand
}: CellProps): ReactNode {
  switch (colKey) {
    case 'numero':
      return <NumeroCell node={node} ctx={ctx} />
    case 'eap':
      return <EapCell node={node} ctx={ctx} />
    case 'descricao':
      return (
        <DescricaoCell
          node={node}
          ctx={ctx}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      )
    case 'trecho':
      return <TrechoCell node={node} ctx={ctx} />
    case 'pos_inicio':
      return <PosCell node={node} ctx={ctx} field="posicao_inicio_m" />
    case 'pos_fim':
      return <PosCell node={node} ctx={ctx} field="posicao_fim_m" />
    case 'qtd_alocada':
      return <QtdAlocadaCell node={node} ctx={ctx} qtdLinkValue={qtdLinkValue} />
    case 'unidade':
      return <UnidadeCell node={node} ctx={ctx} />
    case 'producao':
      return <ProdDiaCell node={node} ctx={ctx} />
    case 'duracao':
      return <DuracaoCell node={node} ctx={ctx} />
    case 'inicio':
      return <InicioCell node={node} ctx={ctx} />
    case 'fim':
      return <FimCell node={node} ctx={ctx} />
    case 'equipes':
      return <EquipesCell node={node} ctx={ctx} />
    case 'predecessoras':
      return <PredecessorasCell node={node} ctx={ctx} />
    case 'notas':
      return <NotasCell node={node} ctx={ctx} />
    default:
      return null
  }
}

export const GridRow = memo(GridRowImpl)
