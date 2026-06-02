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

/**
 * Nome da shape de distribuição semanal.
 *
 * 2026-06: shapes não-uniformes (sino/rampa/etc) foram removidas do produto.
 * O tipo segue aqui só pra documentar histórico — o CHECK constraint no DB
 * (`chk_plan_tar_perfil_flat_uniforme`) garante que só 'uniforme' chega ao
 * runtime, e o forward pass usa `calcularDuracaoDiaria` + `agruparPorSemana`
 * em vez de `gerarPerfilSemanal` (deletada). Manter o tipo simplifica a
 * remoção futura das colunas `perfil_default`/`usa_perfil_customizado`.
 */
export type PerfilNome = 'uniforme'

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
 * Diferença em DIAS ÚTEIS entre `from` e `to` (sinalizada).
 *
 * Convenção CPM:
 *   - 0  → mesmas datas
 *   - >0 → `to` está N dias úteis à frente de `from`
 *   - <0 → `to` está N dias úteis atrás (constraint violado / drift)
 *
 * Não conta `from` (semelhante a `shiftWorkDays` reverso). Útil para
 * computar Total Float (LF - EF) e Free Float (alvo - EF) em dias úteis,
 * mesma unidade que o motor opera. Aproximação O(|delta_dias|) ok pra
 * janelas típicas de cronograma (centenas de dias); pra horizons largos,
 * pode ser otimizado com counting de feriados.
 */
export function diffWorkDays(from: Date, to: Date, ctx: CalendarioCtx): number {
  if (from.getTime() === to.getTime()) return 0
  const dir = to > from ? 1 : -1
  let cur = new Date(from)
  let count = 0
  while (cur.getTime() !== to.getTime()) {
    cur = addDays(cur, dir)
    if (isWorkDay(cur, ctx)) count += dir
  }
  return count
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

/**
 * Agrupa `quantidadePorDia[]` em buckets de semana ISO (segunda-feira UTC).
 *
 * Usado pra derivar o perfil semanal — que alimenta a Curva-S via tabela
 * `planejamento_tarefa_perfil_semana` — a partir do resultado dia-a-dia de
 * `calcularDuracaoDiaria`. Substitui `gerarPerfilSemanal` no caminho crítico
 * do forward pass (vide 2026-06: flatten pra uniforme + duração dia-a-dia).
 *
 * Soma `quantidade` por `startOfWeekMondayUTC(parseISO(data))`. Retorna
 * ordenado por `semanaSegunda` ascendente. Semanas sem dia útil não aparecem.
 */
export function agruparPorSemana(dias: QuantidadeDia[]): SemanaPerfil[] {
  if (dias.length === 0) return []
  const buckets = new Map<string, number>()
  for (const d of dias) {
    const seg = isoDate(startOfWeekMondayUTC(parseISO(d.data)))
    buckets.set(seg, (buckets.get(seg) ?? 0) + d.quantidade)
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([semanaSegunda, quantidadePlanejada]) => ({
      semanaSegunda,
      quantidadePlanejada
    }))
}

// ─── Helpers para tarefa indireta ───────────────────────────────────────
// Diferenças cruciais vs tarefa direta:
//   * Custo = custo_unit × N períodos (dia/mês/ano). N pode ser fracionado.
//   * Receita modo "percentual" = % da venda das tarefas diretas que cruzam
//     o intervalo da indireta, ponderada pela fração de sobreposição.
//
// Os helpers abaixo são puros (sem dependência de Deno/PostgREST) pra serem
// testáveis em Deno test e reusáveis no client se um dia precisar.

/**
 * Diferença em meses, fracionada. Conta dias dentro do mês.
 * Exemplo: 15/jan → 15/fev = 1 mês exato. 15/jan → 16/fev = 1 + 1/29 (fev tem 29 dias em ano bissexto, senão 28).
 * Convenção: usa days-in-month do mês final pra fração fracionária.
 */
export function diffMonths(de: Date, ate: Date): number {
  if (ate.getTime() <= de.getTime()) return 0
  const yA = de.getUTCFullYear()
  const mA = de.getUTCMonth()
  const dA = de.getUTCDate()
  const yB = ate.getUTCFullYear()
  const mB = ate.getUTCMonth()
  const dB = ate.getUTCDate()
  const mesesInteiros = (yB - yA) * 12 + (mB - mA)
  // Dias restantes (dB - dA) dentro do mês B → fração do mês B.
  const diasNoMesB = new Date(Date.UTC(yB, mB + 1, 0)).getUTCDate()
  const fracao = (dB - dA) / diasNoMesB
  return mesesInteiros + fracao
}

/**
 * Diferença em anos, fracionada. Usa days-in-year do ano final.
 */
export function diffYears(de: Date, ate: Date): number {
  if (ate.getTime() <= de.getTime()) return 0
  const yA = de.getUTCFullYear()
  const yB = ate.getUTCFullYear()
  const inicioAnoB = Date.UTC(yB, 0, 1)
  const fimAnoB = Date.UTC(yB + 1, 0, 1)
  const diasAnoB = (fimAnoB - inicioAnoB) / (1000 * 60 * 60 * 24)
  // Dias decorridos em ano B até a data ate.
  const diasDecorridosB = (ate.getTime() - inicioAnoB) / (1000 * 60 * 60 * 24)
  // Dias decorridos em ano A desde de.
  const inicioAnoA = Date.UTC(yA, 0, 1)
  const fimAnoA = Date.UTC(yA + 1, 0, 1)
  const diasAnoA = (fimAnoA - inicioAnoA) / (1000 * 60 * 60 * 24)
  const diasDecorridosA = (de.getTime() - inicioAnoA) / (1000 * 60 * 60 * 24)
  const fracaoA = 1 - diasDecorridosA / diasAnoA
  const fracaoB = diasDecorridosB / diasAnoB
  const anosInteiros = yB - yA - 1
  if (anosInteiros < 0) {
    // mesmo ano: só fracaoB - (1 - fracaoA) = fracaoB + fracaoA - 1, mas pra mesmo ano cai aqui
    return (ate.getTime() - de.getTime()) / (1000 * 60 * 60 * 24) / diasAnoB
  }
  return fracaoA + anosInteiros + fracaoB
}

/** True se [aIni,aFim] e [bIni,bFim] têm interseção (datas-only, dia inteiro). */
export function sobreposicao(aIni: Date, aFim: Date, bIni: Date, bFim: Date): boolean {
  return aIni.getTime() <= bFim.getTime() && bIni.getTime() <= aFim.getTime()
}

/**
 * Fração do intervalo `[aIni,aFim]` que está dentro de `[bIni,bFim]`.
 * Resultado entre 0 e 1. 0 quando não há sobreposição. 1 quando `a` está
 * completamente dentro de `b`.
 *
 * Conta em dias corridos (não úteis) — para distribuição de receita das
 * tarefas diretas dentro do período da indireta isso é suficiente; receita
 * é distribuída uniformemente no tempo.
 */
export function fracaoSobreposta(aIni: Date, aFim: Date, bIni: Date, bFim: Date): number {
  const aDur = (aFim.getTime() - aIni.getTime()) / (1000 * 60 * 60 * 24) + 1
  if (aDur <= 0) return 0
  const interIni = Math.max(aIni.getTime(), bIni.getTime())
  const interFim = Math.min(aFim.getTime(), bFim.getTime())
  if (interFim < interIni) return 0
  const interDur = (interFim - interIni) / (1000 * 60 * 60 * 24) + 1
  return Math.max(0, Math.min(1, interDur / aDur))
}

