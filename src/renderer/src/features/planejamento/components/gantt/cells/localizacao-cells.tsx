// Cells do grupo "Localização": TrechoCell, PosIniCell, PosFimCell.
//
// Trecho é um pill clicável que abre popover com lista de trechos da obra.
// PosIni/PosFim também são pills clicáveis — abrem PosicaoPopover com busca +
// grade do trecho (km/m/estaca/custom) pra escolher o marcador rapidamente.
// Popover ainda permite digitar valor livre (Enter) pra casos fora da grade.
//
// Grupos/marcos não permitem editar essas células (mostra "—").

import { useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMarcador, type TrechoCtx } from '@/lib/format'
import type { CellProps } from './types'

// ─── Helper: monta TrechoCtx pro parser/formatter ────────────────────────
function buildTrechoCtx(trecho: CellProps['ctx']['trechos'][number] | undefined): TrechoCtx | null {
  if (!trecho) return null
  return {
    unidade_espaco_padrao: trecho.unidade_espaco_padrao,
    unidade_custom_label: trecho.unidade_custom_label,
    unidade_custom_divisor_m: trecho.unidade_custom_divisor_m,
    marcador_valor_inicial: trecho.marcador_valor_inicial,
    geometry_sentido: trecho.geometry_sentido,
    geometry_comprimento_m: trecho.geometry_comprimento_m
  }
}

// ─── TrechoCell ────────────────────────────────────────────────────────────
export function TrechoCell({ node, ctx }: CellProps): ReactNode {
  const btnRef = useRef<HTMLButtonElement>(null)
  if (node.tipo_no === 'grupo') {
    return <Dash />
  }
  const trecho = ctx.trechos.find((t) => t.id === node.trecho_id)
  const label = trecho?.nome ?? '—'

  if (ctx.readOnly) {
    return (
      <div className="flex items-center h-full px-1 text-2xs font-mono text-text-muted">
        {label}
      </div>
    )
  }

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => {
        const rect = btnRef.current?.getBoundingClientRect()
        if (rect) ctx.abrirTrecho(node.id, rect)
      }}
      className={cn(
        'flex items-center justify-between gap-1 w-full h-6 px-1.5 mx-1 rounded',
        'border border-transparent hover:border-border hover:bg-bg-hover',
        'text-2xs font-mono text-text truncate'
      )}
      title="Mudar trecho"
    >
      <span className="truncate">{label}</span>
      <ChevronDown size={9} className="text-text-dim shrink-0" />
    </button>
  )
}

// ─── PosIniCell / PosFimCell ──────────────────────────────────────────────
interface PosCellProps extends CellProps {
  field: 'posicao_inicio_m' | 'posicao_fim_m'
}
export function PosCell({ node, ctx, field }: PosCellProps): ReactNode {
  const btnRef = useRef<HTMLButtonElement>(null)
  if (node.tipo_no !== 'tarefa') {
    return <Dash />
  }
  const trecho = ctx.trechos.find((t) => t.id === node.trecho_id)
  const trechoCtx = buildTrechoCtx(trecho)
  const valueM = node[field]
  const display = trechoCtx && valueM != null ? formatMarcador(valueM, trechoCtx) : ''

  if (ctx.readOnly) {
    return (
      <div className="flex items-center justify-end h-full px-1 text-2xs font-mono tabular-nums text-text-muted">
        {display || '—'}
      </div>
    )
  }

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => {
        const rect = btnRef.current?.getBoundingClientRect()
        if (rect) ctx.abrirPosicao(node.id, field, rect)
      }}
      className={cn(
        'flex items-center justify-between gap-1 w-full h-6 px-1.5 mx-1 rounded',
        'border border-transparent hover:border-border hover:bg-bg-hover',
        'text-2xs font-mono tabular-nums text-text'
      )}
      title="Escolher posição"
    >
      <span className="truncate text-right flex-1">{display || '—'}</span>
      <ChevronDown size={9} className="text-text-dim shrink-0" />
    </button>
  )
}

function Dash(): ReactNode {
  return (
    <div className="flex items-center justify-center h-full text-text-faint text-xs">—</div>
  )
}
