// Bars do GanttPane (Fase 3): TaskBar, SummaryBar, MilestoneMark, DependencyArrow.
//
// Fase 3 entrega só render — drag-to-move/resize/criar-link fica pra Fase 4.
// As caps (.cap.left / .cap.right) já são renderizadas em hover preparando
// a base do drag.

import { type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type {
  EquipeAlocada,
  Equipe,
  PlanejamentoTarefaCompleta
} from '@/types/planejamento'
import type { BarStyle, ColorMode } from '../../hooks/useCronogramaTweaks'

// ─── Helpers de cor ────────────────────────────────────────────────────────
// Cor base do TaskBar varia por tweak.colorMode:
//   'tipo'   → accent (azul). Crítica força red.
//   'equipe' → cor da 1ª equipe alocada (fallback accent).
//   'status' → mapa por (data_inicio_manual?/is_critico/sem cpu)...

const STATUS_PALETTE: Record<string, string> = {
  pendente: 'var(--text-dim)',
  andamento: 'var(--accent)',
  concluido: 'var(--success)',
  atrasado: 'var(--danger)'
}

function deriveColor(
  node: PlanejamentoTarefaCompleta,
  mode: ColorMode,
  equipesById: Map<string, Equipe>
): string {
  if (node.is_critico) return 'var(--danger)'
  if (mode === 'equipe') {
    const eq = (node.equipes ?? [])[0] as EquipeAlocada | undefined
    if (eq) {
      const full = equipesById.get(eq.id)
      return full?.cor ?? eq.cor ?? 'var(--accent)'
    }
    return 'var(--accent)'
  }
  if (mode === 'status') {
    // Heurística simples: sem CPU/equipe = pendente; com datas no passado = atrasado
    if (!node.cpu_snapshot_id || (node.equipes ?? []).length === 0) return STATUS_PALETTE.pendente
    return STATUS_PALETTE.andamento
  }
  return 'var(--accent)'
}

function texturaPorCodigo(codigo: string | null): string | null {
  if (!codigo) return null
  const ramo = codigo.split('.')[0]
  const n = parseInt(ramo, 10)
  if (Number.isNaN(n) || n < 1) return null
  const idx = ((n - 1) % 6) + 1
  return `bar-tex-${idx}`
}

// ─── TaskBar ───────────────────────────────────────────────────────────────
interface TaskBarProps {
  node: PlanejamentoTarefaCompleta
  /** left/width em px. */
  x: number
  width: number
  /** Centro vertical absoluto (top do row + rowHeight/2). */
  cy: number
  selected: boolean
  hover: boolean
  showLabels: boolean
  barStyle: BarStyle
  colorMode: ColorMode
  equipesById: Map<string, Equipe>
  /** Largura em pixels do float indicator hachurado (= total_float × pxPerDay).
   *  Renderizado SÓ quando > 0 e tarefa não-crítica. Default 0 (não renderiza). */
  floatWidth?: number
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: (e: React.MouseEvent) => void
  onMouseDown: (e: React.MouseEvent, side: 'body' | 'left' | 'right' | 'cap-left' | 'cap-right') => void
  onContextMenu: (e: React.MouseEvent) => void
}
export function TaskBar({
  node,
  x,
  width,
  cy,
  selected,
  hover,
  showLabels,
  barStyle,
  colorMode,
  equipesById,
  floatWidth = 0,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onMouseDown,
  onContextMenu
}: TaskBarProps): ReactNode {
  // Tarefa indireta tem visual distinto: cor neutra cinza-azulado, hachurado
  // diagonal sempre (ignora barStyle), altura maior, e borda lateral mais
  // grossa. Reflete que ela "cobre" o período em vez de "ocupar" recurso.
  const isIndireto = node.is_indireto === true
  const baseColor = isIndireto ? 'var(--text-dim)' : deriveColor(node, colorMode, equipesById)
  const height = isIndireto ? 22 : 18
  const top = cy - height / 2
  const w = Math.max(2, width)
  const textura = isIndireto
    ? 'bar-tex-indireto'
    : barStyle === 'textured'
      ? texturaPorCodigo(node.codigo_eap ?? node.servico_grupo_codigo)
      : null

  // Cor de fundo SEMPRE presente — gradient e textured ficavam invisíveis
  // quando baseColor era CSS var oklch() (concatenar "cc" hex em var() não
  // funciona). Solução: bg sólida embaixo, gradient/textura por cima.
  const bgFill = isIndireto ? 'rgba(100, 116, 139, 0.35)' : baseColor
  const style: CSSProperties = {
    left: x,
    top,
    width: w,
    height,
    backgroundColor: bgFill,
    backgroundImage: isIndireto
      ? 'repeating-linear-gradient(45deg, transparent 0 6px, rgba(148, 163, 184, 0.45) 6px 10px)'
      : barStyle === 'gradient'
        ? 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0.18))'
        : undefined,
    border: isIndireto ? '1.5px solid var(--text-dim)' : undefined,
    boxShadow:
      hover || selected ? `0 0 0 1px ${baseColor}, 0 1px 4px rgba(0,0,0,0.35)` : undefined
  }

  const labelOutside = w < 60
  const nome = node.nome_custom ?? node.servico_grupo_descricao ?? ''

  // Float indicator: faixa hachurada após a barra, indicando folga em dias úteis.
  // Renderiza somente se floatWidth > 0 e tarefa não-crítica.
  const showFloat = floatWidth > 0 && !node.is_critico

  return (
    <>
      {showFloat && (
        <div
          className="gantt-float-indicator"
          style={{
            left: x + w,
            top: cy - 3,
            width: floatWidth
          }}
          title={`Folga: ${Math.round(floatWidth)}px`}
        />
      )}
      <div
        data-bar-id={node.id}
        role="button"
        tabIndex={0}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e)
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return // só botão esquerdo inicia drag
          // Identifica zona pelo dataset do target
          const t = (e.target as HTMLElement).dataset.zone as
            | 'left'
            | 'right'
            | 'cap-left'
            | 'cap-right'
            | undefined
          onMouseDown(e, t ?? 'body')
        }}
        className={cn(
          'absolute rounded-sm cursor-move group/bar',
          'overflow-visible',
          selected && 'ring-1 ring-accent',
          textura
        )}
        style={style}
        title={
          isIndireto
            ? `${nome} · indireta · cobre toda obra · custo ${
                node.custo_total_calc != null
                  ? `R$ ${Number(node.custo_total_calc).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'
              } · receita ${
                node.receita_total_calc != null
                  ? `R$ ${Number(node.receita_total_calc).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'
              }`
            : `${nome}${node.is_critico ? ' · crítica' : ''}`
        }
      >
        {/* Resize handles */}
        <div
          data-zone="left"
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100"
        />
        <div
          data-zone="right"
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover/bar:opacity-100"
        />
        {/* Caps (bolinhas pra criar dependência via drag).
            Indiretas NÃO aceitam dependências (semântica: cobrem cronograma).
            Caps + zonas de resize escondidos pra impedir drag. */}
        {!isIndireto && (
          <>
            <span
              data-zone="cap-left"
              className={cn(
                'absolute -left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full',
                'bg-bg border-2 border-accent opacity-0 group-hover/bar:opacity-100 cursor-crosshair',
                'transition-transform duration-150 hover:scale-125 hover:bg-accent'
              )}
              style={{ zIndex: 15 }}
            />
            <span
              data-zone="cap-right"
              className={cn(
                'absolute -right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full',
                'bg-bg border-2 border-accent opacity-0 group-hover/bar:opacity-100 cursor-crosshair',
                'transition-transform duration-150 hover:scale-125 hover:bg-accent'
              )}
              style={{ zIndex: 15 }}
            />
          </>
        )}
        {/* Label interno. Indireta usa cor clara pra contraste com hachurado;
            tarefa normal mantém cor escura pra contrastar com cor sólida. */}
        {showLabels && !labelOutside && (
          <span
            className="absolute inset-0 flex items-center px-2 text-2xs font-mono truncate"
            style={{ color: isIndireto ? '#e2e8f0' : '#0a0b0d' }}
          >
            {nome}
          </span>
        )}
        {/* Label externo (quando barra pequena) */}
        {showLabels && labelOutside && (
          <span
            className="absolute top-1/2 -translate-y-1/2 text-2xs font-mono text-text-muted whitespace-nowrap pointer-events-none"
            style={{ left: w + 4 }}
          >
            {nome}
          </span>
        )}
      </div>
    </>
  )
}

// ─── SummaryBar ────────────────────────────────────────────────────────────
// Barra de grupo (estilo Primavera/MSP): retângulo fino + "morcegos" triangulares
// pendurados nas pontas esquerda/direita. SVG único pra evitar reflow.
interface SummaryBarProps {
  x: number
  width: number
  cy: number
}
export function SummaryBar({ x, width, cy }: SummaryBarProps): ReactNode {
  const barH = 4
  const bracketH = 5
  const totalH = barH + bracketH
  const top = cy - barH / 2
  const w = Math.max(6, width)
  return (
    <svg
      className="absolute pointer-events-none"
      style={{ left: x, top, width: w, height: totalH, overflow: 'visible' }}
      viewBox={`0 0 ${w} ${totalH}`}
      preserveAspectRatio="none"
    >
      {/* Corpo: retângulo fino */}
      <rect x={0} y={0} width={w} height={barH} fill="var(--text)" opacity={0.85} />
      {/* "Morcego" esquerdo: triângulo pendurado na ponta */}
      <path
        d={`M 0 ${barH} L 0 ${barH + bracketH} L ${bracketH} ${barH} Z`}
        fill="var(--text)"
        opacity={0.85}
      />
      {/* "Morcego" direito */}
      <path
        d={`M ${w} ${barH} L ${w} ${barH + bracketH} L ${w - bracketH} ${barH} Z`}
        fill="var(--text)"
        opacity={0.85}
      />
    </svg>
  )
}

// ─── MilestoneMark ─────────────────────────────────────────────────────────
// Diamante SVG 14×14 com caps laterais (esquerda/direita) pra suportar drag
// de dependência igual o TaskBar. Como marco tem duração 0, esquerda=início e
// direita=fim apontam pro mesmo instante; mantemos os 2 lados por simetria
// visual com tarefas e pra inferência de tipo (SS/SF/FS/FF) consistente.
interface MilestoneMarkProps {
  x: number
  cy: number
  label: string
  showLabel: boolean
  selected: boolean
  hover: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: (e: React.MouseEvent) => void
  onMouseDown: (
    e: React.MouseEvent,
    side: 'body' | 'cap-left' | 'cap-right'
  ) => void
  onContextMenu: (e: React.MouseEvent) => void
  id: string
}
export function MilestoneMark({
  x,
  cy,
  label,
  showLabel,
  selected,
  hover,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onMouseDown,
  onContextMenu,
  id
}: MilestoneMarkProps): ReactNode {
  const size = 14
  return (
    <div
      data-bar-id={id}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const t = (e.target as HTMLElement).dataset.zone as
          | 'cap-left'
          | 'cap-right'
          | undefined
        onMouseDown(e, t ?? 'body')
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e)
      }}
      className="absolute cursor-move group/milestone"
      style={{ left: x - size / 2, top: cy - size / 2, width: size, height: size }}
      title={label}
    >
      <svg width={size} height={size} viewBox="0 0 14 14">
        <polygon
          points="7,1 13,7 7,13 1,7"
          fill="var(--milestone)"
          stroke={selected ? 'var(--accent)' : hover ? '#fff' : 'var(--milestone)'}
          strokeWidth={selected || hover ? 1.5 : 1}
        />
      </svg>
      {/* Caps (bolinhas pra criar dependência via drag). Mesmo padrão do TaskBar:
          opacity-0 default, aparecem no hover do milestone. */}
      <span
        data-zone="cap-left"
        className={cn(
          'absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full',
          'bg-bg border-2 border-accent opacity-0 group-hover/milestone:opacity-100 cursor-crosshair',
          'transition-transform duration-150 hover:scale-125 hover:bg-accent'
        )}
        style={{ left: -8, zIndex: 15 }}
      />
      <span
        data-zone="cap-right"
        className={cn(
          'absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full',
          'bg-bg border-2 border-accent opacity-0 group-hover/milestone:opacity-100 cursor-crosshair',
          'transition-transform duration-150 hover:scale-125 hover:bg-accent'
        )}
        style={{ right: -8, zIndex: 15 }}
      />
      {showLabel && (
        <span
          className="absolute top-1/2 -translate-y-1/2 text-2xs font-mono text-milestone whitespace-nowrap pointer-events-none"
          style={{ left: size + 4 }}
        >
          {label}
        </span>
      )}
    </div>
  )
}

// ─── DependencyArrow ───────────────────────────────────────────────────────
// Uma seta SVG ligando duas barras. Path ortogonal (default) ou Bézier curva.
// Interativa: hover realça em accent + cursor pointer; clique propaga onClick.
export type DepMode = 'ortho' | 'curve'

interface DependencyArrowProps {
  /** Ponto de origem (X,Y absolutos no canvas). */
  fromX: number
  fromY: number
  /** Ponto de destino. */
  toX: number
  toY: number
  /** FS=>right-to-left, SS=>left-to-left, FF=>right-to-right, SF=>left-to-right.
   *  Influencia direção das pernas ortogonais. */
  side: 'fs' | 'ss' | 'ff' | 'sf'
  critical: boolean
  mode: DepMode
  onClick?: (e: React.MouseEvent<SVGGElement>) => void
}
export function DependencyArrow({
  fromX,
  fromY,
  toX,
  toY,
  side,
  critical,
  mode,
  onClick
}: DependencyArrowProps): ReactNode {
  // Cor neutra por default (matching protótipo). Crítica usa danger.
  // O hover é tratado por CSS (.dep-arrow-path:hover) pra evitar re-render.
  const stroke = critical ? 'var(--danger)' : 'var(--text-muted)'
  const strokeWidth = critical ? 1.6 : 1.3

  // Direção de saída/entrada:
  // FS: sai pra direita do pred → entra pela esquerda do suc
  // FF: sai pra direita → entra pela direita
  // SS: sai pra esquerda → entra pela esquerda
  // SF: sai pra esquerda → entra pela direita
  const outDx = side === 'ss' || side === 'sf' ? -1 : 1
  const inDx = side === 'fs' || side === 'ss' ? 1 : -1
  const dx = toX - fromX
  const dy = toY - fromY

  let path: string
  if (mode === 'curve') {
    // Bézier cúbica com control points em 40% da distância
    const dist = Math.max(20, Math.abs(dx))
    const c1x = fromX + outDx * dist * 0.4
    const c2x = toX - inDx * dist * 0.4
    path = `M ${fromX} ${fromY} C ${c1x} ${fromY}, ${c2x} ${toY}, ${toX} ${toY}`
  } else {
    // Ortogonal — portado do protótipo (GanttBars.jsx buildPath).
    // Direção projetada do destino (do nosso ponto de vista de saída):
    //   se inDx > 0 (entra da esquerda) → "espera-se" dx > 0
    //   se inDx < 0 (entra da direita)  → "espera-se" dx < 0
    // Quando a projeção é confortável, usa elbow simples.
    // Quando o destino "voltou" (gap apertado), faz loop back acima/abaixo.
    const minGap = 10
    const projectedDx = inDx > 0 ? dx : -dx
    if (projectedDx >= minGap * 2) {
      // Elbow simples: horizontal → vertical → horizontal
      const midX = (fromX + toX) / 2
      path = `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`
    } else {
      // Loop back: contorna 18px acima/abaixo de Y de origem
      const outX = fromX + outDx * minGap
      const inX = toX - inDx * minGap
      const midY = dy >= 0 ? fromY + 18 : fromY - 18
      path = `M ${fromX} ${fromY} L ${outX} ${fromY} L ${outX} ${midY} L ${inX} ${midY} L ${inX} ${toY} L ${toX} ${toY}`
    }
  }

  // Arrowhead: triangulinho no ponto de destino apontando contra inDx
  const arrowSize = 5
  const ahX = toX
  const ahY = toY
  const ahPath =
    inDx > 0
      ? `M ${ahX} ${ahY} L ${ahX - arrowSize} ${ahY - arrowSize / 1.6} L ${ahX - arrowSize} ${ahY + arrowSize / 1.6} Z`
      : `M ${ahX} ${ahY} L ${ahX + arrowSize} ${ahY - arrowSize / 1.6} L ${ahX + arrowSize} ${ahY + arrowSize / 1.6} Z`

  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
      className={critical ? 'dep-arrow critical' : 'dep-arrow'}
    >
      {/* Path principal: interativo via pointer-events="stroke" */}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        className="dep-arrow-path"
        style={{ pointerEvents: 'stroke' }}
      />
      {/* Hit-area invisível mais grossa pra facilitar o clique */}
      {onClick && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={10}
          style={{ pointerEvents: 'stroke' }}
        />
      )}
      <path
        d={ahPath}
        fill={stroke}
        opacity={0.95}
        style={{ pointerEvents: 'none' }}
      />
    </g>
  )
}
