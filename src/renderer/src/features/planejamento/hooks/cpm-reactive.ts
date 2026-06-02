// CPM Reactive Hook — orquestração hybrid (client preview + Edge persist).
//
// Fase 3.4 do Motor CPM: este hook
//   1. roda `computeCpm` localmente após cada mudança (instantâneo),
//   2. faz optimistic update no cache do React Query pra UI refletir já,
//   3. agenda o `calcular-cronograma` Edge debounçado (300ms) pra persistir
//      canonicamente,
//   4. emite no `recalcBus` quando o Edge confirma.
//
// Critérios cobertos:
//   * 27 (UI não trava): cálculo local é puro JS, <50ms pra projetos típicos.
//   * 29 (cronograma nunca stale): optimistic update sobrescreve cache.
//   * 30 (callback scheduleRecalculated): emitido em cada confirmação.
//   * 26 (debounce/coalescing): edições em rajada viram 1 chamada Edge.
//
// O hook é seguro contra race conditions: serializa chamadas Edge via
// `recalcStateRef` (já existente em GanttChart, agora movido pra cá).
//
// IMPORTANTE: NÃO é nada parecido com um useState global. Cada chamada de
// `requestRecalc()` é fire-and-forget; UI continua reativa via React Query.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  ObraCalendario,
  ObraCalendarioExcecao,
  ObraProdutividadeMes,
  Planejamento,
  PlanejamentoTarefaCompleta
} from '@/types/planejamento'
import { CpmCycleError, computeCpm, type CpmResult } from '../lib/cpm-engine'
import type { CalendarioCtx } from '../lib/cronograma-pure'
import { parseISO } from '../lib/cronograma-pure'
import { recalcBus } from '../lib/recalc-bus'
import { useCalcularCronograma } from './cronograma'

interface UseCpmEngineInput {
  planejamento: Planejamento | null | undefined
  tarefas: PlanejamentoTarefaCompleta[]
  calendario: ObraCalendario | null | undefined
  excecoes: ObraCalendarioExcecao[]
  fatoresMes: ObraProdutividadeMes[]
  /** Quando true (default), dispara Edge recalc debounçado após mudanças. */
  edgeEnabled?: boolean
  /** Debounce window em ms (default 300). */
  debounceMs?: number
}

export interface UseCpmEngineReturn {
  /** Snapshot mais recente do CPM client. NULL antes do primeiro compute. */
  cpm: CpmResult | null
  /** Erro de ciclo detectado no client (ids envolvidos). NULL se sem ciclo. */
  cicloIds: string[] | null
  /** Dispara recálculo manual (Edge canônico). Útil pro botão "Recalcular". */
  requestRecalc: () => void
  /** True enquanto Edge está rodando. */
  edgeRunning: boolean
}

export function useCpmEngine(input: UseCpmEngineInput): UseCpmEngineReturn {
  const {
    planejamento,
    tarefas,
    calendario,
    excecoes,
    fatoresMes,
    edgeEnabled = true,
    debounceMs = 300
  } = input
  const qc = useQueryClient()
  const calcular = useCalcularCronograma()

  // Constrói CalendarioCtx (Maps) de forma estável — useMemo evita
  // re-criação a cada render do componente consumidor.
  const calcCtx = useMemo<CalendarioCtx>(() => {
    const bitmask = calendario?.dias_uteis_bitmask ?? 31
    const excMap = new Map<string, boolean>()
    for (const e of excecoes) excMap.set(e.data, !!e.eh_util)
    const fatorMap = new Map<string, number>()
    for (const f of fatoresMes) fatorMap.set(f.ano_mes.slice(0, 7), Number(f.fator))
    return { bitmask, excecoes: excMap, fatorMes: fatorMap }
  }, [calendario, excecoes, fatoresMes])

  // Run client CPM. Memoizado em (tarefas, ctx, projectStart, dataDate).
  const { cpm, cicloIds } = useMemo<{
    cpm: CpmResult | null
    cicloIds: string[] | null
  }>(() => {
    if (!planejamento || tarefas.length === 0) return { cpm: null, cicloIds: null }
    try {
      const result = computeCpm({
        tarefas,
        calendario: calcCtx,
        projectStart: parseISO(planejamento.data_referencia_inicio),
        dataDate: planejamento.data_date ? parseISO(planejamento.data_date) : null
      })
      // Emite no bus pra dashboards reagirem (source=client = preview).
      recalcBus.emit('scheduleRecalculated', {
        planejamentoId: planejamento.id,
        source: 'client',
        durMs: result.duracao_ms,
        caminhoCriticoIds: result.caminhoCritico,
        warningCount: result.warnings.length
      })
      return { cpm: result, cicloIds: null }
    } catch (e) {
      if (e instanceof CpmCycleError) {
        return { cpm: null, cicloIds: e.nodes }
      }
      throw e
    }
  }, [planejamento, tarefas, calcCtx])

  // Optimistic update: aplica os campos CPM client no cache pra UI mostrar
  // sem esperar Edge. Edge function reescreverá esses mesmos campos no fim.
  useEffect(() => {
    if (!cpm || !planejamento) return
    const queryKey = ['planejamento', 'tarefas', planejamento.id]
    qc.setQueryData<PlanejamentoTarefaCompleta[]>(queryKey, (old) => {
      if (!old) return old
      return old.map((t) => {
        const r = cpm.porTarefa.get(t.id)
        if (!r) return t
        return {
          ...t,
          data_inicio: r.data_inicio,
          data_fim: r.data_fim,
          duracao_dias_uteis_calc: r.duracao_dias_uteis,
          early_start: r.early_start,
          early_finish: r.early_finish,
          late_start: r.late_start,
          late_finish: r.late_finish,
          total_float: r.total_float,
          free_float: r.free_float,
          is_critico: r.is_critico
        }
      })
    })
  }, [cpm, planejamento, qc])

  // ─── Edge debounce serializado ─────────────────────────────────────────
  // Estratégia simplificada (post-HMR friendly): usa `calcular.isPending` como
  // sinal de "running". `pendingRef` marca se uma rajada ocorreu enquanto
  // estava rodando — useEffect observa isPending cair e dispara follow-up.
  // Sem self-reference ref-loop (que causava hook order errors no HMR).
  const pendingRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fireEdgeRecalc = useCallback(() => {
    if (!planejamento || !edgeEnabled) return
    if (calcular.isPending) {
      pendingRef.current = true
      return
    }
    const t0 = performance.now()
    calcular.mutate(
      { planejamento_id: planejamento.id },
      {
        onSuccess: (result) => {
          recalcBus.emit('scheduleRecalculated', {
            planejamentoId: planejamento.id,
            source: 'edge',
            durMs: result.duracao_ms ?? Math.round(performance.now() - t0),
            caminhoCriticoIds: result.caminho_critico_ids,
            warningCount: 0
          })
        }
      }
    )
  }, [planejamento, edgeEnabled, calcular])

  // Follow-up: quando isPending cair de true→false e tinha pending, refire.
  // useEffect (não setTimeout dentro de callback) — evita race + HMR safe.
  useEffect(() => {
    if (calcular.isPending) return
    if (pendingRef.current) {
      pendingRef.current = false
      fireEdgeRecalc()
    }
  }, [calcular.isPending, fireEdgeRecalc])

  // Debounced trigger: chamadas em rajada (< debounceMs) viram 1 só Edge.
  const requestRecalc = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      fireEdgeRecalc()
    }, debounceMs)
  }, [fireEdgeRecalc, debounceMs])

  // Limpa timer pendente no unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  // Subscreve mutationDone — qualquer hook de mutation que afeta cronograma
  // emite no bus; aqui debouncamos pra disparar UM Edge recalc no fim da
  // rajada. Cobre critérios 19-24 (todos os triggers) sem prop-drilling.
  useEffect(() => {
    if (!planejamento) return
    const unsubMut = recalcBus.on('mutationDone', (e) => {
      if (e.planejamentoId !== planejamento.id) return
      requestRecalc()
    })
    // Calendário (bitmask, exceções, fatores) é por obra — recalcular se a
    // mudança veio da obra DESTE planejamento.
    const unsubObra = recalcBus.on('obraChanged', (e) => {
      if (e.obraId !== planejamento.obra_id) return
      requestRecalc()
    })
    return () => {
      unsubMut()
      unsubObra()
    }
  }, [planejamento, requestRecalc])

  return {
    cpm,
    cicloIds,
    requestRecalc,
    edgeRunning: calcular.isPending
  }
}
