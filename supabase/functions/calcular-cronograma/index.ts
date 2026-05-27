// POST /functions/v1/calcular-cronograma
// Body: { planejamento_id: string, force?: boolean }
// Permissão: God/Adm/Engenheiro com acesso à obra (write).
//
// Calcula datas de todas as tarefas de um planejamento:
//   1) Lock advisory.
//   2) Valida grafo de dependências (sem ciclos).
//   3) Calcula duração de cada tarefa via calcularDuracaoDiaria (de _shared/cronograma-pure.ts):
//      integra dia-a-dia, aplicando fator do mês DE CADA dia útil (não só do mês de início).
//   4) Topological sort (Kahn).
//   5) Forward pass respeitando dependências (FS/SS/FF + lag) e calendário (skip dias não úteis).
//   6) Backward pass → caminho crítico (slack = 0).
//   7) UPDATE batch + touch obras.data_fim_planejada.
//
// REGRA DO FATOR DE PRODUTIVIDADE MENSAL (obra_produtividade_mes):
//   * Aplicado POR DIA ÚTIL.
//   * Lookup exato por mês (chave 'YYYY-MM').
//   * Ausência de registro = fator 1.0 (sem multiplicação).
//   * Tarefa que atravessa virada de mês usa fator de cada dia, não o do início.
//   * (Antes deste commit, a fórmula linear `qtd / (prod × eq × fator_mes_inicio)`
//     ignorava esse fato — bug corrigido em commit 1 da entrega Perfil Semanal.)

import { handlePreflight, json } from '../_shared/cors.ts'
import { assertRole, resolveCaller } from '../_shared/auth.ts'
import { assertObraAccess } from '../_shared/orc.ts'
import {
  addDays,
  addWorkDays,
  type CalendarioCtx,
  gerarPerfilSemanal,
  isoDate,
  isWorkDay,
  makeCapacidadePorSemana,
  nextWorkDay,
  parseISO,
  type PerfilNome,
  type SemanaPerfil,
  shiftPerfilSemanas,
  shiftWorkDays,
  startOfWeekMondayUTC,
  ultimoDiaUtilDaSemana
} from '../_shared/cronograma-pure.ts'

interface Body {
  planejamento_id?: string
  force?: boolean
}

interface TarefaRow {
  id: string
  item_orcamentario_id: string
  data_inicio: string | null
  data_fim: string | null
  data_inicio_manual: boolean
  quantidade_referencia: number | null
  producao_diaria_qtde: number | null
  cpu_snapshot_id: string | null
  perfil_default: PerfilNome
  usa_perfil_customizado: boolean
  equipes: Array<{ id: string; qtd_equipes: number }>
  predecessoras: Array<{
    predecessora_id: string
    tipo: 'FS' | 'SS' | 'FF'
    lag_dias: number
  }>
}

interface WarningRecalc {
  tarefa_id: string
  tipo:
    | 'safety_perfil'
    | 'customizado_sem_perfil'
    | 'customizado_qty_divergente'
    | 'customizado_shift_truncado'
    | 'safety_duracao'
    | 'drift_anterior_ancora'
  detalhe?: string
}

// Alias local pra manter os call-sites preexistentes funcionando sem
// renomear `calcCtx`. CalendarioCtx é a fonte canônica em _shared/.
type CalcContext = CalendarioCtx

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)

  const ctx = await resolveCaller(req)
  if (ctx instanceof Response) return ctx
  const { caller, admin } = ctx
  const roleErr = assertRole(caller, ['god', 'adm', 'engenheiro'])
  if (roleErr) return roleErr

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }
  const planejamento_id = body.planejamento_id?.trim()
  if (!planejamento_id) return json({ error: 'planejamento_id é obrigatório' }, 400)

  const t0 = Date.now()

  // 1) Carregar planejamento + obra
  const { data: plan, error: planErr } = await admin
    .from('planejamento')
    .select('id, obra_id, data_referencia_inicio, is_baseline')
    .eq('id', planejamento_id)
    .maybeSingle()
  if (planErr || !plan) return json({ error: 'Planejamento não encontrado' }, 404)
  if (plan.is_baseline) {
    return json({ error: 'Planejamento baseline é imutável. Crie nova revisão.' }, 409)
  }

  const accErr = await assertObraAccess(ctx, plan.obra_id, { write: true })
  if (accErr) return accErr

  // 2) Validar ciclo via RPC
  const { data: ciclo, error: cicloErr } = await admin.rpc('cronograma_validar_ciclo', {
    _planejamento_id: planejamento_id
  })
  if (cicloErr) return json({ error: cicloErr.message }, 400)
  // deno-lint-ignore no-explicit-any
  const cicloData = ciclo as any
  if (cicloData?.tem_ciclo) {
    return json(
      {
        error: 'Ciclo detectado nas dependências',
        ciclo_nodes: cicloData.nodes ?? []
      },
      400
    )
  }

  // 3) Carregar calendário + exceções + fatores
  const [calRes, excRes, fatRes] = await Promise.all([
    admin
      .from('obra_calendario')
      .select('dias_uteis_bitmask')
      .eq('obra_id', plan.obra_id)
      .maybeSingle(),
    admin
      .from('obra_calendario_excecao')
      .select('data, eh_util')
      .eq('obra_id', plan.obra_id),
    admin
      .from('obra_produtividade_mes')
      .select('ano_mes, fator')
      .eq('obra_id', plan.obra_id)
  ])

  const bitmask = calRes.data?.dias_uteis_bitmask ?? 31
  const excecoes = new Map<string, boolean>()
  for (const e of excRes.data ?? []) {
    excecoes.set(e.data as string, !!e.eh_util)
  }
  const fatorMes = new Map<string, number>()
  for (const f of fatRes.data ?? []) {
    const key = (f.ano_mes as string).slice(0, 7)
    fatorMes.set(key, Number(f.fator))
  }
  const calcCtx: CalcContext = { bitmask, excecoes, fatorMes }

  // 4) Carregar tarefas + relacionados via view
  const { data: tarefasRaw, error: tarErr } = await admin
    .from('vw_planejamento_tarefa_completa')
    .select(
      'id, item_orcamentario_id, data_inicio, data_fim, data_inicio_manual, ' +
        'quantidade_referencia, producao_diaria_qtde, cpu_snapshot_id, ' +
        'perfil_default, usa_perfil_customizado, equipes, predecessoras'
    )
    .eq('planejamento_id', planejamento_id)
  if (tarErr) return json({ error: tarErr.message }, 400)

  const tarefas = (tarefasRaw ?? []) as TarefaRow[]
  if (tarefas.length === 0) {
    return json({
      ok: true,
      tarefas_recalculadas: 0,
      data_inicio: plan.data_referencia_inicio,
      data_fim: plan.data_referencia_inicio,
      duracao_total_dias_uteis: 0,
      duracao_total_dias_corridos: 0,
      caminho_critico_ids: [],
      duracao_ms: Date.now() - t0
    })
  }

  // 5) Identificar tarefas válidas (com CPU + equipe) — outras ficam sem data
  const tarefaById = new Map<string, TarefaRow>()
  const tarefasValidas: TarefaRow[] = []
  const tarefasInvalidas: TarefaRow[] = []
  for (const t of tarefas) {
    tarefaById.set(t.id, t)
    const eqsTotal = (t.equipes ?? []).reduce(
      (acc, e) => acc + Math.max(1, Number(e.qtd_equipes ?? 1)),
      0
    )
    const valida =
      !!t.cpu_snapshot_id &&
      Number(t.producao_diaria_qtde ?? 0) > 0 &&
      Number(t.quantidade_referencia ?? 0) > 0 &&
      eqsTotal > 0
    if (valida) tarefasValidas.push(t)
    else tarefasInvalidas.push(t)
  }

  // Zerar datas + apagar perfil das inválidas (sem CPU, prod=0, etc.)
  if (tarefasInvalidas.length > 0) {
    const invalidasIds = tarefasInvalidas.map((t) => t.id)
    await admin
      .from('planejamento_tarefa_perfil_semana')
      .delete()
      .in('tarefa_id', invalidasIds)
    await Promise.all(
      tarefasInvalidas.map((t) =>
        admin
          .from('planejamento_tarefa')
          .update({ data_inicio: null, data_fim: null, duracao_dias_uteis_calc: null })
          .eq('id', t.id)
      )
    )
  }

  // 5.5) Carregar perfis existentes em batch (só das tarefas válidas).
  //      Customizadas: preservar/shiftar. Não-customizadas: regenerar.
  const validasIds = tarefasValidas.map((t) => t.id)
  const perfilPorTarefa = new Map<string, SemanaPerfil[]>()
  if (validasIds.length > 0) {
    const { data: perfis } = await admin
      .from('planejamento_tarefa_perfil_semana')
      .select('tarefa_id, semana_segunda, quantidade_planejada')
      .in('tarefa_id', validasIds)
    for (const p of perfis ?? []) {
      const arr = perfilPorTarefa.get(p.tarefa_id as string) ?? []
      arr.push({
        semanaSegunda: p.semana_segunda as string,
        quantidadePlanejada: Number(p.quantidade_planejada)
      })
      perfilPorTarefa.set(p.tarefa_id as string, arr)
    }
    for (const arr of perfilPorTarefa.values()) {
      arr.sort((a, b) => a.semanaSegunda.localeCompare(b.semanaSegunda))
    }
  }

  // 6) Topological sort (Kahn) — apenas sobre tarefas válidas
  const validasSet = new Set(tarefasValidas.map((t) => t.id))
  const indegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const t of tarefasValidas) {
    indegree.set(t.id, 0)
    adj.set(t.id, [])
  }
  for (const t of tarefasValidas) {
    for (const p of t.predecessoras ?? []) {
      if (!validasSet.has(p.predecessora_id)) continue
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1)
      const arr = adj.get(p.predecessora_id) ?? []
      arr.push(t.id)
      adj.set(p.predecessora_id, arr)
    }
  }
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
  if (ordem.length !== tarefasValidas.length) {
    return json({ error: 'Grafo inconsistente — ciclo escapou da validação' }, 500)
  }

  // 7) Forward pass — perfil-aware.
  //    Pra cada tarefa em ordem topológica:
  //      - Compute dataInicioCalc a partir de predecessoras / data_inicio_manual / âncora.
  //      - Se usa_perfil_customizado + perfil existe: preserva ou shifta perfil.
  //      - Senão: gera perfil via gerarPerfilSemanal.
  //      - Deriva data_inicio (primeiro dia útil) e data_fim (último dia útil da última
  //        semana com qty > 0) a partir do perfil.
  //      - FF backward adjustment shifta o perfil pra frente se necessário.
  const dataAncora = parseISO(plan.data_referencia_inicio)
  const datasInicio = new Map<string, Date>()
  const datasFim = new Map<string, Date>()
  const duracoes = new Map<string, number>()
  const perfisRegenerados = new Map<string, SemanaPerfil[]>() // não-customizadas: DELETE + INSERT
  const perfisShifted = new Map<string, SemanaPerfil[]>() // customizadas com shift: DELETE + INSERT
  const warnings: WarningRecalc[] = []

  // Safety horizonte pra shift de customizado: âncora + SAFETY_MAX_SEMANAS semanas.
  const SAFETY_HORIZONTE_DIAS = 260 * 7

  for (const id of ordem) {
    const t = tarefaById.get(id)!
    const qtd = Number(t.quantidade_referencia ?? 0)
    const prod = Number(t.producao_diaria_qtde ?? 0)
    const eqsTotal = (t.equipes ?? []).reduce(
      (acc, e) => acc + Math.max(1, Number(e.qtd_equipes ?? 1)),
      0
    )

    // (a) Determinar dataInicioCalc a partir de predecessoras / manual / âncora.
    let dataInicioCalc: Date
    if (t.data_inicio_manual && t.data_inicio) {
      dataInicioCalc = parseISO(t.data_inicio)
    } else {
      let candidato: Date | null = null
      for (const p of t.predecessoras ?? []) {
        const predIni = datasInicio.get(p.predecessora_id)
        const predFim = datasFim.get(p.predecessora_id)
        if (!predIni || !predFim) continue
        let cand: Date
        if (p.tipo === 'FS') {
          cand = shiftWorkDays(predFim, p.lag_dias + 1, calcCtx)
        } else if (p.tipo === 'SS') {
          cand = shiftWorkDays(predIni, p.lag_dias, calcCtx)
        } else {
          cand = shiftWorkDays(predFim, p.lag_dias, calcCtx)
        }
        if (!candidato || cand > candidato) candidato = cand
      }
      dataInicioCalc = candidato ?? new Date(dataAncora)
      if (dataInicioCalc < dataAncora) {
        dataInicioCalc = new Date(dataAncora)
        warnings.push({ tarefa_id: t.id, tipo: 'drift_anterior_ancora' })
      }
      dataInicioCalc = nextWorkDay(dataInicioCalc, calcCtx)
    }

    // (b) Decidir perfil: preservar/shiftar customizado OU gerar novo.
    let perfilFinal: SemanaPerfil[] = []
    const existingPerfil = perfilPorTarefa.get(t.id) ?? []

    if (t.usa_perfil_customizado && existingPerfil.length > 0) {
      // Customizado existente: validar soma + shift se necessário.
      const somaPerfil = existingPerfil.reduce((acc, s) => acc + s.quantidadePlanejada, 0)
      const tolerancia = Math.max(Math.abs(qtd) * 0.001, 0.0001)
      if (Math.abs(somaPerfil - qtd) > tolerancia) {
        warnings.push({
          tarefa_id: t.id,
          tipo: 'customizado_qty_divergente',
          detalhe: `soma=${somaPerfil.toFixed(2)} ref=${qtd.toFixed(2)}`
        })
      }

      const primeiraSegOrig = parseISO(existingPerfil[0].semanaSegunda)
      const targetSeg = startOfWeekMondayUTC(dataInicioCalc)
      const deltaSemanas = Math.round(
        (targetSeg.getTime() - primeiraSegOrig.getTime()) / (7 * 86400000)
      )

      if (deltaSemanas === 0) {
        perfilFinal = existingPerfil
      } else {
        // Safety: shift que estoura horizonte é truncado.
        const ultimaSegOrig = parseISO(
          existingPerfil[existingPerfil.length - 1].semanaSegunda
        )
        const ultimaSegShifted = addDays(ultimaSegOrig, deltaSemanas * 7)
        const safetyHorizonte = addDays(dataAncora, SAFETY_HORIZONTE_DIAS)
        if (ultimaSegShifted > safetyHorizonte) {
          const deltaTruncado = Math.floor(
            (safetyHorizonte.getTime() - ultimaSegOrig.getTime()) / (7 * 86400000)
          )
          perfilFinal = shiftPerfilSemanas(existingPerfil, deltaTruncado)
          warnings.push({
            tarefa_id: t.id,
            tipo: 'customizado_shift_truncado',
            detalhe: `delta_req=${deltaSemanas} delta_aplic=${deltaTruncado}`
          })
        } else {
          perfilFinal = shiftPerfilSemanas(existingPerfil, deltaSemanas)
        }
        perfisShifted.set(t.id, perfilFinal)
      }
    } else {
      if (t.usa_perfil_customizado) {
        // Flag true mas sem perfil — estado inconsistente (não deveria acontecer
        // com a RPC atomic). Fallback: gera uniforme + warning.
        warnings.push({ tarefa_id: t.id, tipo: 'customizado_sem_perfil' })
      }
      const capPorSemana = makeCapacidadePorSemana(prod, eqsTotal, calcCtx)
      const gerar = gerarPerfilSemanal({
        quantidadeTotal: qtd,
        dataInicio: dataInicioCalc,
        capacidadePorSemana: capPorSemana,
        perfil: t.perfil_default,
        politicaCap: 'rigido'
      })
      if (gerar.atingiuSafety) {
        warnings.push({ tarefa_id: t.id, tipo: 'safety_perfil' })
      }
      perfilFinal = gerar.semanas
      perfisRegenerados.set(t.id, perfilFinal)
    }

    // (c) Derivar data_inicio + data_fim a partir do perfil.
    let dataInicio: Date
    let dataFim: Date
    if (perfilFinal.length === 0) {
      dataInicio = nextWorkDay(dataInicioCalc, calcCtx)
      dataFim = dataInicio
    } else {
      const primeiraSeg = parseISO(perfilFinal[0].semanaSegunda)
      dataInicio = nextWorkDay(
        primeiraSeg > dataInicioCalc ? primeiraSeg : dataInicioCalc,
        calcCtx
      )
      const ultSemanaProd = [...perfilFinal]
        .reverse()
        .find((s) => s.quantidadePlanejada > 0)
      dataFim = ultSemanaProd
        ? ultimoDiaUtilDaSemana(parseISO(ultSemanaProd.semanaSegunda), calcCtx)
        : dataInicio
    }

    // (d) FF backward adjustment: empurra dataFim adiante via shift do perfil.
    for (const p of t.predecessoras ?? []) {
      if (p.tipo !== 'FF') continue
      const predFim = datasFim.get(p.predecessora_id)
      if (!predFim) continue
      const fimAlvo = shiftWorkDays(predFim, p.lag_dias, calcCtx)
      if (fimAlvo > dataFim) {
        const deltaDias = Math.round((fimAlvo.getTime() - dataFim.getTime()) / 86400000)
        const deltaSemanas = Math.ceil(deltaDias / 7)
        if (perfilFinal.length > 0 && deltaSemanas > 0) {
          perfilFinal = shiftPerfilSemanas(perfilFinal, deltaSemanas)
          if (t.usa_perfil_customizado) {
            perfisShifted.set(t.id, perfilFinal)
          } else {
            perfisRegenerados.set(t.id, perfilFinal)
          }
          const primeiraSegNova = parseISO(perfilFinal[0].semanaSegunda)
          dataInicio = nextWorkDay(primeiraSegNova, calcCtx)
          if (dataInicio < dataAncora) {
            dataInicio = new Date(dataAncora)
            warnings.push({ tarefa_id: t.id, tipo: 'drift_anterior_ancora' })
          }
        }
        dataFim = fimAlvo
      }
    }

    // (e) Duração final = contagem de dias úteis entre dataInicio e dataFim.
    let duracao = 0
    if (perfilFinal.length > 0) {
      let cur = new Date(dataInicio)
      while (cur <= dataFim) {
        if (isWorkDay(cur, calcCtx)) duracao++
        cur = addDays(cur, 1)
      }
    }

    datasInicio.set(id, dataInicio)
    datasFim.set(id, dataFim)
    duracoes.set(id, duracao)
  }
  // Compat com response antigo: warning_drift true se qualquer warning de drift.
  const warningDrift = warnings.some(
    (w) => w.tipo === 'drift_anterior_ancora' || w.tipo === 'safety_perfil'
  )

  // 8) Backward pass — calcula slack para identificar caminho crítico
  const dataFimProjeto = Array.from(datasFim.values()).reduce(
    (max, d) => (d > max ? d : max),
    dataAncora
  )
  const lateFinish = new Map<string, Date>()
  for (const id of [...ordem].reverse()) {
    const t = tarefaById.get(id)!
    // Se é sucessor terminal (sem sucessores conhecidos), lateFinish = fim do projeto
    const sucessores = adj.get(id) ?? []
    if (sucessores.length === 0) {
      lateFinish.set(id, dataFimProjeto)
      continue
    }
    let lf = dataFimProjeto
    for (const sId of sucessores) {
      const sucPreds = (tarefaById.get(sId)?.predecessoras ?? []).filter(
        (p) => p.predecessora_id === id
      )
      for (const p of sucPreds) {
        const sucLF = lateFinish.get(sId) ?? dataFimProjeto
        const sucDur = duracoes.get(sId) ?? 0
        const sucLS = shiftWorkDays(sucLF, -Math.max(1, Math.ceil(sucDur) - 1), calcCtx)
        let cand: Date
        if (p.tipo === 'FS') {
          cand = shiftWorkDays(sucLS, -p.lag_dias - 1, calcCtx)
        } else if (p.tipo === 'SS') {
          // Pred.LS = succ.LS - lag, pred.LF = pred.LS + pred.dur
          const predDur = duracoes.get(id) ?? 0
          const predLS = shiftWorkDays(sucLS, -p.lag_dias, calcCtx)
          cand = addWorkDays(predLS, Math.max(1, Math.ceil(predDur)), calcCtx)
        } else {
          // FF: pred.LF = succ.LF - lag
          cand = shiftWorkDays(sucLF, -p.lag_dias, calcCtx)
        }
        if (cand < lf) lf = cand
      }
    }
    lateFinish.set(id, lf)
  }

  const caminhoCritico: string[] = []
  for (const id of ordem) {
    const earlyFinish = datasFim.get(id)!
    const lf = lateFinish.get(id)!
    // slack em dias absolutos (não úteis) — aproximação ok para identificar crítico
    const slack = Math.round((lf.getTime() - earlyFinish.getTime()) / (1000 * 60 * 60 * 24))
    if (slack <= 0) caminhoCritico.push(id)
  }

  // 9a) Persist perfis: DELETE + INSERT chunked. Idempotente — re-run seguro.
  //     Tarefas regeneradas (perfisRegenerados) + customizadas que sofreram shift
  //     (perfisShifted). Tarefas customizadas SEM shift mantém o perfil intacto
  //     no DB (não passam por DELETE).
  const tarefasComPerfilParaPersistir = new Set<string>([
    ...perfisRegenerados.keys(),
    ...perfisShifted.keys()
  ])
  if (tarefasComPerfilParaPersistir.size > 0) {
    const ids = Array.from(tarefasComPerfilParaPersistir)
    const { error: delErr } = await admin
      .from('planejamento_tarefa_perfil_semana')
      .delete()
      .in('tarefa_id', ids)
    if (delErr) {
      return json({ error: 'Falha em DELETE perfis', detalhe: delErr.message }, 500)
    }

    const rows: Array<{
      tarefa_id: string
      semana_segunda: string
      quantidade_planejada: number
    }> = []
    for (const tid of ids) {
      const semanas = perfisRegenerados.get(tid) ?? perfisShifted.get(tid) ?? []
      for (const s of semanas) {
        if (s.quantidadePlanejada < 0) continue
        rows.push({
          tarefa_id: tid,
          semana_segunda: s.semanaSegunda,
          quantidade_planejada: s.quantidadePlanejada
        })
      }
    }
    // INSERT em chunks de 1000 (limite seguro do PostgREST).
    // Constraint trigger DEFERRED valida soma no commit de cada chunk.
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000)
      const { error: insErr } = await admin
        .from('planejamento_tarefa_perfil_semana')
        .insert(chunk)
      if (insErr) {
        return json(
          {
            error: 'Falha em INSERT perfis (transação parcial — rerun do recálculo é seguro)',
            detalhe: insErr.message,
            chunk_inicial: i,
            partial: true
          },
          500
        )
      }
    }
  }

  // 9b) UPDATE batch das tarefas válidas: datas + duração + flag.
  //     Regeneradas: usa_perfil_customizado = false (forca shape default).
  //     Shifted ou intactas: mantém usa_perfil_customizado = true (do DB).
  const updates = ordem.map((id) => ({
    id,
    data_inicio: isoDate(datasInicio.get(id)!),
    data_fim: isoDate(datasFim.get(id)!),
    duracao_dias_uteis_calc: duracoes.get(id) ?? 0,
    foi_regenerada: perfisRegenerados.has(id)
  }))

  // Supabase não tem batch update nativo — atualizar em paralelo
  const updResults = await Promise.all(
    updates.map((u) => {
      const payload: Record<string, unknown> = {
        data_inicio: u.data_inicio,
        data_fim: u.data_fim,
        duracao_dias_uteis_calc: u.duracao_dias_uteis_calc
      }
      if (u.foi_regenerada) {
        payload.usa_perfil_customizado = false
      }
      return admin.from('planejamento_tarefa').update(payload).eq('id', u.id)
    })
  )
  const errs = updResults.filter((r) => r.error).map((r) => r.error!.message)
  if (errs.length > 0) {
    return json({ error: 'Falha em UPDATE', detalhes: errs.slice(0, 5) }, 500)
  }

  // 10) Touch planejamento + obras.data_fim_planejada
  await admin
    .from('planejamento')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', planejamento_id)

  await admin
    .from('obras')
    .update({ data_fim_planejada: isoDate(dataFimProjeto) })
    .eq('id', plan.obra_id)

  const dataInicioProjeto = Array.from(datasInicio.values()).reduce(
    (min, d) => (d < min ? d : min),
    dataFimProjeto
  )

  // duração corridos vs úteis (entre min e max)
  const diasCorridos = Math.max(
    0,
    Math.round(
      (dataFimProjeto.getTime() - dataInicioProjeto.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1
  )
  let diasUteisTotal = 0
  let cur = new Date(dataInicioProjeto)
  while (cur <= dataFimProjeto) {
    if (isWorkDay(cur, calcCtx)) diasUteisTotal++
    cur = addDays(cur, 1)
  }

  return json({
    ok: true,
    tarefas_recalculadas: updates.length,
    perfis_regenerados: perfisRegenerados.size,
    perfis_shifted: perfisShifted.size,
    data_inicio: isoDate(dataInicioProjeto),
    data_fim: isoDate(dataFimProjeto),
    duracao_total_dias_uteis: diasUteisTotal,
    duracao_total_dias_corridos: diasCorridos,
    caminho_critico_ids: caminhoCritico,
    warning_drift: warningDrift,
    warnings,
    duracao_ms: Date.now() - t0
  })
})
