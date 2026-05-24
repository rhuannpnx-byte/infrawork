/**
 * Parser tolerante para estacas no formato livre que vem do SIGA.
 * Exemplos reais:
 *   "1"
 *   "18+060"
 *   "18+060 ao 18+760"
 *   "18+814 a 19+703"
 *
 * Quando o parser falha (texto totalmente arbitrário), devolve null e o
 * consumidor cai num fallback lexicográfico.
 */

const RE_ESTACA = /(\d+)\s*\+\s*(\d+(?:[.,]\d+)?)/g

export interface EstacaParsed {
  ordinal: number
  metro: number
}

export function parseEstaca(s: string | null | undefined): EstacaParsed | null {
  if (!s) return null
  RE_ESTACA.lastIndex = 0
  const m = RE_ESTACA.exec(s)
  if (!m) return null
  const ordinal = Number(m[1])
  const metro = Number(String(m[2]).replace(',', '.'))
  if (Number.isNaN(ordinal) || Number.isNaN(metro)) return null
  return { ordinal, metro }
}

export function comparaEstaca(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const pa = parseEstaca(a)
  const pb = parseEstaca(b)
  if (pa && pb) {
    if (pa.ordinal !== pb.ordinal) return pa.ordinal - pb.ordinal
    return pa.metro - pb.metro
  }
  // fallback: ordem lexicográfica
  return String(a ?? '').localeCompare(String(b ?? ''))
}

/** Resume um intervalo: "18+060 a 18+760" → mostra como veio do SIGA. */
export function formatEstaca(s: string | null | undefined): string {
  if (!s) return '—'
  return s.trim()
}
