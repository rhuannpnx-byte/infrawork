// CronogramaHeader — header do redesign Gantt (Fase 1).
//
// Substitui o PageHeader genérico nesta tela. Inclui:
//   * Breadcrumb "Cronograma" + h1 nome da obra
//   * Chip de revisão (dropdown nativo no select)
//   * Chip "⚠ N pendências · Revisar" — clica e filtra grade
//   * Actions: Adicionar / Recalcular / Baseline
//
// Subindo do GanttChart.tsx, esses controles ficavam espalhados entre o
// PageHeader.actions e um banner amarelo separado. O redesign consolida tudo
// num único header coerente.

import { type ReactNode } from 'react'
import { Plus, RefreshCw, Star, AlertCircle, ChevronDown, FileDown, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Planejamento } from '@/types/planejamento'

interface CronogramaHeaderProps {
  obraNome: string
  planejamentos: Planejamento[]
  planejamentoId: string | null
  onChangePlanejamento: (id: string) => void
  pendencias: number
  pendenciasFilterAtivo: boolean
  onTogglePendenciasFilter: () => void
  onNovaRevisao: () => void
  onNovaTarefa: () => void
  onRecalcular: () => void
  recalculando: boolean
  onBaseline: () => void
  podeEditar: boolean
  isBaseline: boolean
  /** Exporta o cronograma atual para MS Project XML. */
  onExportarMsProject?: () => void
  exportandoMsProject?: boolean
  /** Abre o wizard de importação do MS Project. */
  onImportarMsProject?: () => void
}

export function CronogramaHeader({
  obraNome,
  planejamentos,
  planejamentoId,
  onChangePlanejamento,
  pendencias,
  pendenciasFilterAtivo,
  onTogglePendenciasFilter,
  onNovaRevisao,
  onNovaTarefa,
  onRecalcular,
  recalculando,
  onBaseline,
  podeEditar,
  isBaseline,
  onExportarMsProject,
  exportandoMsProject,
  onImportarMsProject
}: CronogramaHeaderProps): ReactNode {
  return (
    <header className="flex items-center justify-between gap-4 px-5 py-3 border-b border-border bg-bg-panel">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-2xs font-mono text-text-dim uppercase tracking-wider mb-0.5">
          Cronograma
        </div>
        <h1 className="text-md font-semibold text-text truncate" title={obraNome}>
          {obraNome}
        </h1>
      </div>

      {/* Bloco de revisão + pendências */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Revisão chip — select estilizado */}
        <label className="relative inline-flex items-center">
          <span className="absolute left-2 pointer-events-none text-amber-400">★</span>
          <select
            value={planejamentoId ?? ''}
            onChange={(e) => onChangePlanejamento(e.target.value)}
            className={cn(
              'h-7 pl-6 pr-7 rounded text-2xs font-mono',
              'bg-bg-elevated border border-border-strong text-text',
              'hover:bg-bg-hover hover:border-border-accent',
              'focus:outline-none focus:ring-1 focus:ring-accent',
              'appearance-none cursor-pointer'
            )}
            title="Trocar revisão"
          >
            {planejamentos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.is_baseline ? ' ★' : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            size={10}
            className="absolute right-2 pointer-events-none text-text-dim"
          />
        </label>

        {/* Pendências chip */}
        {pendencias > 0 && (
          <button
            type="button"
            onClick={onTogglePendenciasFilter}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-2xs font-mono',
              'border transition-colors',
              pendenciasFilterAtivo
                ? 'bg-warn/20 border-warn/60 text-warn'
                : 'bg-warn/10 border-warn/30 text-warn hover:bg-warn/15'
            )}
            title="Filtrar tarefas com pendência"
          >
            <AlertCircle size={11} />
            <span>
              <strong>{pendencias}</strong> pendência{pendencias === 1 ? '' : 's'} · Revisar
            </span>
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="ghost" onClick={onNovaRevisao}>
          <Plus size={11} /> Nova revisão
        </Button>
        {onExportarMsProject && (
          <Button size="sm" variant="ghost" onClick={onExportarMsProject} disabled={exportandoMsProject} title="Exportar para MS Project (XML)">
            <FileDown size={11} className={exportandoMsProject ? 'animate-pulse' : ''} /> Project
          </Button>
        )}
        {podeEditar && onImportarMsProject && (
          <Button size="sm" variant="ghost" onClick={onImportarMsProject} title="Importar do MS Project (XML)">
            <FileUp size={11} /> Importar
          </Button>
        )}
        {podeEditar && (
          <>
            <Button size="sm" variant="default" onClick={onNovaTarefa}>
              <Plus size={11} /> Adicionar
            </Button>
            <Button size="sm" variant="outline" onClick={onRecalcular} disabled={recalculando}>
              <RefreshCw size={11} className={recalculando ? 'animate-spin' : ''} />
              {recalculando ? 'Calculando…' : 'Recalcular'}
            </Button>
            {!isBaseline && (
              <Button size="sm" variant="ghost" onClick={onBaseline}>
                <Star size={11} /> Baseline
              </Button>
            )}
          </>
        )}
      </div>
    </header>
  )
}
