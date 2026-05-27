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
