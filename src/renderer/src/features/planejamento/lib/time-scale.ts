// time-scale — tiers adaptativas pra TimeScale do GanttPane (Fase 3).
//
// Portado de prototype/utils.jsx. Lógica idêntica:
//   * pickScaleTiers(pxPerDay) escolhe { major, minor } pra o header
//   * iterateTier(start, end, tier) é generator que produz spans
//   * labelTier(span, tier, pxWide) gera label adaptativo por largura
//   * isoWeek(d) número ISO 8601 da semana
//
// Trabalha em horário local (não UTC) — datas vêm de parseISO do `dates.ts`
// que retorna midnight UTC, mas as funções aqui usam getFullYear/getMonth/
// getDay (locais). Como o app só cuida de dia útil (não hora exata), o offset
// de timezone é irrelevante pra todos os casos práticos.

export type ScaleTier = 'year' | 'month' | 'week' | 'day'

export const PX_PER_DAY_MIN = 0.6
export const PX_PER_DAY_MAX = 50

export const MS_DAY = 86400000

const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MONTHS_FULL = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro'
]
const WEEKDAYS_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

export function addDaysLocal(d: Date, n: number): Date {
  const r = startOfDay(d)
  r.setDate(r.getDate() + n)
  return r
}

export function diffDaysLocal(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_DAY)
}

export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

export function isWeekend(d: Date): boolean {
  const w = d.getDay()
  return w === 0 || w === 6
}

// ISO week number (semana inicia segunda; semana 1 contém a primeira quinta do ano)
export function isoWeek(d: Date): number {
  const target = new Date(d.valueOf())
  const dayNr = (d.getDay() + 6) % 7
  target.setDate(target.getDate() - dayNr + 3)
  const firstThursday = new Date(target.getFullYear(), 0, 4)
  const diff = target.getTime() - firstThursday.getTime()
  return 1 + Math.round((diff / MS_DAY - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

/**
 * Escolhe os 2 tiers da TimeScale baseado em pxPerDay.
 *   pxPerDay ≥ 22 → week / day
 *   pxPerDay ≥ 5  → month / week
 *   pxPerDay < 5  → year / month
 */
export function pickScaleTiers(pxPerDay: number): { major: ScaleTier; minor: ScaleTier } {
  if (pxPerDay >= 22) return { major: 'week', minor: 'day' }
  if (pxPerDay >= 5) return { major: 'month', minor: 'week' }
  return { major: 'year', minor: 'month' }
}

export interface TierSpan {
  start: Date
  end: Date
}

/**
 * Gera spans (start, end) cobrindo [start, end) de acordo com o tier.
 *
 * Em vez de generator (que estava no JSX original), retorna array — mais
 * simples pra React (chave/index) e tipagem.
 */
export function iterateTier(start: Date, end: Date, tier: ScaleTier): TierSpan[] {
  const out: TierSpan[] = []
  let cursor = startOfDay(start)
  // Safety: máximo 5000 iterações pra evitar loop infinito em datas inválidas.
  let safety = 0
  while (cursor < end && safety < 5000) {
    let next: Date
    if (tier === 'year') {
      next = new Date(cursor.getFullYear() + 1, 0, 1)
    } else if (tier === 'month') {
      next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    } else if (tier === 'week') {
      const dow = (cursor.getDay() + 6) % 7 // 0 = Mon
      next = addDaysLocal(cursor, 7 - dow)
    } else {
      next = addDaysLocal(cursor, 1)
    }
    out.push({ start: new Date(cursor), end: next })
    cursor = next
    safety++
  }
  return out
}

/**
 * Snap a date pro início do seu span. Útil quando o range começa no meio
 * de um período (e o primeiro span do header precisa começar no marco).
 */
export function tierStart(d: Date, tier: ScaleTier): Date {
  if (tier === 'year') return new Date(d.getFullYear(), 0, 1)
  if (tier === 'month') return new Date(d.getFullYear(), d.getMonth(), 1)
  if (tier === 'week') return addDaysLocal(d, -((d.getDay() + 6) % 7))
  return startOfDay(d)
}

/**
 * Label adaptativo pro span de acordo com a largura disponível em px.
 * Quanto mais largo, mais detalhado o label.
 */
export function labelTier(span: TierSpan, tier: ScaleTier, pxWide: number): string {
  const d = span.start
  if (tier === 'year') {
    if (pxWide < 28) return ''
    return String(d.getFullYear())
  }
  if (tier === 'month') {
    if (pxWide < 18) return ''
    if (pxWide < 34) return MONTHS_SHORT[d.getMonth()][0]
    if (pxWide < 58) return MONTHS_SHORT[d.getMonth()]
    if (pxWide < 92) return `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
    return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`
  }
  if (tier === 'week') {
    if (pxWide < 20) return ''
    if (pxWide < 38) return String(isoWeek(d)).padStart(2, '0')
    return `Sem ${String(isoWeek(d)).padStart(2, '0')}`
  }
  // day
  if (pxWide < 14) return ''
  if (pxWide < 26) return String(d.getDate()).padStart(2, '0')
  return `${WEEKDAYS_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}`
}
