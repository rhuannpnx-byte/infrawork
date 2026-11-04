/**
 * Datas "de calendário" no fuso do navegador. NUNCA use
 * `new Date().toISOString().slice(0, 10)` para "hoje": às 21h+ no Brasil o
 * resultado em UTC já é amanhã.
 */

export function toLocalISO(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Hoje ('YYYY-MM-DD') no fuso local. */
export function hojeLocalISO(): string {
  return toLocalISO(new Date())
}

/** Soma dias a uma data ISO 'YYYY-MM-DD' (sem fuso). */
export function addDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  const dt = new Date(y, m - 1, d + dias)
  return toLocalISO(dt)
}

/** Data ISO → Date local à meia-noite. */
export function parseLocalISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  return new Date(y, m - 1, d)
}
