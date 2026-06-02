// VisualizacaoPanel — painel flutuante 280px top-right (Fase 1).
//
// Substitui o "Tweaks panel" do protótipo: opções de visualização sob demanda,
// abertas via botão Eye da Toolbar. Fecha com Escape ou X. Persiste em
// localStorage via useCronogramaTweaks.

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useCronogramaTweaks,
  type BarStyle,
  type DepMode,
  type Density,
  type ColorMode
} from '../../hooks/useCronogramaTweaks'

interface VisualizacaoPanelProps {
  onClose: () => void
}

export function VisualizacaoPanel({ onClose }: VisualizacaoPanelProps): ReactNode {
  const { tweaks, setTweak } = useCronogramaTweaks()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-label="Opções de visualização"
      className={cn(
        'absolute top-3 right-3 z-30 w-[280px] rounded-md shadow-lg',
        'bg-bg-panel border border-border-strong',
        'animate-slide-up'
      )}
    >
      <div className="flex items-center justify-between px-3 h-9 border-b border-border">
        <span className="text-2xs font-mono uppercase tracking-wider text-text-muted">
          Visualização
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-dim hover:text-text"
          title="Fechar (Esc)"
        >
          <X size={12} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <SegmentedGroup<ColorMode>
          label="Cor das barras"
          value={tweaks.colorMode}
          onChange={(v) => setTweak('colorMode', v)}
          options={[
            { value: 'tipo', label: 'Padrão' },
            { value: 'equipe', label: 'Por equipe' },
            { value: 'status', label: 'Por status' }
          ]}
        />

        <SegmentedGroup<BarStyle>
          label="Estilo"
          value={tweaks.barStyle}
          onChange={(v) => setTweak('barStyle', v)}
          options={[
            { value: 'solid', label: 'Sólido' },
            { value: 'gradient', label: 'Gradiente' },
            { value: 'textured', label: 'Textura' }
          ]}
        />

        <SegmentedGroup<DepMode>
          label="Dependências"
          value={tweaks.depMode}
          onChange={(v) => setTweak('depMode', v)}
          options={[
            { value: 'ortho', label: 'Ortogonais' },
            { value: 'curve', label: 'Curvas' }
          ]}
        />

        <SegmentedGroup<Density>
          label="Densidade"
          value={tweaks.density}
          onChange={(v) => setTweak('density', v)}
          options={[
            { value: 'compact', label: 'Compacta' },
            { value: 'regular', label: 'Padrão' },
            { value: 'comfy', label: 'Confortável' }
          ]}
        />

        <div className="space-y-1.5 pt-2 border-t border-border">
          <CheckboxRow
            label="Nomes nas barras"
            checked={tweaks.showLabels}
            onChange={(v) => setTweak('showLabels', v)}
          />
          <CheckboxRow
            label="Marcar fins de semana e feriados"
            checked={tweaks.showWeekends}
            onChange={(v) => setTweak('showWeekends', v)}
          />
          <CheckboxRow
            label="Propagar datas automaticamente (CPM)"
            checked={tweaks.autoPropagate}
            onChange={(v) => setTweak('autoPropagate', v)}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Internos ──────────────────────────────────────────────────────────────

interface SegmentedGroupProps<T extends string> {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}

function SegmentedGroup<T extends string>({
  label,
  value,
  options,
  onChange
}: SegmentedGroupProps<T>): ReactNode {
  return (
    <div>
      <div className="text-2xs font-mono uppercase tracking-wider text-text-dim mb-1">
        {label}
      </div>
      <div className="inline-flex items-stretch rounded border border-border-strong bg-bg-elevated overflow-hidden w-full">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 h-7 px-2 text-2xs font-mono transition-colors',
              i < options.length - 1 && 'border-r border-border-strong',
              value === o.value
                ? 'bg-accent text-[color:var(--primary-foreground)]'
                : 'text-text-muted hover:text-text hover:bg-bg-hover'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function CheckboxRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): ReactNode {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-xs text-text-muted hover:text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent"
      />
      <span>{label}</span>
    </label>
  )
}
