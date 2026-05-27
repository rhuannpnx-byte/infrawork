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
// Agora puxa direto de perfil_semanas (jsonb_agg da view v2). Multiplica
// quantidade_planejada × custo_unit_snapshot por semana, agrega por
// semana_segunda, acumula e normaliza. Mais simples e mais correto que
// a distribuição linear anterior — reflete o perfil real (uniforme/
// sino/rampa/etc) e respeita paralisações.

export interface CurvaSBucket {
  periodo: string // 'YYYY-MM-DD' (segunda da semana)
  custo_periodo: number
  custo_acumulado: number
  perc_acumulado: number
}

export function calcularCurvaSemanal(
  tarefas: PlanejamentoTarefaCompleta[]
): CurvaSBucket[] {
  if (!tarefas?.length) return []

  const buckets = new Map<string, number>()
  for (const t of tarefas) {
    const custoUnit = Number(t.custo_unit_snapshot ?? 0)
    if (custoUnit <= 0) continue
    const semanas = t.perfil_semanas ?? []
    for (const s of semanas) {
      if (s.quantidade_planejada <= 0) continue
      const custoSemana = s.quantidade_planejada * custoUnit
      buckets.set(s.semana_segunda, (buckets.get(s.semana_segunda) ?? 0) + custoSemana)
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
