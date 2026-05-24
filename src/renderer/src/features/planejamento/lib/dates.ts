/**
 * Helpers de data para o Gantt. Trabalham com strings ISO YYYY-MM-DD e
 * Date em UTC. NÃO usam locale (renderização BR fica no componente).
 */

export function parseISO(s: string): Date {
  return new Date(s + 'T00:00:00Z')
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

export function startOfWeekMonday(d: Date): Date {
  const r = new Date(d)
  const dow = r.getUTCDay()
  const diff = dow === 0 ? -6 : 1 - dow
  r.setUTCDate(r.getUTCDate() + diff)
  return r
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export function startOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}

const MESES_BR = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez'
]

export function fmtDataBR(s: string | null | undefined): string {
  if (!s) return '—'
  const d = parseISO(s)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yy = String(d.getUTCFullYear())
  return `${dd}/${mm}/${yy}`
}

export function fmtDataMonoBR(s: string | null | undefined): string {
  if (!s) return '—'
  const d = parseISO(s)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = MESES_BR[d.getUTCMonth()]
  return `${dd} ${mm}`
}

export function fmtMesAnoBR(d: Date): string {
  return `${MESES_BR[d.getUTCMonth()]}/${d.getUTCFullYear()}`
}

export function fmtMesAnoBRDoISO(anoMes: string): string {
  // 'YYYY-MM-01' ou 'YYYY-MM-DD'
  const d = parseISO(anoMes)
  return fmtMesAnoBR(d)
}
