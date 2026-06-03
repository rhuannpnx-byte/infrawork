// MarchaTempoOpcoesPopover — substitui a toolbar inteira por um menu
// suspenso compacto. O botão "Filtros" abre o popover; tudo que estava na
// toolbar (modo, faixas selecionadas, toggles, export PDF) vive aqui.
// Multi-trecho fica fora (no PageHeader) por ser a seleção primária.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Clock,
  Flag,
  GitBranch,
  Moon,
  Printer,
  Repeat,
  SlidersHorizontal
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MultiColunaSelect } from './MultiColunaSelect'
import type { MarchaTempoOpcoes } from '@/types/planejamento'
import type { TrechoQuantidadeVersaoCompleta } from '@/types/quantidades'

interface MarchaTempoOpcoesPopoverProps {
  opcoes: MarchaTempoOpcoes
  onChangeOpcoes: (op: MarchaTempoOpcoes) => void
  templatesPorTrecho: Map<string, TrechoQuantidadeVersaoCompleta | null>
  onExportPdf: () => void
}

export function MarchaTempoOpcoesPopover({
  opcoes,
  onChangeOpcoes,
  templatesPorTrecho,
  onExportPdf
}: MarchaTempoOpcoesPopoverProps): ReactNode {
  const [aberto, setAberto] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const h = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setAberto(false)
    }
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', k)
    return (): void => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('keydown', k)
    }
  }, [aberto])

  const setOpc = (patch: Partial<MarchaTempoOpcoes>): void =>
    onChangeOpcoes({ ...opcoes, ...patch })

  // Contagem de filtros não-default pra badge no botão
  const filtrosCount =
    (opcoes.colunasQuantidade.length > 0 ? 1 : 0) +
    (opcoes.geom !== 'perfilada' ? 1 : 0) +
    (opcoes.mostrarConflitos ? 0 : 1) +
    (opcoes.mostrarMarcos ? 0 : 1) +
    (opcoes.mostrarNaoTrabalhado ? 0 : 1) +
    (!opcoes.eixosEspelhados ? 1 : 0) +
    (opcoes.mostrarDependencias ? 1 : 0) +
    (opcoes.mostrarTodayLine ? 0 : 1)

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded border transition-colors',
          aberto
            ? 'border-border-accent bg-accent/10 text-accent-hover'
            : 'border-border bg-bg-elevated text-text-muted hover:bg-bg-hover'
        )}
        title="Filtros + opções do diagrama"
      >
        <SlidersHorizontal size={13} />
        <span>Filtros</span>
        {filtrosCount > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-sm bg-accent text-bg text-2xs font-bold">
            {filtrosCount}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute top-full right-0 mt-2 z-50 w-[340px] rounded-md border border-border-strong bg-bg-menu shadow-2xl font-mono overflow-hidden">
          {/* Modo da trajetória */}
          <Secao titulo="Modo da trajetória">
            <div className="flex gap-1">
              <Seg
                active={opcoes.geom === 'perfilada'}
                onClick={() => setOpc({ geom: 'perfilada' })}
                icon={<Activity size={11} />}
              >
                Perfilada
              </Seg>
              <Seg
                active={opcoes.geom === 'uniforme'}
                onClick={() => setOpc({ geom: 'uniforme' })}
                icon={<Activity size={11} />}
              >
                Uniforme
              </Seg>
            </div>
            <p className="text-2xs text-text-faint mt-1.5 leading-snug">
              Perfilada respeita densidade do template. Uniforme = reta entre
              extremos.
            </p>
          </Secao>

          <div className="h-px bg-border" />

          {/* Faixas de quantidade */}
          <Secao titulo="Faixas de quantidade">
            <MultiColunaSelect
              templatesPorTrecho={templatesPorTrecho}
              selecionados={opcoes.colunasQuantidade}
              onChange={(nomes) => setOpc({ colunasQuantidade: nomes })}
            />
          </Secao>

          <div className="h-px bg-border" />

          {/* Camadas (toggles) */}
          <Secao titulo="Camadas">
            <div className="grid grid-cols-2 gap-1.5">
              <ToggleLi
                active={opcoes.mostrarConflitos}
                onClick={() => setOpc({ mostrarConflitos: !opcoes.mostrarConflitos })}
                icon={<AlertTriangle size={11} />}
                label="Conflitos"
              />
              <ToggleLi
                active={opcoes.mostrarMarcos}
                onClick={() => setOpc({ mostrarMarcos: !opcoes.mostrarMarcos })}
                icon={<Flag size={11} />}
                label="Marcos"
              />
              <ToggleLi
                active={opcoes.mostrarNaoTrabalhado}
                onClick={() =>
                  setOpc({ mostrarNaoTrabalhado: !opcoes.mostrarNaoTrabalhado })
                }
                icon={<Moon size={11} />}
                label="Não-trab."
              />
              <ToggleLi
                active={opcoes.eixosEspelhados}
                onClick={() => setOpc({ eixosEspelhados: !opcoes.eixosEspelhados })}
                icon={<Repeat size={11} />}
                label="Eixos espelhados"
              />
              <ToggleLi
                active={opcoes.mostrarDependencias}
                onClick={() =>
                  setOpc({ mostrarDependencias: !opcoes.mostrarDependencias })
                }
                icon={<GitBranch size={11} />}
                label="Dependências"
              />
              <ToggleLi
                active={opcoes.mostrarTodayLine}
                onClick={() => setOpc({ mostrarTodayLine: !opcoes.mostrarTodayLine })}
                icon={<Clock size={11} />}
                label="Today line"
                accent
              />
            </div>
          </Secao>

          <div className="h-px bg-border" />

          {/* Ação: exportar */}
          <div className="px-3 py-2.5">
            <button
              type="button"
              onClick={() => {
                setAberto(false)
                onExportPdf()
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded border border-border-strong bg-bg text-text hover:bg-bg-hover text-xs"
            >
              <Printer size={13} />
              <span>Exportar PDF (A4/A3)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Secao({
  titulo,
  children
}: {
  titulo: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="px-3 py-2.5">
      <div className="text-2xs uppercase tracking-wider text-text-dim mb-1.5">
        {titulo}
      </div>
      {children}
    </div>
  )
}

function Seg({
  active,
  onClick,
  icon,
  children
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs transition-colors',
        active
          ? 'border-border-accent bg-accent/10 text-accent-hover'
          : 'border-border bg-bg text-text-dim hover:bg-bg-hover'
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

function ToggleLi({
  active,
  onClick,
  icon,
  label,
  accent
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  accent?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1.5 rounded border text-2xs transition-colors',
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
