import type { ReactNode } from 'react'
import { fmtDataBR } from '@/features/planejamento/lib/dates'
import { fmtQtd } from '@/lib/money'
import { formatMarcador } from '@/lib/format/posicao'
import type { ObraTrecho } from '@/types/gerencial'
import type { TracoTarefa } from '@/types/planejamento'

interface MarchaTempoTooltipProps {
  traco: TracoTarefa
  /** Posição do mouse (clientX, clientY) — fixed positioning. */
  x: number
  y: number
  /** Trecho — pra resolver marcador_valor_inicial + sentido no display. */
  trecho: ObraTrecho
}

/**
 * Card flutuante com detalhes da tarefa sob o cursor. Posicionado em `fixed`
 * (acima do SVG) e clampado pra não vazar viewport.
 */
export function MarchaTempoTooltip({
  traco,
  x,
  y,
  trecho
}: MarchaTempoTooltipProps): ReactNode {
  // Clamping básico: 16px de margem. Direção: à direita do cursor por default,
  // mas se passar do viewport, à esquerda.
  const W = 280
  const PAD = 16
  const left =
    x + W + PAD < window.innerWidth ? x + PAD : Math.max(8, x - W - PAD)
  const top = Math.max(8, Math.min(window.innerHeight - 200, y + PAD))

  return (
    <div
      style={{ position: 'fixed', top, left, width: W, zIndex: 100 }}
      className="rounded border border-border-strong bg-bg-elevated shadow-xl p-2.5 pointer-events-none"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div
          className="w-3 h-3 rounded shrink-0 mt-0.5"
          style={{ background: traco.cor }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-mono font-medium text-text truncate">
            {traco.label}
          </div>
          <div className="text-2xs font-mono text-text-dim">
            {fmtDataBR(traco.dataInicio)} → {fmtDataBR(traco.dataFim)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-2xs font-mono">
        <Stat
          label="Qtd total"
          value={`${fmtQtd(traco.qtdTotal)}${traco.unidadeQtd ? ` ${traco.unidadeQtd}` : ''}`}
        />
        <Stat
          label={traco.unidadeQtd ? `${traco.unidadeQtd}/dia` : 'Qtd/dia'}
          value={fmtQtd(traco.prodMediaPorDia)}
        />
        <Stat
          label="Extensão"
          value={`${formatMarcador(traco.posIniM, trecho)} → ${formatMarcador(traco.posFimM, trecho)}`}
        />
        <Stat
          label="Avanço/dia"
          value={`${fmtQtd(traco.prodMediaEspacial)} m`}
        />
      </div>

      <div className="mt-1.5 pt-1.5 border-t border-border text-2xs font-mono text-text-faint">
        Modo:{' '}
        <span className={traco.modo === 'perfilada' ? 'text-accent' : 'text-warn'}>
          {traco.modo === 'perfilada' ? 'Perfilada (template)' : 'Uniforme (estimada)'}
        </span>
        {traco.direcao === -1 ? <span className="ml-2">↺ retrocede</span> : null}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className="text-text-faint uppercase tracking-wider">{label}</div>
      <div className="text-text">{value}</div>
    </div>
  )
}
