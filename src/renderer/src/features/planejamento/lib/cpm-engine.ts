// CPM Engine — client-side (motor hybrid Fase 3).
//
// Espelha a lógica do edge function `calcular-cronograma` em função pura que
// roda no renderer pra dar feedback instantâneo após cada mutation, sem
// esperar HTTP. Edge permanece como source-of-truth pra persistência (datas,
// perfis, baseline imutável); o client só "prediz" o resultado pra UI exibir
// imediatamente, e debounça o recálculo edge.
//
// Escopo (2026-06, alinhamento com motor server):
//   * Forward pass (ES/EF) via `calcularDuracaoDiaria` — fator_mes aplicado
//     POR DIA ÚTIL, igual ao edge. Inclui MSO/SNET/FNET, Data Date, âncora.
//   * Backward pass (LS/LF) — FS/SS/FF/SF + FNLT/MFO/SNLT + ALAP.
//   * Total Float, Free Float (clamp em 0), caminho crítico.
//   * Ciclo detection (Kahn). Erro claro com nodes envolvidos.
//   * Warnings (constraint_violated, constraint_finish_violated, drift,
//     frozen_data_date).
//
// Fora de escopo:
//   * Persistência (Curva-S / perfil_semana — Edge faz).
//   * Validação de ciclos em RPC PostgreSQL — Kahn local cobre.

import {
  calcularDuracaoDiaria,
  type CalendarioCtx,
  addWorkDays,
  diffWorkDays,
  isoDate,
  nextWorkDay,
  parseISO,
  shiftWorkDays
} from './cronograma-pure'

import type {
  ConstraintType,
  DependenciaTipo,
  PlanejamentoTarefaCompleta,
  PredecessoraRef,
  ScheduleMode
} from '@/types/planejamento'

// ─── Inputs / Outputs ────────────────────────────────────────────────────

export interface CpmInput {
  /** Todas as tarefas do planejamento (grupos/marcos incluídos). */
  tarefas: PlanejamentoTarefaCompleta[]
  /** Contexto de calendário (bitmask + exceções + fatores mensais). */
  calendario: CalendarioCtx
  /** Data-âncora do projeto (data_referencia_inicio). */
  projectStart: Date
  /** Data Date (status date). NULL = sem freeze. */
  dataDate?: Date | null
}

export interface CpmTaskResult {
  /** Early Start em ISO. NULL para grupos/inválidas. */
  early_start: string | null
  early_finish: string | null
  late_start: string | null
  late_finish: string | null
  /** Total Float em dias úteis. */
  total_float: number | null
  /** Free Float em dias úteis. */
  free_float: number | null
  is_critico: boolean
  /** Datas exibidas no Gantt (= ES/EF salvo se ALAP shifta pra LS/LF). */
  data_inicio: string | null
  data_fim: string | null
  duracao_dias_uteis: number
  frozen: boolean
}

export type CpmWarning =
  | { tarefa_id: string; tipo: 'constraint_violated'; detalhe: string }
  | { tarefa_id: string; tipo: 'constraint_finish_violated'; detalhe: string }
  | { tarefa_id: string; tipo: 'drift_anterior_ancora' }
  | { tarefa_id: string; tipo: 'frozen_data_date'; detalhe: string }
  | { tarefa_id: string; tipo: 'free_float_negative'; detalhe: string }

export interface CpmResult {
  /** Mapa por id da tarefa → resultado. */
  porTarefa: Map<string, CpmTaskResult>
  /** Ids no caminho crítico (TF ≤ 0). */
  caminhoCritico: string[]
  /** Warnings agregados (constraint violado, drift, frozen). */
  warnings: CpmWarning[]
  /** Data de fim do projeto (max EF). */
  dataFimProjeto: Date
  /** Ms da computação (instrumento de telemetry). */
  duracao_ms: number
}

export class CpmCycleError extends Error {
  constructor(public readonly nodes: string[]) {
    super(`Ciclo detectado em ${nodes.length} nó(s) — recálculo abortado.`)
  }
}

// ─── Implementação ────────────────────────────────────────────────────────

/**
 * Calcula CPM puro sobre o snapshot atual. Não persiste. Não invoca rede.
 *
 * Erros lançados:
 *   * `CpmCycleError` se o grafo tem ciclo (lista de ids).
 */
export function computeCpm(input: CpmInput): CpmResult {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now())

  const { tarefas, calendario: ctx, projectStart, dataDate } = input
  const ancora = nextWorkDay(projectStart, ctx)
  const warnings: CpmWarning[] = []
  const porTarefa = new Map<string, CpmTaskResult>()

  // ─── 1) Classificar ────────────────────────────────────────────────────
  // Grupos: ficam fora do CPM (rollup é responsabilidade do client tree).
  // Marcos: entram (duração 0).
  // Inválidas (folha sem CPU/qtd/equipe): ficam fora com resultado nulo.
  // Frozen (data_fim < dataDate): mantêm datas atuais, skip do recálculo.
  const tarefasCpm: PlanejamentoTarefaCompleta[] = []
  const frozenIds = new Set<string>()
  const datasInicio = new Map<string, Date>()
  const datasFim = new Map<string, Date>()
  const duracoes = new Map<string, number>()

  for (const t of tarefas) {
    if (t.tipo_no === 'grupo') {
      // Resultado nulo — UI faz rollup.
      porTarefa.set(t.id, nullResult(false))
      continue
    }
    // Tarefas indiretas saem do CPM cliente — duração/datas vêm do edge
    // (pós-backward pass, dimensiona pra cobrir cronograma). Sem skip aqui,
    // o optimistic update zeraria as datas no cache porque indireta não
    // tem cpu_snapshot/producao/equipes válidos pro CPM normal.
    if (t.is_indireto) continue
    if (t.tipo_no === 'tarefa') {
      const eqs = (t.equipes ?? []).reduce(
        (a, e) => a + Math.max(1, Number(e.qtd_equipes ?? 1)),
        0
      )
      const valido =
        !!t.cpu_snapshot_id &&
        Number(t.producao_diaria_qtde ?? 0) > 0 &&
        Number(t.quantidade_alocada ?? 0) > 0 &&
        eqs > 0
      if (!valido) {
        porTarefa.set(t.id, nullResult(false))
        continue
      }
    }
    // Frozen detection (antes do forward pass)
    if (dataDate && t.data_inicio && t.data_fim) {
      const dFim = parseISO(t.data_fim)
      if (dFim < dataDate) {
        frozenIds.add(t.id)
        const dIni = parseISO(t.data_inicio)
        datasInicio.set(t.id, dIni)
        datasFim.set(t.id, dFim)
        duracoes.set(
          t.id,
          t.tipo_no === 'marco' ? 0 : Math.max(1, diffWorkDays(dIni, dFim, ctx) + 1)
        )
        warnings.push({
          tarefa_id: t.id,
          tipo: 'frozen_data_date',
          detalhe: `data_fim ${t.data_fim} < dataDate ${isoDate(dataDate)}`
        })
      }
    }
    tarefasCpm.push(t)
  }

  // ─── 2) Construir grafo de adjacências ─────────────────────────────────
  const cpmSet = new Set(tarefasCpm.map((t) => t.id))
  const tarefaById = new Map<string, PlanejamentoTarefaCompleta>(
    tarefasCpm.map((t) => [t.id, t])
  )
  const adj = new Map<string, string[]>() // pred → [sucs]
  const indegree = new Map<string, number>()
  for (const t of tarefasCpm) {
    indegree.set(t.id, 0)
    adj.set(t.id, [])
  }
  for (const t of tarefasCpm) {
    for (const p of t.predecessoras ?? []) {
      if (!cpmSet.has(p.predecessora_id)) continue
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1)
      const arr = adj.get(p.predecessora_id) ?? []
      arr.push(t.id)
      adj.set(p.predecessora_id, arr)
    }
  }

  // ─── 3) Ordem topológica (Kahn) ────────────────────────────────────────
  const fila: string[] = []
  for (const [id, deg] of indegree) if (deg === 0) fila.push(id)
  const ordem: string[] = []
  while (fila.length > 0) {
    const id = fila.shift()!
    ordem.push(id)
    for (const succ of adj.get(id) ?? []) {
      indegree.set(succ, (indegree.get(succ) ?? 1) - 1)
      if ((indegree.get(succ) ?? 0) === 0) fila.push(succ)
    }
  }
  if (ordem.length !== tarefasCpm.length) {
    const ciclo = tarefasCpm
      .filter((t) => (indegree.get(t.id) ?? 0) > 0)
      .map((t) => t.id)
    throw new CpmCycleError(ciclo)
  }

  // ─── 4) Forward pass (ES/EF) ───────────────────────────────────────────
  for (const id of ordem) {
    if (frozenIds.has(id)) continue
    const t = tarefaById.get(id)!
    const cType = t.constraint_type as ConstraintType | null
    const cDate = t.constraint_date ? parseISO(t.constraint_date) : null

    // Determinar dataInicioCalc
    let esCalc: Date
    if (cType === 'mso' && cDate) {
      esCalc = cDate
      let predMax: Date | null = null
      for (const p of t.predecessoras ?? []) {
        const cand = candidatoForward(p, datasInicio, datasFim, ctx)
        if (cand && (!predMax || cand > predMax)) predMax = cand
      }
      if (predMax && predMax > esCalc) {
        warnings.push({
          tarefa_id: id,
          tipo: 'constraint_violated',
          detalhe: `MSO em ${t.constraint_date} mas predecessoras forçam início em ${isoDate(predMax)}`
        })
      }
    } else if (t.data_inicio_manual && t.data_inicio) {
      // Legado: MSO informal.
      esCalc = parseISO(t.data_inicio)
    } else {
      let candidato: Date | null = null
      for (const p of t.predecessoras ?? []) {
        const cand = candidatoForward(p, datasInicio, datasFim, ctx)
        if (cand && (!candidato || cand > candidato)) candidato = cand
      }
      esCalc = candidato ?? new Date(ancora)
      if (esCalc < ancora) {
        esCalc = new Date(ancora)
        warnings.push({ tarefa_id: id, tipo: 'drift_anterior_ancora' })
      }
      if (cType === 'snet' && cDate && esCalc < cDate) esCalc = cDate
      if (dataDate && esCalc < dataDate) esCalc = dataDate
      esCalc = nextWorkDay(esCalc, ctx)
    }

    // Marcos: dur=0, EF=ES
    if (t.tipo_no === 'marco') {
      datasInicio.set(id, esCalc)
      datasFim.set(id, esCalc)
      duracoes.set(id, 0)
      continue
    }

    // Duração dia-a-dia com fator mensal aplicado por dia útil — bate com
    // a edge (calcularDuracaoDiaria é a função canônica). Safety interno
    // de SAFETY_MAX_WORK_DAYS dentro da função evita loop infinito.
    const qtd = Number(t.quantidade_alocada ?? 0)
    const prod = Number(t.producao_diaria_qtde ?? 0)
    const eqs = (t.equipes ?? []).reduce(
      (a, e) => a + Math.max(1, Number(e.qtd_equipes ?? 1)),
      0
    )
    let dur = calcularDuracaoDiaria(qtd, prod, eqs, esCalc, ctx)
    let esFinal = parseISO(dur.dataInicio)
    let efFinal = parseISO(dur.dataFim)
    let duracao = dur.duracaoDiasUteis

    // FNET (Finish No Earlier Than): atrasa início pra terminar não-antes-de.
    if (cType === 'fnet' && cDate && efFinal < cDate) {
      const novoInicio = duracao > 1 ? shiftWorkDays(cDate, -(duracao - 1), ctx) : cDate
      dur = calcularDuracaoDiaria(qtd, prod, eqs, novoInicio, ctx)
      esFinal = parseISO(dur.dataInicio)
      efFinal = parseISO(dur.dataFim)
      duracao = dur.duracaoDiasUteis
    }

    // FF/SF backward adjustment do forward pass (FF: pred.EF + lag → succ.EF;
    // SF: pred.ES + lag → succ.EF). Recompute pra novo início se necessário.
    for (const p of t.predecessoras ?? []) {
      if (p.tipo !== 'FF' && p.tipo !== 'SF') continue
      const ref =
        p.tipo === 'FF'
          ? datasFim.get(p.predecessora_id)
          : datasInicio.get(p.predecessora_id)
      if (!ref) continue
      const fimAlvo = shiftWorkDays(ref, p.lag_dias, ctx)
      if (fimAlvo > efFinal) {
        const novoInicio = duracao > 1 ? shiftWorkDays(fimAlvo, -(duracao - 1), ctx) : fimAlvo
        dur = calcularDuracaoDiaria(qtd, prod, eqs, novoInicio, ctx)
        esFinal = parseISO(dur.dataInicio)
        efFinal = parseISO(dur.dataFim)
        duracao = dur.duracaoDiasUteis
      }
    }

    // Warning explícito quando dataFim viola FNLT/MFO (soft).
    if ((cType === 'fnlt' || cType === 'mfo') && cDate && efFinal > cDate) {
      const delta = diffWorkDays(cDate, efFinal, ctx)
      warnings.push({
        tarefa_id: id,
        tipo: 'constraint_finish_violated',
        detalhe: `${cType.toUpperCase()} em ${t.constraint_date} mas predecessoras forçam fim em ${isoDate(efFinal)} (excesso ${delta}d úteis)`
      })
    }

    datasInicio.set(id, esFinal)
    datasFim.set(id, efFinal)
    duracoes.set(id, duracao)
  }

  // ─── 5) Backward pass (LS/LF) ──────────────────────────────────────────
  const dataFimProjeto = Array.from(datasFim.values()).reduce(
    (max, d) => (d > max ? d : max),
    new Date(ancora)
  )
  const lateFinish = new Map<string, Date>()
  const lateStart = new Map<string, Date>()
  for (const id of [...ordem].reverse()) {
    const t = tarefaById.get(id)!
    const cType = t.constraint_type as ConstraintType | null
    const cDate = t.constraint_date ? parseISO(t.constraint_date) : null
    const sucessores = adj.get(id) ?? []
    if (sucessores.length === 0) {
      lateFinish.set(id, dataFimProjeto)
    } else {
      let lf = dataFimProjeto
      for (const sId of sucessores) {
        const sucPreds = (tarefaById.get(sId)?.predecessoras ?? []).filter(
          (p) => p.predecessora_id === id
        )
        for (const p of sucPreds) {
          const sucLF = lateFinish.get(sId) ?? dataFimProjeto
          const sucDur = duracoes.get(sId) ?? 0
          // sucLS = sucLF - (sucDur - 1) workdays. Marcos (dur=0) e tarefas de
          // 1 dia (dur=1): LS = LF. Math.max(0, ...) evita off-by-one que
          // forçava shift mínimo de 1 dia mesmo quando não devia.
          const sucLS = shiftWorkDays(sucLF, -Math.max(0, Math.ceil(sucDur) - 1), ctx)
          let cand: Date
          if (p.tipo === 'FS') cand = shiftWorkDays(sucLS, -p.lag_dias - 1, ctx)
          else if (p.tipo === 'SS') {
            const predDur = duracoes.get(id) ?? 0
            const predLS = shiftWorkDays(sucLS, -p.lag_dias, ctx)
            cand = addWorkDays(predLS, Math.max(1, Math.ceil(predDur)), ctx)
          } else if (p.tipo === 'FF') cand = shiftWorkDays(sucLF, -p.lag_dias, ctx)
          else {
            const predDur = duracoes.get(id) ?? 0
            const predLS = shiftWorkDays(sucLF, -p.lag_dias, ctx)
            cand = addWorkDays(predLS, Math.max(1, Math.ceil(predDur)), ctx)
          }
          if (cand < lf) lf = cand
        }
      }
      lateFinish.set(id, lf)
    }

    // FNLT / MFO
    if (cType === 'fnlt' && cDate) {
      const lfAtual = lateFinish.get(id)!
      if (lfAtual > cDate) lateFinish.set(id, cDate)
    } else if (cType === 'mfo' && cDate) {
      const lfAtual = lateFinish.get(id)!
      if (lfAtual < cDate) {
        warnings.push({
          tarefa_id: id,
          tipo: 'constraint_violated',
          detalhe: `MFO em ${t.constraint_date} mas sucessoras forçam fim em ${isoDate(lfAtual)}`
        })
      }
      lateFinish.set(id, cDate)
    }

    const durBack = duracoes.get(id) ?? 0
    let lfFinal = lateFinish.get(id)!
    let ls = durBack > 1 ? shiftWorkDays(lfFinal, -(Math.ceil(durBack) - 1), ctx) : lfFinal

    // SNLT (Start No Later Than): puxa LS pra trás se LS_calc > SNLT.
    if (cType === 'snlt' && cDate && ls > cDate) {
      ls = cDate
      lfFinal = durBack > 1 ? addWorkDays(ls, Math.ceil(durBack) - 1, ctx) : ls
      lateFinish.set(id, lfFinal)
    }
    lateStart.set(id, ls)
  }

  // ─── 6) Total Float, Free Float, caminho crítico ───────────────────────
  const totalFloat = new Map<string, number>()
  const freeFloat = new Map<string, number>()
  const caminhoCritico: string[] = []
  for (const id of ordem) {
    const ef = datasFim.get(id)!
    const lf = lateFinish.get(id)!
    const tf = diffWorkDays(ef, lf, ctx)
    totalFloat.set(id, tf)
    if (tf <= 0) caminhoCritico.push(id)

    const sucs = adj.get(id) ?? []
    if (sucs.length === 0) {
      freeFloat.set(id, tf)
      continue
    }
    let minSlack = Number.POSITIVE_INFINITY
    const es = datasInicio.get(id)!
    for (const sId of sucs) {
      const sucPreds = (tarefaById.get(sId)?.predecessoras ?? []).filter(
        (p) => p.predecessora_id === id
      )
      for (const p of sucPreds) {
        const sucES = datasInicio.get(sId)!
        const sucEF = datasFim.get(sId)!
        let slackDias: number
        if (p.tipo === 'FS') {
          const alvo = shiftWorkDays(sucES, -1 - p.lag_dias, ctx)
          slackDias = diffWorkDays(ef, alvo, ctx)
        } else if (p.tipo === 'SS') {
          const alvo = shiftWorkDays(sucES, -p.lag_dias, ctx)
          slackDias = diffWorkDays(es, alvo, ctx)
        } else if (p.tipo === 'FF') {
          const alvo = shiftWorkDays(sucEF, -p.lag_dias, ctx)
          slackDias = diffWorkDays(ef, alvo, ctx)
        } else {
          const alvo = shiftWorkDays(sucEF, -p.lag_dias, ctx)
          slackDias = diffWorkDays(es, alvo, ctx)
        }
        if (slackDias < minSlack) minSlack = slackDias
      }
    }
    const ffRaw = Number.isFinite(minSlack) ? minSlack : 0
    if (ffRaw < 0) {
      warnings.push({
        tarefa_id: id,
        tipo: 'free_float_negative',
        detalhe: `slack ${ffRaw}d úteis (constraint ou predecessor forçando atraso)`
      })
    }
    freeFloat.set(id, Math.max(0, ffRaw))
  }

  // ─── 7) ALAP shift: tarefas com schedule_mode='alap' e TF > 0 ─────────
  const dataInicioFinal = new Map<string, Date>()
  const dataFimFinal = new Map<string, Date>()
  for (const id of ordem) {
    if (frozenIds.has(id)) {
      dataInicioFinal.set(id, datasInicio.get(id)!)
      dataFimFinal.set(id, datasFim.get(id)!)
      continue
    }
    const t = tarefaById.get(id)!
    const mode = (t.schedule_mode as ScheduleMode | undefined) ?? 'asap'
    const tf = totalFloat.get(id) ?? 0
    if (mode === 'alap' && tf > 0) {
      dataInicioFinal.set(id, lateStart.get(id)!)
      dataFimFinal.set(id, lateFinish.get(id)!)
    } else {
      dataInicioFinal.set(id, datasInicio.get(id)!)
      dataFimFinal.set(id, datasFim.get(id)!)
    }
  }

  // ─── 8) Montar resultados ──────────────────────────────────────────────
  for (const id of ordem) {
    porTarefa.set(id, {
      early_start: isoDate(datasInicio.get(id)!),
      early_finish: isoDate(datasFim.get(id)!),
      late_start: isoDate(lateStart.get(id)!),
      late_finish: isoDate(lateFinish.get(id)!),
      total_float: totalFloat.get(id) ?? null,
      free_float: freeFloat.get(id) ?? null,
      is_critico: (totalFloat.get(id) ?? 0) <= 0,
      data_inicio: isoDate(dataInicioFinal.get(id)!),
      data_fim: isoDate(dataFimFinal.get(id)!),
      duracao_dias_uteis: duracoes.get(id) ?? 0,
      frozen: frozenIds.has(id)
    })
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    porTarefa,
    caminhoCritico,
    warnings,
    dataFimProjeto,
    duracao_ms: Math.round(t1 - t0)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function nullResult(frozen: boolean): CpmTaskResult {
  return {
    early_start: null,
    early_finish: null,
    late_start: null,
    late_finish: null,
    total_float: null,
    free_float: null,
    is_critico: false,
    data_inicio: null,
    data_fim: null,
    duracao_dias_uteis: 0,
    frozen
  }
}

/**
 * Calcula o candidato a `ES` da sucessora dado o tipo de dependência. Retorna
 * NULL se a predecessora ainda não foi processada (forward pass tem ordem
 * topológica, então isso é raro mas defendido).
 */
function candidatoForward(
  p: PredecessoraRef,
  datasInicio: Map<string, Date>,
  datasFim: Map<string, Date>,
  ctx: CalendarioCtx
): Date | null {
  const predIni = datasInicio.get(p.predecessora_id)
  const predFim = datasFim.get(p.predecessora_id)
  if (!predIni || !predFim) return null
  const tipo = p.tipo as DependenciaTipo
  if (tipo === 'FS') return shiftWorkDays(predFim, p.lag_dias + 1, ctx)
  if (tipo === 'SS') return shiftWorkDays(predIni, p.lag_dias, ctx)
  if (tipo === 'FF') return shiftWorkDays(predFim, p.lag_dias, ctx)
  return null // SF: não fixa início — restrição é sobre fim, tratada em (d).
}
