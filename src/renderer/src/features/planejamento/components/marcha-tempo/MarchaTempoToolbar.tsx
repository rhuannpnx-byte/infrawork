import type { ReactNode } from 'react'
import {
  Flag,
  GitBranch,
  Activity,
  Clock,
  AlertTriangle,
  Moon,
  Repeat,
  Printer
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MultiTrechoSelect, type TrechoOpcao } from './MultiTrechoSelect'
import { MultiColunaSelect } from './MultiColunaSelect'
import type { MarchaTempoOpcoes } from '@/types/planejamento'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

interface MarchaTempoToolbarProps {
  trechos: TrechoOpcao[]
  selecionados: string[]
  onChangeSelecionados: (ids: string[]) => void
  opcoes: MarchaTempoOpcoes
  onChangeOpcoes: (op: MarchaTempoOpcoes) => void
  templatesPorTrecho: Map<string, TrechoQuantidadeVersaoCompleta | null>
  onExportPdf: () => void
}

export function MarchaTempoToolbar({
  trechos,
  selecionados,
  onChangeSelecionados,
  opcoes,
  onChangeOpcoes,
  templatesPorTrecho,
  onExportPdf
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

      <span className="text-2xs font-mono text-text-dim tracking-wider px-2 py-0.5 border border-border rounded bg-bg">
        X Caminho<span className="text-text-faint mx-1">·</span>Y Tempo
      </span>

      <div className="h-5 w-px bg-border mx-1" />

      <ToggleBtn
        active={opcoes.geom === 'perfilada'}
        onClick={() =>
          setOpc({ geom: opcoes.geom === 'perfilada' ? 'uniforme' : 'perfilada' })
        }
        icon={<Activity size={12} />}
        label={opcoes.geom === 'perfilada' ? 'Perfilada' : 'Uniforme'}
        title="Modo da trajetória: perfilada usa template; uniforme = reta entre extremos"
      />

      <MultiColunaSelect
        templatesPorTrecho={templatesPorTrecho}
        selecionados={opcoes.colunasQuantidade}
        onChange={(nomes) => setOpc({ colunasQuantidade: nomes })}
      />

      <div className="h-5 w-px bg-border mx-1" />

      <ToggleBtn
        active={opcoes.mostrarConflitos}
        onClick={() => setOpc({ mostrarConflitos: !opcoes.mostrarConflitos })}
        icon={<AlertTriangle size={12} />}
        label="Conflitos"
        title="Anéis vermelhos onde 2 trajetórias se cruzam"
      />
      <ToggleBtn
        active={opcoes.mostrarMarcos}
        onClick={() => setOpc({ mostrarMarcos: !opcoes.mostrarMarcos })}
        icon={<Flag size={12} />}
        label="Marcos"
      />
      <ToggleBtn
        active={opcoes.mostrarNaoTrabalhado}
        onClick={() => setOpc({ mostrarNaoTrabalhado: !opcoes.mostrarNaoTrabalhado })}
        icon={<Moon size={12} />}
        label="Não-trab."
        title="Sombrear sábados/domingos/feriados"
      />
      <ToggleBtn
        active={opcoes.eixosEspelhados}
        onClick={() => setOpc({ eixosEspelhados: !opcoes.eixosEspelhados })}
        icon={<Repeat size={12} />}
        label="Eixos espelhados"
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
        accent
      />

      <div className="h-5 w-px bg-border mx-1" />

      <button
        type="button"
        onClick={onExportPdf}
        title="Exportar diagrama em PDF (A4/A3 · retrato/paisagem)"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono border-border bg-bg text-text-dim hover:bg-bg-hover"
      >
        <Printer size={12} />
        <span>Exportar PDF</span>
      </button>
    </div>
  )
}

interface ToggleBtnProps {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  title?: string
  accent?: boolean
}

function ToggleBtn({ active, onClick, icon, label, title, accent }: ToggleBtnProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono',
        active
          ? accent
            ? 'border-warn/40 bg-warn/10 text-warn'
            : 'border-border-accent bg-accent/10 text-accent-hover'
          : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
