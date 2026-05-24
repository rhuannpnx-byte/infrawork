import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/supabase/functions'
import type { PlanejamentoTarefaCompleta } from '@/types/planejamento'

export interface CronogramaResult {
  ok: boolean
  tarefas_recalculadas: number
  data_inicio: string
  data_fim: string
  duracao_total_dias_uteis: number
  duracao_total_dias_corridos: number
  caminho_critico_ids: string[]
  warning_drift?: boolean
  duracao_ms: number
}

export function useCalcularCronograma(): ReturnType<
  typeof useMutation<CronogramaResult, Error, { planejamento_id: string; force?: boolean }>
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body) => adminApi.calcularCronograma(body),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['planejamento', 'tarefas', vars.planejamento_id] })
      void qc.invalidateQueries({ queryKey: ['planejamento'] })
    }
  })
}

// ─── Curva-S planejada ──────────────────────────────────────────────────
// Agrega custo total das tarefas por bucket semanal (segunda-feira da semana).
// Curva acumulada normalizada (0..1) para sobrepor com baseline.

export interface CurvaSBucket {
  periodo: string // 'YYYY-MM-DD' (segunda da semana)
  custo_periodo: number
  custo_acumulado: number
  perc_acumulado: number
}

function startOfWeekMonday(d: Date): Date {
  const r = new Date(d)
  const dow = r.getUTCDay() // 0=dom
  const diff = dow === 0 ? -6 : 1 - dow
  r.setUTCDate(r.getUTCDate() + diff)
  return r
}

function isoWeek(d: Date): string {
  return startOfWeekMonday(d).toISOString().slice(0, 10)
}

export function calcularCurvaSemanal(
  tarefas: PlanejamentoTarefaCompleta[]
): CurvaSBucket[] {
  if (!tarefas?.length) return []

  // Distribui custo linearmente sobre os dias da tarefa.
  const buckets = new Map<string, number>()
  for (const t of tarefas) {
    if (!t.data_inicio || !t.data_fim || !t.custo_total_tarefa) continue
    const ini = new Date(t.data_inicio + 'T00:00:00Z')
    const fim = new Date(t.data_fim + 'T00:00:00Z')
    const diasMs = Math.max(1, (fim.getTime() - ini.getTime()) / (1000 * 60 * 60 * 24) + 1)
    const custoPorDia = t.custo_total_tarefa / diasMs
    const cur = new Date(ini)
    while (cur <= fim) {
      const wk = isoWeek(cur)
      buckets.set(wk, (buckets.get(wk) ?? 0) + custoPorDia)
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }

  const semanas = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, custo]) => ({ periodo, custo_periodo: custo }))

  const total = semanas.reduce((acc, s) => acc + s.custo_periodo, 0)
  let acumulado = 0
  return semanas.map((s) => {
    acumulado += s.custo_periodo
    return {
      periodo: s.periodo,
      custo_periodo: s.custo_periodo,
      custo_acumulado: acumulado,
      perc_acumulado: total > 0 ? acumulado / total : 0
    }
  })
}

export function useCurvaSPlanejada(
  planejamentoId: string | null | undefined,
  tarefas: PlanejamentoTarefaCompleta[] | undefined
): ReturnType<typeof useQuery<CurvaSBucket[]>> {
  return useQuery({
    queryKey: ['planejamento', 'curva-s', planejamentoId, tarefas?.length ?? 0],
    enabled: !!planejamentoId && !!tarefas,
    queryFn: () => calcularCurvaSemanal(tarefas ?? [])
  })
}
