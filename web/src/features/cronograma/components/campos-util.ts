/** Conversões dos campos dos diálogos do cronograma. */

/** "AAAA-MM-DDTHH:MM:SS" (banco) ↔ "AAAA-MM-DDTHH:MM" (datetime-local). */
export const paraInputDataHora = (v: string | null | undefined): string => (v ? v.slice(0, 16) : '')
export const doInputDataHora = (v: string): string | null =>
  v ? (v.length === 16 ? `${v}:00` : v) : null

/** Número digitado em pt-BR (vírgula decimal, ponto de milhar opcional). */
export function lerNumero(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}
