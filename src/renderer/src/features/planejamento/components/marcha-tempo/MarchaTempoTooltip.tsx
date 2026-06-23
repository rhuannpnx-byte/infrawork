// MarchaTempoTooltip — tooltip da trajetória sob o cursor. Lead com NESTE
// PONTO (estaca + data + qtd acumulada + qtd dia), seguido dos totais da
// frente. Port do design Claude Design.

import type { ReactNode } from 'react'
import { fmtDataBR, fmtQtdCompact } from '@/features/planejamento/lib/marcha-tempo-pure'
import { formatMarcador } from '@/lib/format/posicao'
import type { ObraTrecho } from '@/types/gerencial'
import type { TracoTarefa } from '@/types/planejamento'

interface MarchaTempoTooltipProps {
  traco: TracoTarefa
  x: number
  y: number
  trecho: ObraTrecho
  /** Ponto exato sob o cursor (interpolado), pra seção NESTE PONTO. */
  ponto?: {
    posM: number
    dateMs: number
    qtdAcc: number
    qtdDia: number
  }
}

export function MarchaTempoTooltip({
  traco,
  x,
  y,
  trecho,
  ponto
}: MarchaTempoTooltipProps): ReactNode {
  const W = 296
  const PAD = 16
  const left = x + W + PAD < window.innerWidth ? x + PAD : Math.max(8, x - W - PAD)
  const top = Math.max(8, Math.min(window.innerHeight - 360, y + PAD))

  const pct = ponto && traco.qtdTotal > 0
    ? Math.min(100, Math.round((ponto.qtdAcc / traco.qtdTotal) * 100))
    : 0

  return (
    <div
      style={{ position: 'fixed', top, left, width: W, zIndex: 100 }}
      className="rounded border border-border-strong bg-bg-elevated shadow-xl overflow-hidden pointer-events-none font-mono"
    >
      {/* Header com swatch e título */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border"
        style={{ background: 'var(--bg-hover)' }}
      >
        <span className="w-3 h-3 rounded shrink-0" style={{ background: traco.cor }} />
        <span className="text-text text-xs font-semibold truncate">{traco.label}</span>
      </div>

      {/* NESTE PONTO — destaque com qtd acumulada + dia */}
      {ponto && (
        <div className="px-3 py-2.5 border-b border-border" style={{ background: 'var(--bg)' }}>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-2xs tracking-widest text-text-dim">NESTE PONTO</span>
            <span className="text-xs font-semibold" style={{ color: traco.cor }}>
              {formatMarcador(ponto.posM, trecho)} · {fmtDataBR(ponto.dateMs)}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-text tracking-tight">
              {fmtQtdCompact(ponto.qtdAcc)}{' '}
              <span className="text-xs font-normal text-text-muted">
                {traco.unidadeQtd ?? ''}
              </span>
            </span>
            <span className="text-2xs text-text-dim">executado até aqui</span>
          </div>
          <div className="h-1 rounded-sm bg-bg-active overflow-hidden mt-2">
            <span
              className="block h-full rounded-sm"
              style={{ width: `${pct}%`, background: traco.cor }}
            />
          </div>
          <div className="text-2xs text-text-dim mt-1">{pct}% do total da frente</div>
          <div className="flex items-baseline justify-between gap-2 mt-2 pt-1.5 border-t border-border">
            <span className="text-2xs text-text-dim">neste dia</span>
            {ponto.qtdDia > 0 ? (
              <span className="text-xs font-semibold text-success">
                +{fmtQtdCompact(ponto.qtdDia)} {traco.unidadeQtd ?? ''}
              </span>
            ) : (
              <span className="text-xs text-text-dim">— não-trabalhado</span>
            )}
          </div>
        </div>
      )}

      {/* Body — totais da frente */}
      <div className="px-3 py-2 grid gap-1 text-2xs">
        <Row
          k="Período"
          v={`${fmtDataBR(new Date(`${traco.dataInicio}T00:00:00Z`).getTime())} → ${fmtDataBR(new Date(`${traco.dataFim}T00:00:00Z`).getTime())}`}
        />
        <Row
          k="Trecho"
          v={`${formatMarcador(traco.posIniM, trecho)} → ${formatMarcador(traco.posFimM, trecho)}`}
        />
        <Row
          k="Extensão"
          v={`${(Math.abs(traco.posFimM - traco.posIniM) / 1000).toFixed(1)} km`}
        />
        <Row
          k="Qtd total"
          v={`${fmtQtdCompact(traco.qtdTotal)} ${traco.unidadeQtd ?? ''}`}
        />
        <Row k="Avanço/dia" v={`${Math.round(traco.prodMediaEspacial)} m`} />
        <Row
          k={`${traco.unidadeQtd ?? 'qtd'}/dia`}
          v={fmtQtdCompact(traco.prodMediaPorDia)}
          mut
        />
        <div className="flex gap-1.5 mt-1 pt-2 border-t border-border">
          <span
            className={
              traco.modo === 'perfilada'
                ? 'px-1.5 py-0.5 rounded text-2xs tracking-wider bg-accent/10 text-accent-hover'
                : 'px-1.5 py-0.5 rounded text-2xs tracking-wider bg-warn/10 text-warn'
            }
          >
            {traco.modo === 'perfilada' ? 'PERFILADA' : 'UNIFORME'}
          </span>
          {traco.direcao === -1 && (
            <span className="px-1.5 py-0.5 rounded text-2xs tracking-wider bg-warn/10 text-warn">
              ↺ retrocede
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, mut }: { k: string; v: string; mut?: boolean }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-text-dim whitespace-nowrap">{k}</span>
      <span className={`whitespace-nowrap ${mut ? 'text-text-muted' : 'text-text'}`}>{v}</span>
    </div>
  )
}
