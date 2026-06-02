// Recalc Bus — event emitter pra notificar componentes de que o cronograma
// foi recalculado (no client ou pelo Edge). Permite que Curva-S, dashboards,
// banner de alertas, etc. reajam ao recálculo sem prop-drilling.
//
// Critério 30 do Motor CPM: "Evento/callback scheduleRecalculated exposto
// para Gantt, dashboards e alertas reagirem".
//
// Uso:
//   import { recalcBus } from '@/features/planejamento/lib/recalc-bus'
//
//   useEffect(() => {
//     const unsub = recalcBus.on('scheduleRecalculated', (e) => {
//       console.log('recalc finalizado pra', e.planejamentoId)
//     })
//     return unsub
//   }, [])
//
//   // E em algum lugar onde o recálculo é confirmado:
//   recalcBus.emit('scheduleRecalculated', { planejamentoId, source: 'edge', durMs: 230 })

export interface ScheduleRecalculatedEvent {
  planejamentoId: string
  /** 'client' = motor hybrid local; 'edge' = edge function persistiu. */
  source: 'client' | 'edge'
  /** Tempo de cálculo em ms (instrumento de telemetry). */
  durMs: number
  /** Ids de tarefas no caminho crítico após o recálculo. */
  caminhoCriticoIds?: string[]
  /** Warnings agregados (constraint violado, drift, frozen). */
  warningCount?: number
}

export interface MutationDoneEvent {
  planejamentoId: string
  /** Hook ou origem da mutação (debug/telemetry). */
  source: string
  /** Hint pra UI: campos alterados (debug). */
  fields?: string[]
}

export interface ObraChangedEvent {
  obraId: string
  /** Hook ou origem da mutação (debug/telemetry). Ex.: 'calendario', 'excecao', 'fator-mes'. */
  source: string
}

type EventMap = {
  scheduleRecalculated: ScheduleRecalculatedEvent
  mutationDone: MutationDoneEvent
  /** Mudanças em nível de obra (calendário, exceções, fatores) que afetam
   *  todos os planejamentos dessa obra. Receivers filtram por obraId. */
  obraChanged: ObraChangedEvent
}

type EventName = keyof EventMap
type AnyListener = (payload: unknown) => void

class RecalcBus {
  // Listeners armazenados com type unknown — on/emit fazem cast tipado.
  // O type-checker garante segurança no API público; interno é casted.
  private listeners = new Map<EventName, Set<AnyListener>>()

  on<K extends EventName>(event: K, listener: (e: EventMap[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as AnyListener)
    return () => {
      set?.delete(listener as AnyListener)
    }
  }

  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const l of Array.from(set)) {
      try {
        ;(l as (e: EventMap[K]) => void)(payload)
      } catch (e) {
        console.error('recalc-bus listener falhou:', e)
      }
    }
  }
}

export const recalcBus = new RecalcBus()
