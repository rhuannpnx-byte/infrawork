import type { ReactNode } from 'react'
import {
  ArrowLeftRight,
  Flag,
  GitBranch,
  Activity,
  Clock,
  CalendarRange,
  Ruler
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MultiTrechoSelect, type TrechoOpcao } from './MultiTrechoSelect'
import { MultiColunaSelect } from './MultiColunaSelect'
import type { GranularidadeTempo, MarchaTempoOpcoes } from '@/types/planejamento'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

interface MarchaTempoToolbarProps {
  trechos: TrechoOpcao[]
  selecionados: string[]
  onChangeSelecionados: (ids: string[]) => void
  opcoes: MarchaTempoOpcoes
  onChangeOpcoes: (op: MarchaTempoOpcoes) => void
  /** Templates dos trechos visíveis — fonte das colunas pro multi-select de quantidades. */
  templatesPorTrecho: Map<string, TrechoQuantidadeVersaoCompleta | null>
}

/**
 * Toolbar do TILOS: multi-select de trechos + toggles (eixo, geom, extras).
 * Faz override do `MarchaTempoOpcoes` via callback do consumidor.
 */
export function MarchaTempoToolbar({
  trechos,
  selecionados,
  onChangeSelecionados,
  opcoes,
  onChangeOpcoes,
  templatesPorTrecho
}: MarchaTempoToolbarProps): ReactNode {
  const setOpc = (patch: Partial<MarchaTempoOpcoes>): void =>
    onChangeOpcoes({ ...opcoes, ...patch })

  return (
    <div className="flex items-center flex-wrap gap-2 px-3 py-2 bg-bg-panel border border-border rounded">
      <MultiTrechoSelect
        trechos={trechos}
        selecionados={selecionados}
        onChange={onChangeSelecionados}
      />

      <div className="h-5 w-px bg-border mx-1" />

      <ToggleBtn
        active={opcoes.eixoXTempo}
        onClick={() => setOpc({ eixoXTempo: !opcoes.eixoXTempo })}
        icon={<ArrowLeftRight size={12} />}
        label={opcoes.eixoXTempo ? 'X: Tempo · Y: Caminho' : 'X: Caminho · Y: Tempo'}
        title="Inverter eixos"
      />

      <ToggleBtn
        active={opcoes.geom === 'perfilada'}
        onClick={() =>
          setOpc({ geom: opcoes.geom === 'perfilada' ? 'uniforme' : 'perfilada' })
        }
        icon={<Activity size={12} />}
        label={opcoes.geom === 'perfilada' ? 'Perfilada' : 'Uniforme'}
        title="Modo da trajetória: perfilada usa template; uniforme usa linha reta"
      />

      <div className="h-5 w-px bg-border mx-1" />

      <SelectField
        icon={<CalendarRange size={12} />}
        label="Tempo"
        value={opcoes.granularidadeTempo}
        onChange={(v) => setOpc({ granularidadeTempo: v as GranularidadeTempo })}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'diario', label: 'Diário' },
          { value: 'semanal', label: 'Semanal' },
          { value: 'mensal', label: 'Mensal' }
        ]}
      />

      <SelectField
        icon={<Ruler size={12} />}
        label="Passo"
        value={opcoes.passoPosicaoM == null ? 'auto' : String(opcoes.passoPosicaoM)}
        onChange={(v) =>
          setOpc({ passoPosicaoM: v === 'auto' ? null : Number(v) })
        }
        options={[
          { value: 'auto', label: 'Auto' },
          { value: '1', label: '1 m' },
          { value: '10', label: '10 m' },
          { value: '25', label: '25 m' },
          { value: '50', label: '50 m' },
          { value: '100', label: '100 m' },
          { value: '250', label: '250 m' },
          { value: '500', label: '500 m' },
          { value: '1000', label: '1 km' },
          { value: '5000', label: '5 km' },
          { value: '10000', label: '10 km' }
        ]}
      />

      <div className="h-5 w-px bg-border mx-1" />

      <MultiColunaSelect
        templatesPorTrecho={templatesPorTrecho}
        selecionados={opcoes.colunasQuantidade}
        onChange={(nomes) => setOpc({ colunasQuantidade: nomes })}
      />

      <div className="h-5 w-px bg-border mx-1" />

      <ToggleBtn
        active={opcoes.mostrarMarcos}
        onClick={() => setOpc({ mostrarMarcos: !opcoes.mostrarMarcos })}
        icon={<Flag size={12} />}
        label="Marcos"
      />
      <ToggleBtn
        active={opcoes.mostrarDependencias}
        onClick={() => setOpc({ mostrarDependencias: !opcoes.mostrarDependencias })}
        icon={<GitBranch size={12} />}
        label="Dependências"
      />
      <ToggleBtn
        active={opcoes.mostrarTodayLine}
        onClick={() => setOpc({ mostrarTodayLine: !opcoes.mostrarTodayLine })}
        icon={<Clock size={12} />}
        label="Today line"
      />
    </div>
  )
}

interface SelectFieldProps {
  icon: ReactNode
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}

function SelectField({ icon, label, value, onChange, options }: SelectFieldProps): ReactNode {
  return (
    <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-bg text-xs font-mono text-text-dim">
      {icon}
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent border-0 text-text outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-bg-elevated">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

interface ToggleBtnProps {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  title?: string
}

function ToggleBtn({ active, onClick, icon, label, title }: ToggleBtnProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
