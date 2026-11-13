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

/**
 * Data ISO ('YYYY-MM-DD', com ou sem hora depois) como dd/mm/aaaa. Só rearranja o texto: não passa por `Date`,
 * então não muda de dia por causa do fuso.
 */
export function dataBR(iso: string | null | undefined, vazio = '—'): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : vazio
}

/** Dia e mês (dd/mm) de uma data ISO. */
export function diaMesBR(iso: string | null | undefined, vazio = ''): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : vazio
}
