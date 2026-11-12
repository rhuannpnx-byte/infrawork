/**
 * Helpers de data para o Gantt. Trabalham com strings ISO YYYY-MM-DD e
 * Date em UTC. NÃO usam locale (renderização BR fica no componente).
 */

export function parseISO(s: string): Date {
  return new Date(s + 'T00:00:00Z')
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
