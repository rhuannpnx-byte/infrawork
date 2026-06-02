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
  agruparPorSemana,
  calcularDuracaoDiaria,
  type CalendarioCtx,
  diffMonths,
  diffWorkDays,
  diffYears,
  fracaoSobreposta,
  isoDate,
  isWorkDay,
  nextWorkDay,
  parseISO,
  type SemanaPerfil,
  shiftWorkDays,
  sobreposicao
} from '../_shared/cronograma-pure.ts'
// computeLinkedQtd removido: cálculo movido pra RPC SQL `recalc_qtd_link_tarefas`

interface Body {
  planejamento_id?: string
  force?: boolean
}

interface IndiretoConfigRaw {
  custo_periodicidade: 'dia' | 'mes' | 'ano'
  /** Override do custo por período. NULL = usa item.custo_unitario_calc do orçamento. */
  custo_unitario: number | string | null
  receita_modo: 'mesma_logica_custo' | 'percentual_dos_servicos'
  /** Override da receita por período (modo direto). NULL = usa receita orçada do item. */
  receita_unitaria: number | string | null
  receita_percentual: number | string | null
  offset_dias_antes: number
  offset_dias_depois: number
  receita_extrapola: boolean
  aplica_taxas: boolean
  taxa_regime_id: string | null
  periodos_calc: number | string | null
}

interface TarefaRow {
  id: string
  item_orcamentario_id: string | null
  /** 'tarefa' = folha CPM | 'grupo' = nó EAP (skip CPM) | 'marco' = evento sem duração. */
  tipo_no: 'tarefa' | 'grupo' | 'marco'
  /** True quando item_orcamentario.indireto_id IS NOT NULL. Indiretas saem do CPM. */
  is_indireto: boolean
  /** Config quando is_indireto=true; null caso contrário. */
  indireto_config: IndiretoConfigRaw | null
  /** Venda unitária do item orçamentário (pra modo percentual de receita). */
  venda_unitaria_item: number | string | null
  /** Venda total do item (pra cap de receita quando receita_extrapola=false). */
  venda_total_item: number | string | null
  /** Custo unitário do item orçamentário (do orçamento — fallback pra indireta). */
  custo_unitario_item: number | string | null
  /** Quantidade alocada nesta tarefa-folha (NULL em grupo/marco). Substitui o uso de quantidade_referencia. */
  quantidade_alocada: number | null
  data_inicio: string | null
  data_fim: string | null
  data_inicio_manual: boolean
  quantidade_referencia: number | null
  producao_diaria_qtde: number | null
  cpu_snapshot_id: string | null
  /** Modo de scheduling: 'asap' (default) ou 'alap'. */
  schedule_mode: 'asap' | 'alap'
  /**
   * Constraint formal (semântica MS Project completa):
   *   snet — Start No Earlier Than (soft, empurra ES)
   *   snlt — Start No Later Than (soft, puxa LS no backward)
   *   fnet — Finish No Earlier Than (soft, empurra EF/dataFim no forward)
   *   fnlt — Finish No Later Than (soft, puxa LF no backward)
   *   mso  — Must Start On (hard, força ES = data)
   *   mfo  — Must Finish On (hard, força LF = data)
   * NULL = sem constraint formal.
   */
  constraint_type: 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo' | null
  /** Data-alvo da constraint. NULL quando constraint_type é NULL. */
  constraint_date: string | null
  /** Redesign Gantt Fase 4: vínculo de qtd_alocada a métrica do template. */
  qtd_link: string | null
  trecho_id: string | null
  posicao_inicio_m: number | null
  posicao_fim_m: number | null
  equipes: Array<{ id: string; qtd_equipes: number }>
  predecessoras: Array<{
    predecessora_id: string
    tipo: 'FS' | 'SS' | 'FF' | 'SF'
    lag_dias: number
  }>
}

interface WarningRecalc {
  tarefa_id: string
  tipo:
    | 'safety_duracao'
    | 'drift_anterior_ancora'
    | 'constraint_violated'
    | 'constraint_finish_violated'
    | 'free_float_negative'
    | 'marco_predecessor_sf_ignorado'
    | 'frozen_data_date'
  detalhe?: string
}

// Alias local pra manter os call-sites preexistentes funcionando sem
// renomear `calcCtx`. CalendarioCtx é a fonte canônica em _shared/.
type CalcContext = CalendarioCtx

Deno.serve(async (req) => {
  const pre = handlePreflight(req)
  if (pre) return pre
  try {
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
    .select('id, obra_id, data_referencia_inicio, data_date, is_baseline')
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
      'id, item_orcamentario_id, tipo_no, quantidade_alocada, ' +
        'data_inicio, data_fim, data_inicio_manual, ' +
        'quantidade_referencia, producao_diaria_qtde, cpu_snapshot_id, ' +
        'schedule_mode, constraint_type, constraint_date, ' +
        'qtd_link, trecho_id, posicao_inicio_m, posicao_fim_m, ' +
        'equipes, predecessoras, ' +
        'is_indireto, indireto_config, venda_unitaria_item, venda_total_item, custo_unitario_item'
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

  // 4.5) qtd_link recalc — delega TODO o cálculo pro Postgres via RPC
  //      `recalc_qtd_link_tarefas`. A implementação JS anterior retornava 0
  //      no runtime Deno apesar de simulação Node local + SQL diag retornarem
  //      o valor correto. Sem conseguir reproduzir, movi pra SQL onde o
  //      cálculo é 100% confiável e testável via supabase db query.
  const tarefasComLink = tarefas.filter(
    (t) => t.qtd_link && t.trecho_id && t.posicao_inicio_m != null && t.posicao_fim_m != null
  )
  if (tarefasComLink.length > 0) {
    const { data: qtdsRpc, error: rpcErr } = await admin.rpc('recalc_qtd_link_tarefas', {
      p_planejamento_id: planejamento_id
    })
    if (rpcErr) {
      return json(
        { error: 'Falha ao calcular qtd_link', detalhe: rpcErr.message },
        500
      )
    }
    const qtdById = new Map<string, number>()
    for (const row of (qtdsRpc ?? []) as Array<{ tarefa_id: string; qtd_calc: string | number }>) {
      qtdById.set(row.tarefa_id, Number(row.qtd_calc))
    }
    // Aplica in-memory pro forward pass usar imediatamente
    const updates: Array<{ id: string; quantidade_alocada: number }> = []
    for (const t of tarefasComLink) {
      const v = qtdById.get(t.id)
      if (v == null || !Number.isFinite(v) || v <= 0) {
        console.warn(`[qtd-link] tarefa ${t.id}: RPC retornou ${v} (nao positivo) — mantendo qtd anterior`)
        continue
      }
      t.quantidade_alocada = v
      updates.push({ id: t.id, quantidade_alocada: v })
    }
    // Persiste em série pra evitar race entre triggers DEFERRED.
    const errs: string[] = []
    for (const u of updates) {
      const { error: updErr } = await admin
        .from('planejamento_tarefa')
        .update({ quantidade_alocada: u.quantidade_alocada })
        .eq('id', u.id)
      if (updErr) {
        console.error(`[qtd-link] update ${u.id} falhou:`, updErr.message)
        errs.push(`${u.id}: ${updErr.message}`)
      }
    }
    if (errs.length > 0) {
      return json(
        {
          error: 'Falha ao persistir quantidades vinculadas',
          detalhe: errs.slice(0, 5).join(' | ')
        },
        500
      )
    }
  }

  // 5) Classificar: tarefas-folha válidas (CPM completo) | marcos (CPM
  //    como evento, sem perfil) | grupos (skip, rollup é do client) | inválidas
  //    (sem CPU/qtd_alocada/equipe — ficam sem data).
  const tarefaById = new Map<string, TarefaRow>()
  const tarefasValidas: TarefaRow[] = []
  const tarefasMarcos: TarefaRow[] = []
  const tarefasInvalidas: TarefaRow[] = []
  for (const t of tarefas) {
    tarefaById.set(t.id, t)
    if (t.tipo_no === 'grupo') continue // grupos não entram no CPM
    if (t.is_indireto) continue // indiretas dimensionadas pós-backward
    if (t.tipo_no === 'marco') {
      tarefasMarcos.push(t)
      continue
    }
    const eqsTotal = (t.equipes ?? []).reduce(
      (acc, e) => acc + Math.max(1, Number(e.qtd_equipes ?? 1)),
      0
    )
    const valida =
      !!t.cpu_snapshot_id &&
      Number(t.producao_diaria_qtde ?? 0) > 0 &&
      Number(t.quantidade_alocada ?? 0) > 0 &&
      eqsTotal > 0
    if (valida) tarefasValidas.push(t)
    else tarefasInvalidas.push(t)
  }

  // Zerar datas + campos CPM + apagar perfil das inválidas (sem CPU, prod=0, etc.)
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
          .update({
            data_inicio: null,
            data_fim: null,
            duracao_dias_uteis_calc: null,
            early_start: null,
            early_finish: null,
            late_start: null,
            late_finish: null,
            total_float: null,
            free_float: null,
            is_critico: false
          })
          .eq('id', t.id)
      )
    )
  }

  // 5.5) Perfil customizado: REMOVIDO em 2026-06. Toda tarefa agora opera com
  //      shape uniforme (CHECK constraint chk_plan_tar_perfil_flat_uniforme).
  //      O perfil semanal é DERIVADO do `calcularDuracaoDiaria` dia-a-dia via
  //      `agruparPorSemana` — alimenta a Curva-S sem mudar contrato da view.
  const validasIds = tarefasValidas.map((t) => t.id)

  // 6) Topological sort (Kahn) — sobre tarefas válidas + marcos. Grupos não
  //    participam (não têm cálculo próprio).
  const tarefasCpm: TarefaRow[] = [...tarefasValidas, ...tarefasMarcos]
  const cpmSet = new Set(tarefasCpm.map((t) => t.id))
  const indegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
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
    return json({ error: 'Grafo inconsistente — ciclo escapou da validação' }, 500)
  }

  // 7) Forward pass — dia-a-dia (2026-06: granularidade diária via
  //    calcularDuracaoDiaria; perfil semanal é apenas um agrupado do
  //    quantidadePorDia pra alimentar Curva-S).
  //    Pra cada tarefa em ordem topológica:
  //      - Compute dataInicioCalc a partir de predecessoras + constraints + âncora.
  //      - Aplica calcularDuracaoDiaria(qtd, prod, eqs, inicio, ctx).
  //      - Aplica FNET (forward, atrasa pra terminar não-antes-de X).
  //      - FF/SF backward adjustment desloca em dias úteis exatos (não semanas).
  const dataAncora = parseISO(plan.data_referencia_inicio)
  // Data Date (status date): tarefas com data_fim < dataDate são considradas
  // frozen (passado executado). Tarefas futuras têm ES >= dataDate. NULL no
  // banco = sem freeze (comportamento clássico).
  const dataDateProjeto: Date | null = plan.data_date
    ? parseISO(plan.data_date as string)
    : null
  const datasInicio = new Map<string, Date>()
  const datasFim = new Map<string, Date>()
  const duracoes = new Map<string, number>()
  const perfis = new Map<string, SemanaPerfil[]>() // perfis derivados, DELETE + UPSERT
  const warnings: WarningRecalc[] = []
  // Tarefas frozen (passado executado): mantêm data_inicio/data_fim do banco,
  // skip do recálculo. Suas datas alimentam predecessoras de sucessoras.
  const tarefasFrozen = new Set<string>()
  if (dataDateProjeto) {
    for (const t of tarefasCpm) {
      if (t.data_inicio && t.data_fim) {
        const dFim = parseISO(t.data_fim)
        if (dFim < dataDateProjeto) {
          tarefasFrozen.add(t.id)
          datasInicio.set(t.id, parseISO(t.data_inicio))
          datasFim.set(t.id, dFim)
          duracoes.set(t.id, t.tipo_no === 'marco' ? 0 : (t.quantidade_alocada ? Math.max(1, Math.ceil(diffWorkDays(parseISO(t.data_inicio), dFim, calcCtx) + 1)) : 0))
          warnings.push({
            tarefa_id: t.id,
            tipo: 'frozen_data_date',
            detalhe: `Tarefa congelada (data_fim ${t.data_fim} < data_date ${plan.data_date})`
          })
        }
      }
    }
  }

  for (const id of ordem) {
    // Frozen (passado executado, antes da Data Date): datas já populadas
    // antes do loop. Skip todo o cálculo — não regenera perfil, não shift.
    if (tarefasFrozen.has(id)) continue
    const t = tarefaById.get(id)!
    // Tarefas-folha usam quantidade_alocada (rateio entre N tarefas/item).
    // Marcos: qtd=0 (sem perfil).
    const qtd = Number(t.quantidade_alocada ?? 0)
    const prod = Number(t.producao_diaria_qtde ?? 0)
    const eqsTotal = (t.equipes ?? []).reduce(
      (acc, e) => acc + Math.max(1, Number(e.qtd_equipes ?? 1)),
      0
    )

    // (a) Determinar dataInicioCalc (= ES candidato) a partir de:
    //     1. MSO (hard): força início exatamente. Violação se predecessoras
    //        empurram pra depois — warning, mas mantém MSO.
    //     2. data_inicio_manual (legado, compat): força início. Backfill da
    //        Fase 2 transforma em MSO; quando isso for migrado, remove esse branch.
    //     3. Predecessoras (FS/SS/FF) — máximo entre todas.
    //     4. SNET (soft): empurra ES pra frente se for antes da data SNET.
    //     5. Data Date (frozen): tarefas atravessando Data Date têm ES = max(ES, data_date).
    //     6. Âncora do projeto (data_referencia_inicio).
    let dataInicioCalc: Date
    const cType = t.constraint_type
    const cDate = t.constraint_date ? parseISO(t.constraint_date) : null
    let violouConstraint = false

    if (cType === 'mso' && cDate) {
      // Hard: força ES = MSO. Se predecessoras pedirem mais tarde, violação.
      dataInicioCalc = cDate
      let predMax: Date | null = null
      for (const p of t.predecessoras ?? []) {
        const predIni = datasInicio.get(p.predecessora_id)
        const predFim = datasFim.get(p.predecessora_id)
        if (!predIni || !predFim) continue
        let cand: Date
        if (p.tipo === 'FS') cand = shiftWorkDays(predFim, p.lag_dias + 1, calcCtx)
        else if (p.tipo === 'SS') cand = shiftWorkDays(predIni, p.lag_dias, calcCtx)
        else if (p.tipo === 'FF') cand = shiftWorkDays(predFim, p.lag_dias, calcCtx)
        else continue // SF não fixa início
        if (!predMax || cand > predMax) predMax = cand
      }
      if (predMax && predMax > dataInicioCalc) {
        violouConstraint = true
        warnings.push({
          tarefa_id: t.id,
          tipo: 'constraint_violated',
          detalhe: `MSO em ${t.constraint_date} mas predecessoras forçam início em ${isoDate(predMax)}`
        })
      }
    } else if (t.data_inicio_manual && t.data_inicio) {
      // Legado: mesma semântica do MSO. Backfill migra; futuro remove.
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
        } else if (p.tipo === 'FF') {
          cand = shiftWorkDays(predFim, p.lag_dias, calcCtx)
        } else {
          // SF: não fixa início — restrição é sobre data_fim. Tratada em (d').
          continue
        }
        if (!candidato || cand > candidato) candidato = cand
      }
      dataInicioCalc = candidato ?? new Date(dataAncora)
      if (dataInicioCalc < dataAncora) {
        dataInicioCalc = new Date(dataAncora)
        warnings.push({ tarefa_id: t.id, tipo: 'drift_anterior_ancora' })
      }

      // SNET (soft): empurra ES pra frente se antes da data SNET.
      if (cType === 'snet' && cDate && dataInicioCalc < cDate) {
        dataInicioCalc = cDate
      }

      // Data Date freeze: tarefas que ainda não começaram não podem ser
      // agendadas antes da Data Date — passado é replanejado pra agora.
      if (dataDateProjeto && dataInicioCalc < dataDateProjeto) {
        dataInicioCalc = dataDateProjeto
      }

      dataInicioCalc = nextWorkDay(dataInicioCalc, calcCtx)
    }
    void violouConstraint // suprime "unused" — usado em UI via warnings

    // (a.1) Marco: duração=0, data_fim=data_inicio. Sem perfil, sem CPM forward
    //       de quantidade. Continua participando do backward pass via predecessoras.
    if (t.tipo_no === 'marco') {
      const dMarco = t.data_inicio_manual && t.data_inicio ? parseISO(t.data_inicio) : dataInicioCalc
      datasInicio.set(id, dMarco)
      datasFim.set(id, dMarco)
      duracoes.set(id, 0)
      continue
    }

    // (b) Calcular duração dia-a-dia + perfil derivado.
    //     calcularDuracaoDiaria itera dia útil aplicando fator(d) por dia;
    //     quantidadePorDia[] é depois agregado em semanas pra Curva-S.
    let dur = calcularDuracaoDiaria(qtd, prod, eqsTotal, dataInicioCalc, calcCtx)
    if (dur.atingiuLimite) {
      warnings.push({ tarefa_id: t.id, tipo: 'safety_duracao' })
    }
    let dataInicio = parseISO(dur.dataInicio)
    let dataFim = parseISO(dur.dataFim)
    let duracao = dur.duracaoDiasUteis
    let perfilFinal: SemanaPerfil[] = agruparPorSemana(dur.quantidadePorDia)

    // (c) FNET (Finish No Earlier Than) — atrasa início pra terminar não-antes-de
    //     a data alvo. Mantém duração; só desloca janela.
    if (cType === 'fnet' && cDate && dataFim < cDate) {
      const novoInicio = duracao > 1
        ? shiftWorkDays(cDate, -(duracao - 1), calcCtx)
        : cDate
      dur = calcularDuracaoDiaria(qtd, prod, eqsTotal, novoInicio, calcCtx)
      dataInicio = parseISO(dur.dataInicio)
      dataFim = parseISO(dur.dataFim)
      duracao = dur.duracaoDiasUteis
      perfilFinal = agruparPorSemana(dur.quantidadePorDia)
    }

    // (d) FF/SF backward adjustment: empurra dataFim adiante em dias úteis
    //     exatos (não múltiplos de 7), recomputando dia-a-dia pra preservar
    //     duração.
    for (const p of t.predecessoras ?? []) {
      if (p.tipo !== 'FF' && p.tipo !== 'SF') continue
      const ref =
        p.tipo === 'FF'
          ? datasFim.get(p.predecessora_id)
          : datasInicio.get(p.predecessora_id)
      if (!ref) continue
      const fimAlvo = shiftWorkDays(ref, p.lag_dias, calcCtx)
      if (fimAlvo > dataFim) {
        const novoInicio = duracao > 1
          ? shiftWorkDays(fimAlvo, -(duracao - 1), calcCtx)
          : fimAlvo
        if (novoInicio < dataAncora) {
          warnings.push({ tarefa_id: t.id, tipo: 'drift_anterior_ancora' })
        }
        dur = calcularDuracaoDiaria(qtd, prod, eqsTotal, novoInicio, calcCtx)
        dataInicio = parseISO(dur.dataInicio)
        dataFim = parseISO(dur.dataFim)
        duracao = dur.duracaoDiasUteis
        perfilFinal = agruparPorSemana(dur.quantidadePorDia)
      }
    }

    // (e) Warning explícito quando dataFim viola FNLT/MFO (soft) — backward
    //     ainda puxa LF, mas avisamos o usuário no momento do forward.
    if ((cType === 'fnlt' || cType === 'mfo') && cDate && dataFim > cDate) {
      const delta = diffWorkDays(cDate, dataFim, calcCtx)
      warnings.push({
        tarefa_id: t.id,
        tipo: 'constraint_finish_violated',
        detalhe: `${cType.toUpperCase()} em ${t.constraint_date} mas predecessoras forçam fim em ${isoDate(dataFim)} (excesso ${delta}d úteis)`
      })
    }

    perfis.set(t.id, perfilFinal)
    datasInicio.set(id, dataInicio)
    datasFim.set(id, dataFim)
    duracoes.set(id, duracao)
  }
  // Compat com response antigo: warning_drift true se qualquer drift ou safety.
  const warningDrift = warnings.some(
    (w) => w.tipo === 'drift_anterior_ancora' || w.tipo === 'safety_duracao'
  )

  // 8) Backward pass — calcula LF/LS, Total Float, Free Float, caminho crítico.
  //
  // ES = datasInicio (forward pass)
  // EF = datasFim    (forward pass)
  // LF = lateFinish  (este passo)
  // LS = LF - dur útil + 1   (= primeiro dia útil em que a tarefa pode começar
  //                            sem atrasar o projeto)
  // TF = LF - EF em dias úteis (folga total — pode ser negativa se constraint
  //                             força a tarefa pra trás da predecessora)
  // FF = min(ES sucessoras) - EF em dias úteis (folga livre — quanto pode
  //                                              atrasar sem afetar nenhuma sucessora)
  // is_critico = TF ≤ 0
  const dataFimProjeto = Array.from(datasFim.values()).reduce(
    (max, d) => (d > max ? d : max),
    dataAncora
  )
  const lateFinish = new Map<string, Date>()
  const lateStart = new Map<string, Date>()
  for (const id of [...ordem].reverse()) {
    const tNow = tarefaById.get(id)!
    const cTypeNow = tNow.constraint_type
    const cDateNow = tNow.constraint_date ? parseISO(tNow.constraint_date) : null
    // Se é sucessor terminal (sem sucessores conhecidos), lateFinish = fim do projeto
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
          // sucLS = sucLF - (sucDur - 1) workdays. Marco (dur=0) e tarefa de 1
          // dia (dur=1): LS = LF. Math.max(0, ...) evita off-by-one que forçava
          // shift mínimo de 1 dia mesmo quando não devia.
          const sucLS = shiftWorkDays(sucLF, -Math.max(0, Math.ceil(sucDur) - 1), calcCtx)
          let cand: Date
          if (p.tipo === 'FS') {
            cand = shiftWorkDays(sucLS, -p.lag_dias - 1, calcCtx)
          } else if (p.tipo === 'SS') {
            // Pred.LS = succ.LS - lag, pred.LF = pred.LS + pred.dur
            const predDur = duracoes.get(id) ?? 0
            const predLS = shiftWorkDays(sucLS, -p.lag_dias, calcCtx)
            cand = addWorkDays(predLS, Math.max(1, Math.ceil(predDur)), calcCtx)
          } else if (p.tipo === 'FF') {
            // FF: pred.LF = succ.LF - lag
            cand = shiftWorkDays(sucLF, -p.lag_dias, calcCtx)
          } else {
            // SF: pred.LS = succ.LF - lag → pred.LF = pred.LS + pred.dur
            const predDur = duracoes.get(id) ?? 0
            const predLS = shiftWorkDays(sucLF, -p.lag_dias, calcCtx)
            cand = addWorkDays(predLS, Math.max(1, Math.ceil(predDur)), calcCtx)
          }
          if (cand < lf) lf = cand
        }
      }
      lateFinish.set(id, lf)
    }

    // Aplicar FNLT (soft): puxa LF pra trás se LF_calc > FNLT date.
    // Aplicar MFO (hard): força LF = MFO date. Se sucessoras pedem antes,
    //   registra violação (espelha lógica do MSO no forward pass).
    if (cTypeNow === 'fnlt' && cDateNow) {
      const lfAtual = lateFinish.get(id)!
      if (lfAtual > cDateNow) lateFinish.set(id, cDateNow)
    } else if (cTypeNow === 'mfo' && cDateNow) {
      const lfAtual = lateFinish.get(id)!
      if (lfAtual < cDateNow) {
        warnings.push({
          tarefa_id: id,
          tipo: 'constraint_violated',
          detalhe: `MFO em ${tNow.constraint_date} mas sucessoras forçam fim em ${isoDate(lfAtual)}`
        })
      }
      lateFinish.set(id, cDateNow) // mantém MFO mesmo se violado (hard)
    }

    // LS = LF deslocado pra trás `dur - 1` dias úteis. Se duracao = 0 (marco),
    // LS = LF mesmo. Se duracao = 1 (tarefa de 1 dia), LS = LF. Caso geral:
    // LS é o primeiro dia útil em que a tarefa precisa começar.
    const dur = duracoes.get(id) ?? 0
    let lfFinal = lateFinish.get(id)!
    let ls = dur > 1 ? shiftWorkDays(lfFinal, -(Math.ceil(dur) - 1), calcCtx) : lfFinal

    // SNLT (Start No Later Than) — soft: puxa LS pra trás se LS_calc > SNLT.
    //   Recalcula LF = LS + (dur - 1) workdays pra preservar duração.
    //   Se predecessoras forçam ES > SNLT, será detectado via TF negativo no
    //   passo seguinte (warning é redundante com is_critico).
    if (cTypeNow === 'snlt' && cDateNow && ls > cDateNow) {
      ls = cDateNow
      lfFinal = dur > 1 ? addWorkDays(ls, Math.ceil(dur) - 1, calcCtx) : ls
      lateFinish.set(id, lfFinal)
    }
    lateStart.set(id, ls)
  }

  // Free Float = min(ES de sucessoras conectadas via FS sem lag) - EF
  // Cálculo conservador: olha a sucessora mais próxima de qualquer tipo,
  // descontando o lag correspondente. Pra cada sucessora, computa o "alvo"
  // que a tarefa atual precisaria atingir; FF é a folga mínima.
  const freeFloat = new Map<string, number>() // em dias úteis
  for (const id of ordem) {
    const sucessores = adj.get(id) ?? []
    const ef = datasFim.get(id)!
    if (sucessores.length === 0) {
      // Sem sucessor: FF = LF - EF (projeto inteiro permite atraso até a deadline)
      const lf = lateFinish.get(id)!
      freeFloat.set(id, diffWorkDays(ef, lf, calcCtx))
      continue
    }
    let minSlack = Number.POSITIVE_INFINITY
    for (const sId of sucessores) {
      const sucPreds = (tarefaById.get(sId)?.predecessoras ?? []).filter(
        (p) => p.predecessora_id === id
      )
      for (const p of sucPreds) {
        const sucES = datasInicio.get(sId)!
        const sucEF = datasFim.get(sId)!
        let slackDias: number
        if (p.tipo === 'FS') {
          // EF atual + lag + 1 dia útil ≤ ES sucessora
          const alvo = shiftWorkDays(sucES, -1 - p.lag_dias, calcCtx)
          slackDias = diffWorkDays(ef, alvo, calcCtx)
        } else if (p.tipo === 'SS') {
          // ES atual + lag ≤ ES sucessora → EF atual pode atrasar tanto quanto ES
          const alvo = shiftWorkDays(sucES, -p.lag_dias, calcCtx)
          slackDias = diffWorkDays(datasInicio.get(id)!, alvo, calcCtx)
        } else if (p.tipo === 'FF') {
          // EF atual + lag ≤ EF sucessora
          const alvo = shiftWorkDays(sucEF, -p.lag_dias, calcCtx)
          slackDias = diffWorkDays(ef, alvo, calcCtx)
        } else {
          // SF: ES atual + lag ≤ EF sucessora
          const alvo = shiftWorkDays(sucEF, -p.lag_dias, calcCtx)
          slackDias = diffWorkDays(datasInicio.get(id)!, alvo, calcCtx)
        }
        if (slackDias < minSlack) minSlack = slackDias
      }
    }
    // Clamp FF em [0, +∞). Slack negativo indica violação de constraint —
    // capturado em TF (que pode ser negativo) + warning explícito.
    const ffRaw = Number.isFinite(minSlack) ? minSlack : 0
    if (ffRaw < 0) {
      warnings.push({
        tarefa_id: id,
        tipo: 'free_float_negative',
        detalhe: `slack ${ffRaw}d úteis (constraint ou predecessor force atraso)`
      })
    }
    freeFloat.set(id, Math.max(0, ffRaw))
  }

  // Total Float em dias úteis = LF - EF (entre dias úteis).
  // is_critico = TF ≤ 0.
  const totalFloat = new Map<string, number>()
  const ehCritico = new Map<string, boolean>()
  const caminhoCritico: string[] = []
  for (const id of ordem) {
    const ef = datasFim.get(id)!
    const lf = lateFinish.get(id)!
    const tf = diffWorkDays(ef, lf, calcCtx)
    totalFloat.set(id, tf)
    const critico = tf <= 0
    ehCritico.set(id, critico)
    if (critico) caminhoCritico.push(id)
  }

  // ALAP shift: tarefas com schedule_mode='alap' que têm folga (TF > 0) e que
  // NÃO são frozen têm data_inicio/data_fim substituídas pelo par LS/LF —
  // agendamento "o mais tarde possível dentro da folga". Critical (TF≤0) não
  // tem folga pra shiftar, então ALAP = ASAP nesse caso. Perfil é recomputado
  // dia-a-dia a partir do novo LS (em vez de shift por semanas — preserva
  // precisão e respeita fator_mes da nova janela).
  for (const id of ordem) {
    if (tarefasFrozen.has(id)) continue
    const t = tarefaById.get(id)!
    if (t.schedule_mode !== 'alap') continue
    if (t.tipo_no === 'marco') continue // marco não tem perfil/duração
    const tf = totalFloat.get(id) ?? 0
    if (tf <= 0) continue
    const ls = lateStart.get(id)!
    const lf = lateFinish.get(id)!
    const qtd = Number(t.quantidade_alocada ?? 0)
    const prod = Number(t.producao_diaria_qtde ?? 0)
    const eqsTotal = (t.equipes ?? []).reduce(
      (acc, e) => acc + Math.max(1, Number(e.qtd_equipes ?? 1)),
      0
    )
    if (qtd > 0 && prod > 0 && eqsTotal > 0) {
      const recomp = calcularDuracaoDiaria(qtd, prod, eqsTotal, ls, calcCtx)
      perfis.set(id, agruparPorSemana(recomp.quantidadePorDia))
      // Em caso de fator_mes diferente entre ES e LS, dataFim recomputado pode
      // diferir de LF marginalmente. Confiamos no recomp pra data_fim.
      datasInicio.set(id, parseISO(recomp.dataInicio))
      datasFim.set(id, parseISO(recomp.dataFim))
    } else {
      datasInicio.set(id, ls)
      datasFim.set(id, lf)
    }
  }

  // 9a) Persist perfis: DELETE + INSERT chunked. Idempotente — re-run seguro.
  //     Todo perfil é DERIVADO (agruparPorSemana de calcularDuracaoDiaria),
  //     nunca preservado de execução anterior. Re-run sempre regenera.
  if (perfis.size > 0) {
    const ids = Array.from(perfis.keys())
    const { error: delErr } = await admin
      .from('planejamento_tarefa_perfil_semana')
      .delete()
      .in('tarefa_id', ids)
    if (delErr) {
      return json({ error: 'Falha em DELETE perfis', detalhe: delErr.message }, 500)
    }

    // Monta o batch agrupado por tarefa — CRÍTICO pra constraint trigger
    // `fn_ptps_validar_soma`. O trigger é DEFERRED+FOR EACH ROW: dispara no
    // commit de cada request e valida SUM(perfis WHERE tarefa_id=X) ==
    // tarefa.quantidade_alocada. Se uma tarefa for split entre 2 chunks, no
    // commit do chunk 1 a soma fica parcial → trigger explode com
    // check_violation. Solução: cada chunk só contém tarefas COMPLETAS.
    const grupos: Array<{
      tid: string
      rows: Array<{ tarefa_id: string; semana_segunda: string; quantidade_planejada: number }>
    }> = []
    for (const tid of ids) {
      const semanas = perfis.get(tid) ?? []
      const rows = semanas
        .filter((s) => s.quantidadePlanejada >= 0)
        .map((s) => ({
          tarefa_id: tid,
          semana_segunda: s.semanaSegunda,
          quantidade_planejada: s.quantidadePlanejada
        }))
      if (rows.length > 0) grupos.push({ tid, rows })
    }

    // Chunks de até CHUNK_LIMIT rows, mas NUNCA quebrando uma tarefa ao meio.
    // Se uma única tarefa exceder o limite (raro — só com perfil customizado
    // muito longo), insere ela inteira em chunk dedicado.
    const CHUNK_LIMIT = 1000
    let chunk: Array<{ tarefa_id: string; semana_segunda: string; quantidade_planejada: number }> =
      []
    let chunkIdx = 0
    // UPSERT em vez de INSERT: idempotente contra chamadas concorrentes.
    // PK (tarefa_id, semana_segunda) → ON CONFLICT atualiza quantidade.
    // Cenário: duas chamadas Edge em paralelo (race entre client serializado
    // imperfeito). T1.DELETE + T2.DELETE + T1.INSERT + T2.INSERT — sem upsert
    // o T2 estoura PK conflict. Com upsert, T2 só sobrescreve as mesmas rows
    // (resultado idempotente).
    const flush = async (): Promise<void> => {
      if (chunk.length === 0) return
      const { error: insErr } = await admin
        .from('planejamento_tarefa_perfil_semana')
        .upsert(chunk, { onConflict: 'tarefa_id,semana_segunda' })
      if (insErr) {
        throw insErr
      }
      chunkIdx++
      chunk = []
    }

    try {
      for (const g of grupos) {
        // Se adicionar o grupo estourar o limite e já temos algo na fila, flush.
        if (chunk.length > 0 && chunk.length + g.rows.length > CHUNK_LIMIT) {
          await flush()
        }
        chunk.push(...g.rows)
        // Grupo único excedeu o limite — manda sozinho.
        if (chunk.length >= CHUNK_LIMIT) {
          await flush()
        }
      }
      await flush()
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e)
      return json(
        {
          error: `Falha em INSERT perfis: ${msg}`,
          detalhe: msg,
          chunk_falho: chunkIdx,
          partial: true
        },
        500
      )
    }
  }

  // 9b) UPDATE batch das tarefas válidas: datas + duração + CPM.
  //     Campos CPM (ES/EF/LS/LF/TF/FF/is_critico) persistidos pra UI exibir
  //     sem recálculo na abertura.
  const updates = ordem.map((id) => ({
    id,
    data_inicio: isoDate(datasInicio.get(id)!),
    data_fim: isoDate(datasFim.get(id)!),
    duracao_dias_uteis_calc: duracoes.get(id) ?? 0,
    early_start: isoDate(datasInicio.get(id)!),
    early_finish: isoDate(datasFim.get(id)!),
    late_start: isoDate(lateStart.get(id)!),
    late_finish: isoDate(lateFinish.get(id)!),
    total_float: totalFloat.get(id) ?? 0,
    free_float: freeFloat.get(id) ?? 0,
    is_critico: ehCritico.get(id) ?? false
  }))

  // Supabase não tem batch update nativo — atualizar em paralelo
  const updResults = await Promise.all(
    updates.map((u) =>
      admin
        .from('planejamento_tarefa')
        .update({
          data_inicio: u.data_inicio,
          data_fim: u.data_fim,
          duracao_dias_uteis_calc: u.duracao_dias_uteis_calc,
          early_start: u.early_start,
          early_finish: u.early_finish,
          late_start: u.late_start,
          late_finish: u.late_finish,
          total_float: u.total_float,
          free_float: u.free_float,
          is_critico: u.is_critico
        })
        .eq('id', u.id)
    )
  )
  const errs = updResults.filter((r) => r.error).map((r) => r.error!.message)
  if (errs.length > 0) {
    return json({ error: 'Falha em UPDATE', detalhes: errs.slice(0, 5) }, 500)
  }

  // 9c) Indiretas — dimensionamento dinâmico pós-backward.
  //     Indiretas saem do CPM (skip no forward pass, não geram nem aceitam
  //     dependências). Aqui calculamos: data_inicio = min(diretas) - offset_antes;
  //     data_fim = max(diretas) + offset_depois. Custo/receita derivados da
  //     config em planejamento_tarefa_indireto + cache de cálculo.
  //
  //     Quando NÃO há tarefas diretas (cronograma vazio), indiretas ficam com
  //     datas NULL → ocultas no Gantt até existir algo a cobrir.
  const indiretas = tarefas.filter((t) => t.is_indireto && t.indireto_config != null)
  if (indiretas.length > 0) {
    const diretasComData = tarefas.filter(
      (t) => !t.is_indireto && t.tipo_no === 'tarefa' && datasInicio.has(t.id) && datasFim.has(t.id)
    )
    const indErrs: string[] = []

    if (diretasComData.length === 0) {
      // Cronograma vazio (ou só com indiretas): zera + oculta indiretas.
      for (const ind of indiretas) {
        const r1 = await admin
          .from('planejamento_tarefa')
          .update({
            data_inicio: null,
            data_fim: null,
            duracao_dias_uteis_calc: 0,
            early_start: null,
            early_finish: null,
            late_start: null,
            late_finish: null,
            total_float: null,
            free_float: null,
            is_critico: false,
            quantidade_alocada: null
          })
          .eq('id', ind.id)
        if (r1.error) indErrs.push(`${ind.id}: ${r1.error.message}`)
        const r2 = await admin
          .from('planejamento_tarefa_indireto')
          .update({
            custo_total_calc: 0,
            receita_total_calc: 0,
            custo_taxas_calc: 0,
            periodos_calc: 0
          })
          .eq('tarefa_id', ind.id)
        if (r2.error) indErrs.push(`${ind.id} (config): ${r2.error.message}`)
      }
    } else {
      // Bounds globais das diretas.
      const inicioGlobal = Array.from(diretasComData).reduce(
        (min, t) => {
          const d = datasInicio.get(t.id)!
          return d < min ? d : min
        },
        datasInicio.get(diretasComData[0].id)!
      )
      const fimGlobal = Array.from(diretasComData).reduce(
        (max, t) => {
          const d = datasFim.get(t.id)!
          return d > max ? d : max
        },
        datasFim.get(diretasComData[0].id)!
      )

      // Pré-carrega taxa_regimes referenciadas (1 query)
      const taxaIds = Array.from(
        new Set(
          indiretas
            .map((t) => t.indireto_config?.taxa_regime_id)
            .filter((x): x is string => x != null)
        )
      )
      const taxaPctById = new Map<string, number>()
      if (taxaIds.length > 0) {
        const { data: regimes } = await admin
          .from('encargos_sociais_regime')
          .select('id, total_perc_calc')
          .in('id', taxaIds)
        for (const r of (regimes ?? []) as Array<{ id: string; total_perc_calc: number | string }>) {
          taxaPctById.set(r.id, Number(r.total_perc_calc))
        }
      }

      for (const ind of indiretas) {
        const cfg = ind.indireto_config!
        const inicio = addWorkDays(inicioGlobal, -cfg.offset_dias_antes, calcCtx)
        const fim = addWorkDays(fimGlobal, cfg.offset_dias_depois, calcCtx)

        // Períodos cobertos (fracionados)
        let periodos = 0
        if (cfg.custo_periodicidade === 'dia') {
          periodos = diffWorkDays(inicio, fim, calcCtx)
        } else if (cfg.custo_periodicidade === 'mes') {
          periodos = diffMonths(inicio, fim)
        } else if (cfg.custo_periodicidade === 'ano') {
          periodos = diffYears(inicio, fim)
        }

        // Custo unitário: override em cfg ou herda do item orçamentário
        // (item.custo_unitario_calc = indireto_item.valor_total).
        const custoUnit =
          cfg.custo_unitario != null
            ? Number(cfg.custo_unitario)
            : Number(ind.custo_unitario_item ?? 0)
        const custoTotal = custoUnit * periodos

        // Faturamento das tarefas diretas que cruzam o intervalo da indireta,
        // ponderado por fração de sobreposição. Usa venda_unitaria_item derivada
        // na view v11 (servico_grupo: venda_total/qtd_ref). Reusado pra receita
        // modo percentual E pra base de taxas.
        let vendaDiretasNoPeriodo = 0
        for (const t of diretasComData) {
          const tIni = datasInicio.get(t.id)!
          const tFim = datasFim.get(t.id)!
          if (!sobreposicao(tIni, tFim, inicio, fim)) continue
          const fracao = fracaoSobreposta(tIni, tFim, inicio, fim)
          const qtd = Number(t.quantidade_alocada ?? 0)
          const vendaUnit = Number(t.venda_unitaria_item ?? 0)
          vendaDiretasNoPeriodo += qtd * vendaUnit * fracao
        }

        // Receita
        let receitaTotal = 0
        if (cfg.receita_modo === 'mesma_logica_custo') {
          // receita_unitária por período: override em cfg OU derivada do
          // orçamento como (venda_total_item / quantidade_referencia).
          // Pressupõe quantidade_referencia na mesma unidade que a
          // periodicidade (ex: qtd_ref=4 VB e periodicidade=mes → R$/mês).
          let receitaUnit: number
          if (cfg.receita_unitaria != null) {
            receitaUnit = Number(cfg.receita_unitaria)
          } else {
            const vendaTotal = Number(ind.venda_total_item ?? 0)
            const qtdRef = Number(ind.quantidade_referencia ?? 0)
            receitaUnit = qtdRef > 0 ? vendaTotal / qtdRef : 0
          }
          receitaTotal = receitaUnit * periodos
        } else {
          const pct = Number(cfg.receita_percentual) || 0
          receitaTotal = vendaDiretasNoPeriodo * (pct / 100)
        }

        // Cap de receita não-extrapola
        if (cfg.receita_extrapola === false) {
          const vendaOrcada = Number(ind.venda_total_item ?? 0)
          if (vendaOrcada > 0 && receitaTotal > vendaOrcada) {
            receitaTotal = vendaOrcada
          }
        }

        // Taxas — sobre faturamento TOTAL no período da indireta (diretas +
        // a própria indireta). `total_perc_calc` já é armazenado como decimal
        // (ex: 0.1508 = 15,08%) — multiplica direto, espelha
        // vw_orcamento_consolidado.impostos.
        const faturamentoTotal = vendaDiretasNoPeriodo + receitaTotal
        let custoTaxas = 0
        if (cfg.aplica_taxas && cfg.taxa_regime_id) {
          const taxaPct = taxaPctById.get(cfg.taxa_regime_id) ?? 0
          custoTaxas = faturamentoTotal * taxaPct
        }

        // Persistir. quantidade_alocada = max(periodos, 0.0001) — passa no
        // check chk_plan_tar_qtd_alocada_pos (>0) e dá ao UI um número
        // significativo (N períodos cobertos). periodos pode ser fracionário.
        const r1 = await admin
          .from('planejamento_tarefa')
          .update({
            data_inicio: isoDate(inicio),
            data_fim: isoDate(fim),
            duracao_dias_uteis_calc: diffWorkDays(inicio, fim, calcCtx),
            early_start: isoDate(inicio),
            early_finish: isoDate(fim),
            late_start: isoDate(inicio),
            late_finish: isoDate(fim),
            total_float: 0,
            free_float: 0,
            is_critico: false,
            quantidade_alocada: Math.max(periodos, 0.0001)
          })
          .eq('id', ind.id)
        if (r1.error) indErrs.push(`${ind.id}: ${r1.error.message}`)

        const r2 = await admin
          .from('planejamento_tarefa_indireto')
          .update({
            custo_total_calc: custoTotal,
            receita_total_calc: receitaTotal,
            custo_taxas_calc: custoTaxas,
            periodos_calc: periodos
          })
          .eq('tarefa_id', ind.id)
        if (r2.error) indErrs.push(`${ind.id} (config): ${r2.error.message}`)
      }
    }

    if (indErrs.length > 0) {
      return json(
        { error: 'Falha ao calcular indiretas', detalhe: indErrs.slice(0, 5).join(' | ') },
        500
      )
    }
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
    perfis_regenerados: perfis.size,
    data_inicio: isoDate(dataInicioProjeto),
    data_fim: isoDate(dataFimProjeto),
    duracao_total_dias_uteis: diasUteisTotal,
    duracao_total_dias_corridos: diasCorridos,
    caminho_critico_ids: caminhoCritico,
    warning_drift: warningDrift,
    warnings,
    duracao_ms: Date.now() - t0
  })
  } catch (e) {
    // Captura uncaught throw e empacota com CORS headers. Sem isso, o Deno
    // runtime retorna 500 nativo sem CORS → navegador classifica como CORS
    // error e nao mostra a mensagem real (bug recorrente de diagnostico).
    console.error('[calcular-cronograma] uncaught', e)
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack?.slice(0, 2000) : undefined
    return json({ error: 'Erro interno no recalculo', detalhe: msg, stack }, 500)
  }
})
