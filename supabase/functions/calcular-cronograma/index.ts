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
  calcularDuracaoDiaria,
  type CalendarioCtx,
  isoDate,
  isWorkDay,
  nextWorkDay,
  parseISO,
  shiftWorkDays
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
  equipes: Array<{ id: string; qtd_equipes: number }>
  predecessoras: Array<{
    predecessora_id: string
    tipo: 'FS' | 'SS' | 'FF'
    lag_dias: number
  }>
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
        'quantidade_referencia, producao_diaria_qtde, cpu_snapshot_id, equipes, predecessoras'
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

  // Zerar datas das inválidas
  if (tarefasInvalidas.length > 0) {
    await Promise.all(
      tarefasInvalidas.map((t) =>
        admin
          .from('planejamento_tarefa')
          .update({ data_inicio: null, data_fim: null, duracao_dias_uteis_calc: null })
          .eq('id', t.id)
      )
    )
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

  // 7) Forward pass — calcula data_inicio, duracao, data_fim
  const dataAncora = parseISO(plan.data_referencia_inicio)
  const datasInicio = new Map<string, Date>()
  const datasFim = new Map<string, Date>()
  const duracoes = new Map<string, number>()
  let warningDrift = false

  for (const id of ordem) {
    const t = tarefaById.get(id)!
    const qtd = Number(t.quantidade_referencia ?? 0)
    const prod = Number(t.producao_diaria_qtde ?? 0)
    const eqsTotal = (t.equipes ?? []).reduce(
      (acc, e) => acc + Math.max(1, Number(e.qtd_equipes ?? 1)),
      0
    )

    let dataInicio: Date
    if (t.data_inicio_manual && t.data_inicio) {
      dataInicio = parseISO(t.data_inicio)
    } else {
      // Sem predecessoras → usa âncora
      let candidato: Date | null = null
      for (const p of t.predecessoras ?? []) {
        const predIni = datasInicio.get(p.predecessora_id)
        const predFim = datasFim.get(p.predecessora_id)
        if (!predIni || !predFim) continue
        let cand: Date
        if (p.tipo === 'FS') {
          cand = shiftWorkDays(predFim, p.lag_dias + 1, calcCtx)
          // +1 porque FS = inicia no próximo dia útil após fim
        } else if (p.tipo === 'SS') {
          cand = shiftWorkDays(predIni, p.lag_dias, calcCtx)
        } else {
          // FF — calculado depois quando soubermos duração
          cand = shiftWorkDays(predFim, p.lag_dias, calcCtx)
        }
        if (!candidato || cand > candidato) candidato = cand
      }
      dataInicio = candidato ?? new Date(dataAncora)
      if (dataInicio < dataAncora) {
        dataInicio = new Date(dataAncora)
        warningDrift = true
      }
      dataInicio = nextWorkDay(dataInicio, calcCtx)
    }

    // calcularDuracaoDiaria integra o fator mensal POR DIA ÚTIL. Tarefas que
    // cruzam virada de mês com fatores diferentes agora ficam corretas (antes
    // só era aplicado o fator do mês de data_inicio).
    const durResult = calcularDuracaoDiaria(qtd, prod, eqsTotal, dataInicio, calcCtx)
    if (durResult.atingiuLimite) {
      warningDrift = true
    }
    const duracao = durResult.duracaoDiasUteis
    let dataFim: Date
    if (duracao <= 0) {
      dataFim = dataInicio
    } else {
      dataFim = parseISO(durResult.dataFim)
    }

    // Reajuste para FF: se predecessora exige predFim+lag, força data_fim e recalcula data_inicio
    for (const p of t.predecessoras ?? []) {
      if (p.tipo !== 'FF') continue
      const predFim = datasFim.get(p.predecessora_id)
      if (!predFim) continue
      const fimAlvo = shiftWorkDays(predFim, p.lag_dias, calcCtx)
      if (fimAlvo > dataFim) {
        dataFim = fimAlvo
        dataInicio = shiftWorkDays(dataFim, -Math.max(1, Math.ceil(duracao) - 1), calcCtx)
        if (dataInicio < dataAncora) {
          dataInicio = new Date(dataAncora)
          warningDrift = true
        }
      }
    }

    datasInicio.set(id, dataInicio)
    datasFim.set(id, dataFim)
    duracoes.set(id, duracao)
  }

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

  // 9) UPDATE batch
  const updates = ordem.map((id) => ({
    id,
    data_inicio: isoDate(datasInicio.get(id)!),
    data_fim: isoDate(datasFim.get(id)!),
    duracao_dias_uteis_calc: duracoes.get(id) ?? 0
  }))

  // Supabase não tem batch update nativo — atualizar em paralelo
  const updResults = await Promise.all(
    updates.map((u) =>
      admin
        .from('planejamento_tarefa')
        .update({
          data_inicio: u.data_inicio,
          data_fim: u.data_fim,
          duracao_dias_uteis_calc: u.duracao_dias_uteis_calc
        })
        .eq('id', u.id)
    )
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
    data_inicio: isoDate(dataInicioProjeto),
    data_fim: isoDate(dataFimProjeto),
    duracao_total_dias_uteis: diasUteisTotal,
    duracao_total_dias_corridos: diasCorridos,
    caminho_critico_ids: caminhoCritico,
    warning_drift: warningDrift,
    duracao_ms: Date.now() - t0
  })
})
