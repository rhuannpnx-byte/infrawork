/**
 * Converte o texto digitado em quantidade. Aceita "1.234,56" (pt-BR) e
 * "1234.56" (teclado numérico com ponto). Vazio/inválido → null.
 */
export function parseQtd(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) ? n : null
}
