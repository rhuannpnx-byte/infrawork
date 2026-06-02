// src/renderer/src/features/planejamento/lib/cronograma-pure.ts
//
// ⚠️ ESPELHO de supabase/functions/_shared/cronograma-pure.ts
//
// Cópia byte-equivalente das funções puras de CPM/calendário usadas pela
// edge function `calcular-cronograma`. Mantemos duplicado (em vez de import
// direto) porque tsconfig.web.json não inclui supabase/ no `include` e Deno
// vs Vite têm resolvers de path diferentes.
//
// REGRA: qualquer alteração em UMA das duas cópias DEVE ser propagada pra
// outra. Verificação via diff:
//   diff supabase/functions/_shared/cronograma-pure.ts \
//        src/renderer/src/features/planejamento/lib/cronograma-pure.ts
//
// 2026-06: shapes não-uniformes foram removidas (gerarPerfilSemanal / pesoPerfil
// / shiftPerfilSemanas / makeCapacidadePorSemana / estimarNSemanas excluídos).
// O caminho crítico agora usa `calcularDuracaoDiaria` (dia-a-dia, com fator
// mensal exato) + `agruparPorSemana` (deriva perfil pra Curva-S).

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
 * 2026-06: shapes não-uniformes removidas. Tipo segue só pra documentar
 * histórico — CHECK constraint no DB garante que só 'uniforme' chega ao
 * runtime.
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
  const dow = d.getUTCDay()
  const bit = dow === 0 ? 6 : dow - 1
  return ((ctx.bitmask >> bit) & 1) === 1
}

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

export function fatorParaData(d: Date, ctx: CalendarioCtx): number {
  const key = isoDate(d).slice(0, 7)
  return ctx.fatorMes.get(key) ?? 1.0
}

export function startOfWeekMondayUTC(d: Date): Date {
  const r = new Date(d)
  const dow = r.getUTCDay()
  const diff = dow === 0 ? -6 : 1 - dow
  r.setUTCDate(r.getUTCDate() + diff)
  r.setUTCHours(0, 0, 0, 0)
  return r
}

// ─── Resultado dia-a-dia ────────────────────────────────────────────────────

export interface QuantidadeDia {
  data: string
  quantidade: number
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
 * Cada dia útil contribui com `prod × eq × fator(d)` ao acumulado. Tarefas
 * que cruzam virada de mês com fatores diferentes ficam corretas (fórmula
 * linear ingênua `qtd / (prod × eq)` ignora isso).
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

// ─── Perfil semanal derivado ────────────────────────────────────────────────

export interface SemanaPerfil {
  semanaSegunda: string
  quantidadePlanejada: number
}

/**
 * Agrupa `quantidadePorDia[]` em buckets de semana ISO (segunda-feira UTC).
 * Usado pra alimentar Curva-S a partir do resultado de calcularDuracaoDiaria.
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
