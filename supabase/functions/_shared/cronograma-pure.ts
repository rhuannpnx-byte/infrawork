// supabase/functions/_shared/cronograma-pure.ts
//
// Lógica pura de cálculo de cronograma — sem IO, sem Supabase, sem Deno-specific.
// Permite testes de unidade via `deno test` sem precisar de DB nem rodar a edge function.
//
// Escopo deste commit (commit 1): utilitários de calendário + calcularDuracaoDiaria,
// que substitui o calcularDuracao buggy (linha 127 original de calcular-cronograma)
// que usava só o fator do mês de início.
//
// IMPORTANTE — regra do fator de produtividade mensal:
//   * `obra_produtividade_mes.fator` é aplicado POR DIA ÚTIL.
//   * Lookup é exato por mês (chave 'YYYY-MM').
//   * Ausência de registro = fator 1.0 (sem multiplicação).
//   * Tarefa que atravessa virada de mês usa o fator de CADA dia, não o do início.

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface CalendarioCtx {
  /** Bitmask de dias úteis: bit0=seg, ..., bit6=dom. Default 31 (seg-sex). */
  bitmask: number
  /** Map<isoDate, eh_util>: exceções que sobrescrevem o bitmask. */
  excecoes: Map<string, boolean>
  /** Map<'YYYY-MM', fator>: fator de produtividade mensal (default 1.0 se ausente). */
  fatorMes: Map<string, number>
}

export const SAFETY_MAX_WORK_DAYS = 1830 // ~5 anos úteis
export const SAFETY_MAX_SEMANAS = 260 // ~5 anos semanais

/** Nome da shape de distribuição semanal. Manter alinhado com TS client. */
export type PerfilNome =
  | 'uniforme'
  | 'rampa-subida'
  | 'rampa-descida'
  | 'sino'
  | 'front-loaded'
  | 'back-loaded'

// ─── Utilitários de data ────────────────────────────────────────────────────

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function parseISO(s: string): Date {
  return new Date(s + 'T00:00:00Z')
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

export function isWorkDay(d: Date, ctx: CalendarioCtx): boolean {
  const key = isoDate(d)
  const exc = ctx.excecoes.get(key)
  if (exc !== undefined) return exc
  // JS getUTCDay: 0=dom, 1=seg, ..., 6=sab
  // Nosso bit: 0=seg, 1=ter, ..., 5=sab, 6=dom
  const dow = d.getUTCDay()
  const bit = dow === 0 ? 6 : dow - 1
  return ((ctx.bitmask >> bit) & 1) === 1
}

/** Avança até o próximo dia útil (inclui `start` se útil). */
export function nextWorkDay(start: Date, ctx: CalendarioCtx): Date {
  let cur = new Date(start)
  let safety = 0
  while (!isWorkDay(cur, ctx)) {
    cur = addDays(cur, 1)
    safety++
    if (safety > 366) break
  }
  return cur
}

/** Avança N dias úteis CONTANDO A PARTIR de start como dia 1 (se útil). */
export function addWorkDays(start: Date, nWork: number, ctx: CalendarioCtx): Date {
  if (nWork <= 0) return nextWorkDay(start, ctx)
  let cur = nextWorkDay(start, ctx)
  let remaining = nWork - 1
  while (remaining > 0) {
    cur = addDays(cur, 1)
    if (isWorkDay(cur, ctx)) remaining--
  }
  return cur
}

/** Avança N dias úteis em qualquer direção (negativo retrocede). */
export function shiftWorkDays(start: Date, nWork: number, ctx: CalendarioCtx): Date {
  if (nWork === 0) return new Date(start)
  const dir = nWork > 0 ? 1 : -1
  let cur = new Date(start)
  let remaining = Math.abs(nWork)
  while (remaining > 0) {
    cur = addDays(cur, dir)
    if (isWorkDay(cur, ctx)) remaining--
  }
  return cur
}

/**
 * Fator de produtividade aplicado ao dia `d`. Lookup exato por mês.
 * Ausência de registro = 1.0 (sem efeito).
 */
export function fatorParaData(d: Date, ctx: CalendarioCtx): number {
  const key = isoDate(d).slice(0, 7) // 'YYYY-MM'
  return ctx.fatorMes.get(key) ?? 1.0
}

/**
 * Retorna a segunda-feira da semana ISO que contém `d` (em UTC).
 * Ex: quinta 2026-02-05 → segunda 2026-02-02.
 * ISO week começa na segunda; JS Date.getUTCDay() retorna 0=Dom..6=Sab.
 */
export function startOfWeekMondayUTC(d: Date): Date {
  const r = new Date(d)
  const dow = r.getUTCDay() // 0=dom, 1=seg, ..., 6=sab
  const diff = dow === 0 ? -6 : 1 - dow
  r.setUTCDate(r.getUTCDate() + diff)
  // Zera horário (segurança caso input não fosse meia-noite)
  r.setUTCHours(0, 0, 0, 0)
  return r
}

/**
 * Último dia útil de uma semana (começando na segunda). Itera de domingo
 * pra trás. Se a semana inteira for não-útil, retorna a própria segunda.
 */
export function ultimoDiaUtilDaSemana(segunda: Date, ctx: CalendarioCtx): Date {
  for (let i = 6; i >= 0; i--) {
    const d = addDays(segunda, i)
    if (isWorkDay(d, ctx)) return d
  }
  return segunda
}

// ─── Resultado da duração dia-a-dia ─────────────────────────────────────────

export interface QuantidadeDia {
  data: string // 'YYYY-MM-DD'
  quantidade: number // produção daquele dia útil (último dia capeado)
}

export interface DuracaoResult {
  dataInicio: string
  dataFim: string
  duracaoDiasUteis: number
  quantidadePorDia: QuantidadeDia[]
  atingiuLimite: boolean
}

/**
 * Duração dia-a-dia com fator mensal aplicado POR DIA ÚTIL.
 *
 * Substitui a fórmula `quantidade / (prod × eq × fator_mes_inicio)` (que usava
 * só o fator do mês de início — bug detectado). Agora cada dia útil contribui
 * com `prodDiaria × qtdEquipes × fator(d)` ao acumulado. Tarefas que cruzam
 * virada de mês com fatores diferentes ficam corretas.
 *
 * Regras:
 *   - quantidade_ref ou prod_diaria ≤ 0 → retorna duração 0, perfil vazio.
 *   - Avança a partir do primeiro dia útil ≥ dataInicio.
 *   - Para cada dia útil: acumula `prod × eq × fator(d)` até atingir quantidade.
 *   - Último dia tem qtd CAPADA em (quantidade - acumulado_antes).
 *   - Safety: se passar de SAFETY_MAX_WORK_DAYS sem atingir, retorna
 *     `atingiuLimite: true` + perfil parcial. Caller decide o tratamento.
 *   - qtdEquipes < 1 é normalizado para 1.
 */
export function calcularDuracaoDiaria(
  quantidadeRef: number,
  prodDiaria: number,
  qtdEquipes: number,
  dataInicio: Date,
  ctx: CalendarioCtx
): DuracaoResult {
  if (quantidadeRef <= 0 || prodDiaria <= 0) {
    const iso = isoDate(dataInicio)
    return {
      dataInicio: iso,
      dataFim: iso,
      duracaoDiasUteis: 0,
      quantidadePorDia: [],
      atingiuLimite: false
    }
  }

  const eqs = Math.max(1, qtdEquipes)
  const prodBase = prodDiaria * eqs

  let cur = nextWorkDay(dataInicio, ctx)
  const inicioIso = isoDate(cur)

  let acumulado = 0
  let diasUteis = 0
  const perDay: QuantidadeDia[] = []
  let safety = 0
  let ultimoDia = cur

  while (acumulado < quantidadeRef) {
    if (safety++ >= SAFETY_MAX_WORK_DAYS) {
      return {
        dataInicio: inicioIso,
        dataFim: isoDate(ultimoDia),
        duracaoDiasUteis: diasUteis,
        quantidadePorDia: perDay,
        atingiuLimite: true
      }
    }
    if (isWorkDay(cur, ctx)) {
      const prodEfetiva = prodBase * fatorParaData(cur, ctx)
      const restante = quantidadeRef - acumulado
      const qtdDia = Math.min(prodEfetiva, restante)
      perDay.push({ data: isoDate(cur), quantidade: qtdDia })
      acumulado += qtdDia
      diasUteis += 1
      ultimoDia = cur
      if (acumulado >= quantidadeRef) break
    }
    cur = addDays(cur, 1)
  }

  return {
    dataInicio: inicioIso,
    dataFim: isoDate(ultimoDia),
    duracaoDiasUteis: diasUteis,
    quantidadePorDia: perDay,
    atingiuLimite: false
  }
}

// ─── Perfil semanal ─────────────────────────────────────────────────────────

export interface SemanaPerfil {
  semanaSegunda: string // 'YYYY-MM-DD'
  quantidadePlanejada: number
}

export interface GerarPerfilInput {
  quantidadeTotal: number
  dataInicio: Date
  /** Capacidade máxima da semana (em unidades da tarefa). Factory recomendada: makeCapacidadePorSemana. */
  capacidadePorSemana: (semanaSegunda: Date) => number
  perfil: PerfilNome
  /**
   * Política quando capacidade da semana < target da shape:
   *   'rigido'         — cap absoluto; excedente vai pra semana seguinte; perfil deforma. (DEFAULT)
   *   'preservar-shape' — RESERVADO pra futuro; não shipado nesta entrega.
   */
  politicaCap?: 'rigido' | 'preservar-shape'
  /** Estimativa inicial de duração em semanas; se omitido, calcula via amostragem. */
  duracaoEstimadaSemanas?: number
  /** Safety cap pra não loopar; default SAFETY_MAX_SEMANAS. */
  safetyMaxSemanas?: number
}

export interface GerarPerfilResult {
  semanas: SemanaPerfil[]
  /** True se rolou spillover além do N estimado (perfil deformou). */
  excedeuCapacidade: boolean
  /** True se bateu safetyMaxSemanas com restante > 0 (perfil parcial). */
  atingiuSafety: boolean
  /** Soma efetivamente alocada (== quantidadeTotal salvo safety). */
  somaPlanejada: number
}

/**
 * Capacidade máxima da semana em unidades da tarefa. Itera os 7 dias da
 * semana, soma `prodDiaria × qtdEquipes × fator(d)` apenas pros dias úteis.
 *
 * IMPORTANTE: fator é POR DIA, não por semana. Semana atravessando virada
 * de mês com fatores diferentes usa fator distinto em dias distintos.
 *
 * Factory retorna closure que pode ser chamada repetidamente. Cache externa
 * (por ex. memoizing por `(prod, eqs, semanaSegunda_iso)`) é responsabilidade
 * do caller — esta função é pura e barata o suficiente pra não precisar.
 */
export function makeCapacidadePorSemana(
  prodDiaria: number,
  qtdEquipes: number,
  ctx: CalendarioCtx
): (segunda: Date) => number {
  const eqs = Math.max(1, qtdEquipes)
  const prodBase = prodDiaria * eqs
  return (segunda) => {
    let cap = 0
    for (let i = 0; i < 7; i++) {
      const d = addDays(segunda, i)
      if (!isWorkDay(d, ctx)) continue
      cap += prodBase * fatorParaData(d, ctx)
    }
    return cap
  }
}

/**
 * Pesos relativos por shape. Argumento i ∈ [0, n-1]; n = total de semanas.
 * Retorno >= 0. Normalização ocorre no algoritmo de geração.
 *
 * - uniforme:      constante 1
 * - rampa-subida:  linear 0.3 → 1.0
 * - rampa-descida: linear 1.0 → 0.3
 * - sino:          parábola invertida, pico em t=0.5, bordas 0.2
 * - front-loaded:  exponencial decrescente exp(-2t)
 * - back-loaded:   espelho do front
 */
export function pesoPerfil(perfil: PerfilNome, i: number, n: number): number {
  if (n <= 0) return 0
  if (n === 1) return 1 // 1 semana → tudo nela

  const t = i / (n - 1) // ∈ [0, 1]

  switch (perfil) {
    case 'uniforme':
      return 1
    case 'rampa-subida':
      return 0.3 + 0.7 * t
    case 'rampa-descida':
      return 1.0 - 0.7 * t
    case 'sino': {
      const x = 2 * t - 1
      return 1.0 - 0.8 * x * x
    }
    case 'front-loaded':
      return Math.exp(-2.0 * t)
    case 'back-loaded':
      return Math.exp(-2.0 * (1 - t))
  }
}

/** Estima N (semanas iniciais) via amostragem barata de 26 semanas. */
function estimarNSemanas(input: GerarPerfilInput): number {
  if (input.duracaoEstimadaSemanas && input.duracaoEstimadaSemanas > 0) {
    return input.duracaoEstimadaSemanas
  }
  const SAMPLE = 26
  let soma = 0
  let nz = 0
  let cur = startOfWeekMondayUTC(input.dataInicio)
  for (let i = 0; i < SAMPLE; i++) {
    const c = input.capacidadePorSemana(cur)
    if (c > 0) {
      soma += c
      nz++
    }
    cur = addDays(cur, 7)
  }
  if (nz === 0) return 1
  const capMedia = soma / nz
  return Math.max(1, Math.ceil(input.quantidadeTotal / capMedia))
}

/**
 * Gera perfil semanal pra uma tarefa. Approach C — sequential weighting com
 * extensão automática quando capacidade limita.
 *
 * Passos:
 *   1) Estima N inicial via amostragem da capacidade (ou usa duracaoEstimadaSemanas).
 *   2) Calcula pesos w_i = pesoPerfil(perfil, i, N).
 *   3) Pra cada semana i ∈ [0, N): target = (w_i / Σ_remaining(w)) × restante.
 *      Cap em capacidadePorSemana(segunda). Persiste min(target, cap, restante).
 *   4) Se restante > 0 após N semanas: extensão uniforme até zerar.
 *   5) Semana com capacidade 0 (paralisação total): qtd 0; consome peso w_i.
 *      Justificativa: paralisação no meio do projeto preserva shape inicial e
 *      empurra produção residual; manter "semana zerada" visível na UI é
 *      melhor que pular silencioso.
 *   6) Se restante > 0 após safetyMaxSemanas: atingiuSafety = true + parcial.
 *      Caller decide (persiste com warning ou aborta).
 *
 * dataInicio mid-week: primeira semanaSegunda = ISO Monday da semana de dataInicio.
 * Capacidade da semana parcial é menor naturalmente (só dias úteis restantes).
 */
export function gerarPerfilSemanal(input: GerarPerfilInput): GerarPerfilResult {
  const safetyMax = input.safetyMaxSemanas ?? SAFETY_MAX_SEMANAS
  let restante = input.quantidadeTotal

  if (restante <= 0) {
    return { semanas: [], excedeuCapacidade: false, atingiuSafety: false, somaPlanejada: 0 }
  }

  const N = estimarNSemanas(input)

  const pesos: number[] = []
  for (let i = 0; i < N; i++) pesos.push(pesoPerfil(input.perfil, i, N))
  let somaPesosRestante = pesos.reduce((a, b) => a + b, 0)

  const semanas: SemanaPerfil[] = []
  let segunda = startOfWeekMondayUTC(input.dataInicio)
  let i = 0
  let excedeu = false

  while (restante > 1e-9) {
    if (semanas.length >= safetyMax) {
      return {
        semanas,
        excedeuCapacidade: excedeu,
        atingiuSafety: true,
        somaPlanejada: input.quantidadeTotal - restante
      }
    }

    const cap = input.capacidadePorSemana(segunda)
    let target: number

    if (i < N) {
      const w = pesos[i]
      target = somaPesosRestante > 0 ? (w / somaPesosRestante) * restante : restante
      somaPesosRestante -= w
    } else {
      // Fora da janela inicial: distribui o restante uniforme até zerar.
      excedeu = true
      target = restante
    }

    if (cap <= 0) {
      // Paralisação total nesta semana — zero. Peso w_i ainda foi consumido acima.
      semanas.push({ semanaSegunda: isoDate(segunda), quantidadePlanejada: 0 })
      segunda = addDays(segunda, 7)
      i++
      continue
    }

    const plan = Math.min(target, cap, restante)
    semanas.push({ semanaSegunda: isoDate(segunda), quantidadePlanejada: plan })
    restante -= plan

    segunda = addDays(segunda, 7)
    i++
  }

  return {
    semanas,
    excedeuCapacidade: excedeu,
    atingiuSafety: false,
    somaPlanejada: input.quantidadeTotal - restante
  }
}

/**
 * Desloca todas as semanas de um perfil em `deltaWeeks` semanas (positivo
 * forward, negativo backward). Preserva shape e quantidades; apenas as
 * datas mudam.
 *
 * Uso: predecessor empurra início de tarefa customizada — em vez de
 * regenerar (perdendo customização), faz shift.
 */
export function shiftPerfilSemanas(semanas: SemanaPerfil[], deltaWeeks: number): SemanaPerfil[] {
  if (deltaWeeks === 0 || semanas.length === 0) return semanas
  return semanas.map((s) => ({
    semanaSegunda: isoDate(addDays(parseISO(s.semanaSegunda), deltaWeeks * 7)),
    quantidadePlanejada: s.quantidadePlanejada
  }))
}
