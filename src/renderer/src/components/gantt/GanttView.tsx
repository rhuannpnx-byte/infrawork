import { useEffect, useRef, type ReactNode } from 'react'
import Gantt from 'frappe-gantt'
import './frappe-base.css'
import './gantt-theme.css'
export type GanttDependenciaTipo = 'FS' | 'SS' | 'FF' | 'SF'

export interface GanttDependencia {
  tarefaId: string
  tipo: GanttDependenciaTipo
  lag?: number
}

export interface GanttTask {
  id: string
  codigoEAP: string
  nome: string
  inicio: string // ISO
  fim: string // ISO
  duracaoDias: number
  progresso: number // 0-100
  responsavel?: string
  parentId?: string | null
  dependencias: GanttDependencia[]
  isMarco: boolean
  emCaminhoCritico: boolean
}

type TarefaPlanejamento = GanttTask

type ViewMode = 'Day' | 'Week' | 'Month' | 'Quarter Day' | 'Half Day' | 'Year'

interface GanttViewProps {
  tasks: TarefaPlanejamento[]
  viewMode?: ViewMode
  onTaskClick?: (task: TarefaPlanejamento) => void
  onDateChange?: (task: TarefaPlanejamento, start: Date, end: Date) => void
  onProgressChange?: (task: TarefaPlanejamento, progress: number) => void
  showCriticalPath?: boolean
}

function toFrappeTasks(tasks: TarefaPlanejamento[]): Array<Record<string, unknown>> {
  const idMap = new Map(tasks.map((t) => [t.id, t]))
  return tasks.map((t) => {
    const dependencies = t.dependencias
      .map((d) => idMap.get(d.tarefaId)?.id)
      .filter(Boolean)
      .join(', ')
    const customClass = [
      t.emCaminhoCritico ? 'critical' : '',
      t.isMarco ? 'milestone' : '',
      t.parentId === null ? 'is-summary' : ''
    ]
      .filter(Boolean)
      .join(' ')
    return {
      id: t.id,
      name: `${t.codigoEAP} ${t.nome}`,
      start: t.inicio,
      end: t.fim,
      progress: t.progresso,
      dependencies,
      custom_class: customClass
    }
  })
}

export function GanttView({
  tasks,
  viewMode = 'Month',
  onTaskClick,
  onDateChange,
  onProgressChange,
  showCriticalPath = true
}: GanttViewProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<Gantt | null>(null)

  useEffect(() => {
    if (!containerRef.current || tasks.length === 0) return

    const visibleTasks = showCriticalPath ? tasks : tasks.filter((t) => !t.emCaminhoCritico || true)
    const frappeTasks = toFrappeTasks(visibleTasks)
    const byId = new Map(tasks.map((t) => [t.id, t]))

    containerRef.current.innerHTML = ''

    ganttRef.current = new Gantt(containerRef.current, frappeTasks, {
      view_mode: viewMode,
      bar_height: 18,
      bar_corner_radius: 3,
      arrow_curve: 4,
      padding: 14,
      header_height: 44,
      column_width: viewMode === 'Day' ? 28 : viewMode === 'Week' ? 110 : 140,
      step: 24,
      language: 'ptBR',
      date_format: 'YYYY-MM-DD',
      popup: (task: { id: string }) => {
        const t = byId.get(task.id)
        if (!t) return ''
        return `
          <div class="popup-wrapper">
            <div class="title">${t.codigoEAP} · ${t.nome}</div>
            <div class="subtitle">
              ${new Date(t.inicio).toLocaleDateString('pt-BR')} → ${new Date(t.fim).toLocaleDateString('pt-BR')}<br/>
              ${t.duracaoDias} dias · ${t.progresso}% concluído
              ${t.responsavel ? `<br/>Resp.: ${t.responsavel}` : ''}
              ${t.emCaminhoCritico ? '<br/><span style="color:#f87171">⚠ caminho crítico</span>' : ''}
            </div>
          </div>
        `
      },
      on_click: (task: { id: string }) => {
        const t = byId.get(task.id)
        if (t) onTaskClick?.(t)
      },
      on_date_change: (task: { id: string }, start: Date, end: Date) => {
        const t = byId.get(task.id)
        if (t) onDateChange?.(t, start, end)
      },
      on_progress_change: (task: { id: string }, progress: number) => {
        const t = byId.get(task.id)
        if (t) onProgressChange?.(t, progress)
      }
    } as unknown as ConstructorParameters<typeof Gantt>[2])

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = ''
      ganttRef.current = null
    }
  }, [tasks, viewMode, showCriticalPath, onTaskClick, onDateChange, onProgressChange])

  return <div ref={containerRef} className="gantt-target w-full h-full overflow-auto" />
}
