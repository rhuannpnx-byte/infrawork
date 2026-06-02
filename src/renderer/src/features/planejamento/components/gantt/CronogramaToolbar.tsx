// CronogramaToolbar — barra de controles entre header e split (Fase 1).
//
// Contém:
//   * Counters (N tarefas · M críticas · K selecionadas)
//   * Segmented (Ano | Mês | Semana | Dia) — presets de zoom
//   * Ajustar (fit-to-window) · Hoje (scroll to today)
//   * Zoom slider logarítmico + zoom in/out laterais + label de escala
//   * Botão Visualização (abre panel flutuante)
//
// O slider é logarítmico porque pxPerDay varia 2 ordens de magnitude
// (PX_PER_DAY_MIN=0.6 a PX_PER_DAY_MAX=50). Linear ficaria todo na ponta dia.

import { type ReactNode } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

export const PX_PER_DAY_MIN = 0.6
export const PX_PER_DAY_MAX = 50

export type EscalaPreset = 'ano' | 'mes' | 'semana' | 'dia'

interface CronogramaToolbarProps {
  nTarefas: number
  nCriticas: number
  nSelecionadas: number
  pxPerDay: number
  setPxPerDay: (px: number) => void
  scaleLabel: string
  escalaAtiva: EscalaPreset
  onPresetZoom: (preset: EscalaPreset) => void
  onAjustar: () => void
  onHoje: () => void
  vizPanelAberto: boolean
  onToggleVizPanel: () => void
}

const PRESETS: Array<{ key: EscalaPreset; label: string }> = [
  { key: 'ano', label: 'Ano' },
  { key: 'mes', label: 'Mês' },
  { key: 'semana', label: 'Semana' },
  { key: 'dia', label: 'Dia' }
]

export function CronogramaToolbar({
  nTarefas,
  nCriticas,
  nSelecionadas,
  pxPerDay,
  setPxPerDay,
  scaleLabel,
  escalaAtiva,
  onPresetZoom,
  onAjustar,
  onHoje,
  vizPanelAberto,
  onToggleVizPanel
}: CronogramaToolbarProps): ReactNode {
  const logMin = Math.log(PX_PER_DAY_MIN)
  const logMax = Math.log(PX_PER_DAY_MAX)
  const logVal = Math.log(pxPerDay)

  const clamped = (v: number): number =>
    Math.max(PX_PER_DAY_MIN, Math.min(PX_PER_DAY_MAX, v))

  return (
    <div className="flex items-center gap-2 px-4 h-11 border-b border-border bg-bg-panel">
      {/* Counters */}
      <div className="flex items-center gap-1.5 text-2xs font-mono text-text-dim uppercase tracking-wider">
        <span>
          <strong className="text-text">{nTarefas}</strong> tarefas
        </span>
        {nCriticas > 0 && (
          <>
            <span className="text-border-strong">·</span>
            <span className="text-danger">
              <strong>{nCriticas}</strong> crítica{nCriticas === 1 ? '' : 's'}
            </span>
          </>
        )}
        {nSelecionadas > 0 && (
          <>
            <span className="text-border-strong">·</span>
            <span className="text-accent">
              <strong>{nSelecionadas}</strong> selecionada{nSelecionadas === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Segmented control */}
      <div className="inline-flex items-stretch rounded border border-border-strong bg-bg-elevated overflow-hidden">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPresetZoom(p.key)}
            className={cn(
              'h-7 px-2.5 text-2xs font-mono uppercase tracking-wider transition-colors',
              'border-r border-border-strong last:border-r-0',
              escalaAtiva === p.key
                ? 'bg-accent text-[color:var(--primary-foreground)]'
                : 'text-text-dim hover:text-text hover:bg-bg-hover'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onAjustar}
        className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border-strong bg-bg-elevated text-2xs font-mono text-text-muted hover:text-text hover:bg-bg-hover"
        title="Ajustar projeto inteiro à janela (atalho: 0)"
      >
        <Maximize2 size={10} />
        <span>Ajustar</span>
      </button>

      <button
        type="button"
        onClick={onHoje}
        className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border-strong bg-bg-elevated text-2xs font-mono text-text-muted hover:text-text hover:bg-bg-hover"
        title="Centralizar em hoje (atalho: T)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
        <span>Hoje</span>
      </button>

      {/* Zoom slider */}
      <div className="flex items-center gap-1 ml-1">
        <button
          type="button"
          onClick={() => setPxPerDay(clamped(pxPerDay / 1.4))}
          className="inline-flex items-center justify-center h-7 w-7 rounded border border-border-strong bg-bg-elevated text-text-muted hover:text-text hover:bg-bg-hover"
          title="Diminuir zoom (atalho: -)"
        >
          <ZoomOut size={11} />
        </button>
        <input
          type="range"
          min={logMin}
          max={logMax}
          step={0.01}
          value={logVal}
          onChange={(e) => setPxPerDay(clamped(Math.exp(parseFloat(e.target.value))))}
          className="cronograma-zoom-slider w-32"
          title={`Zoom: ${pxPerDay.toFixed(1)} px/dia`}
        />
        <button
          type="button"
          onClick={() => setPxPerDay(clamped(pxPerDay * 1.4))}
          className="inline-flex items-center justify-center h-7 w-7 rounded border border-border-strong bg-bg-elevated text-text-muted hover:text-text hover:bg-bg-hover"
          title="Aumentar zoom (atalho: +)"
        >
          <ZoomIn size={11} />
        </button>
        <span className="ml-1 text-2xs font-mono text-text-dim min-w-[80px] tabular-nums">
          {scaleLabel}
        </span>
      </div>

      <span className="w-px h-5 bg-border-strong mx-1" />

      <button
        type="button"
        onClick={onToggleVizPanel}
        className={cn(
          'inline-flex items-center gap-1 h-7 px-2 rounded border text-2xs font-mono transition-colors',
          vizPanelAberto
            ? 'bg-accent/15 border-accent/40 text-accent'
            : 'border-border-strong bg-bg-elevated text-text-muted hover:text-text hover:bg-bg-hover'
        )}
        title="Opções de visualização"
      >
        <Eye size={11} />
        <span>Visualização</span>
      </button>
    </div>
  )
}
